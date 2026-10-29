import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMainLocale } from '../i18n'
import type { AzureRepoRef } from '../../shared/scm'
import { githubRepo } from '../../shared/scm-guards'
import type { MergeOptions, MergeRequest, PullRequestDetail } from '../../shared/types'
import type { ConfirmFn } from './confirm'
import { mergePullRequest, setAutoMerge, type MergeCapable } from './merge'

const repo = githubRepo('acme', 'api')
const HEAD = 'a'.repeat(40)
const MOVED = 'b'.repeat(40)

function options(overrides: Partial<MergeOptions> = {}): MergeOptions {
  return {
    headSha: HEAD,
    strategies: [
      { strategy: 'merge', allowed: true },
      { strategy: 'squash', allowed: true },
      { strategy: 'rebase', allowed: false },
    ],
    blocker: null,
    checksWarning: null,
    deleteSourceBranch: 'option',
    deleteBranchWithAutoMerge: false,
    workItems: null,
    autoMerge: { available: true },
    current: null,
    ...overrides,
  }
}

/** `details` are answered in order (validate, re-check, after the write); the last one repeats. */
function fakeProvider(
  details: Partial<PullRequestDetail>[] = [{}],
  mergeOptions: MergeOptions = options(),
  base: PullRequestDetail['repo'] = repo,
) {
  let call = 0
  const getPullRequestDetail = vi.fn(async () => {
    const detail = details[Math.min(call, details.length - 1)]
    call += 1
    return {
      repo: base,
      number: 7,
      title: 'Add refunds',
      state: 'open',
      baseRef: 'main',
      headRef: 'feature/refunds',
      headSha: HEAD,
      ...detail,
    } as PullRequestDetail
  })
  const mergeWrite = vi.fn(async () => ({ completed: true }))
  const autoWrite = vi.fn(async () => {})
  const provider: MergeCapable = {
    getPullRequestDetail,
    getMergeOptions: vi.fn(async () => mergeOptions),
    mergePullRequest: mergeWrite,
    setAutoMerge: autoWrite,
  }
  return { provider, mergeWrite, autoWrite, getPullRequestDetail }
}

const req: MergeRequest = {
  repo,
  number: 7,
  expectedHeadSha: HEAD,
  strategy: 'merge',
  deleteSourceBranch: true,
  transitionWorkItems: false,
}
const accept: ConfirmFn = async () => true
const decline: ConfirmFn = async () => false

describe('mergePullRequest', () => {
  it('re-validates, confirms with the facts it read, re-checks, then merges at the reviewed head', async () => {
    const { provider, mergeWrite } = fakeProvider([{}, {}, { state: 'merged' }])
    const confirm = vi.fn(accept)
    await expect(mergePullRequest(provider, req, confirm)).resolves.toMatchObject({
      outcome: 'merged',
      pr: { state: 'merged' },
    })
    expect(confirm).toHaveBeenCalledWith({
      message: 'Merge PR #7?',
      detail:
        'acme/api\nAdd refunds\nfeature/refunds → main\nMerge commit · head aaaaaaa\n' +
        'Deletes feature/refunds afterwards',
      confirmLabel: 'Merge',
    })
    expect(mergeWrite).toHaveBeenCalledWith({
      repo,
      number: 7,
      headSha: HEAD,
      sourceBranch: 'feature/refunds',
      strategy: 'merge',
      deleteSourceBranch: true,
      transitionWorkItems: false,
    })
  })

  it('declined: nothing is written', async () => {
    const { provider, mergeWrite } = fakeProvider()
    await expect(mergePullRequest(provider, req, decline)).resolves.toEqual({
      outcome: 'cancelled',
    })
    expect(mergeWrite).not.toHaveBeenCalled()
  })

  it('a head that moved before the dialog is a CONFLICT, and nothing is asked', async () => {
    const { provider, mergeWrite } = fakeProvider([{ headSha: MOVED }])
    const confirm = vi.fn(accept)
    await expect(mergePullRequest(provider, req, confirm)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('bbbbbbb'),
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(mergeWrite).not.toHaveBeenCalled()
  })

  it('a head that moved WHILE the dialog was open is a CONFLICT too', async () => {
    const { provider, mergeWrite } = fakeProvider([{}, { headSha: MOVED }])
    await expect(mergePullRequest(provider, req, accept)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(mergeWrite).not.toHaveBeenCalled()
  })

  it('a PR closed meanwhile is a CONFLICT', async () => {
    const { provider } = fakeProvider([{ state: 'closed' }])
    await expect(mergePullRequest(provider, req, accept)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it.each([
    ['conflicts', 'MERGE_CONFLICT'],
    ['checks_failing', 'CHECKS_FAILING'],
    ['checks_pending', 'CHECKS_FAILING'],
    ['approvals_missing', 'MERGE_BLOCKED'],
    ['draft', 'MERGE_BLOCKED'],
    ['behind', 'MERGE_BLOCKED'],
    ['checking', 'MERGE_BLOCKED'],
    ['blocked', 'MERGE_BLOCKED'],
    ['no_permission', 'FORBIDDEN'],
  ] as const)('blocker %s is refused with %s before any dialog', async (blocker, code) => {
    const { provider, mergeWrite } = fakeProvider([{}], options({ blocker }))
    const confirm = vi.fn(accept)
    await expect(mergePullRequest(provider, req, confirm)).rejects.toMatchObject({ code })
    expect(confirm).not.toHaveBeenCalled()
    expect(mergeWrite).not.toHaveBeenCalled()
  })

  it('a strategy the repository forbids is MERGE_BLOCKED', async () => {
    const { provider, mergeWrite } = fakeProvider()
    await expect(
      mergePullRequest(provider, { ...req, strategy: 'rebase' }, accept),
    ).rejects.toMatchObject({ code: 'MERGE_BLOCKED' })
    expect(mergeWrite).not.toHaveBeenCalled()
  })

  it('GitHub has no work items: asking to complete them is refused', async () => {
    const { provider } = fakeProvider()
    await expect(
      mergePullRequest(provider, { ...req, transitionWorkItems: true }, accept),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('a repository that deletes merged branches by itself: not asked to delete again, but said', async () => {
    const { provider, mergeWrite } = fakeProvider([{}], options({ deleteSourceBranch: 'repo' }))
    const confirm = vi.fn(accept)
    await mergePullRequest(provider, { ...req, deleteSourceBranch: false }, confirm)
    expect(confirm.mock.calls[0]?.[0].detail).toContain('Deletes feature/refunds afterwards')
    expect(mergeWrite).toHaveBeenCalledWith(expect.objectContaining({ deleteSourceBranch: false }))
  })

  it('Azure: "Complete", work items in the dialog, and an asynchronous completion', async () => {
    const az: AzureRepoRef = {
      provider: 'azure',
      organization: 'contoso',
      project: 'Platform',
      name: 'orders-api',
      repositoryId: '11111111-1111-4111-8111-111111111111',
      fullName: 'contoso/Platform/orders-api',
    }
    const { provider, mergeWrite } = fakeProvider(
      [{}],
      options({ workItems: 2, deleteBranchWithAutoMerge: true }),
      az,
    )
    mergeWrite.mockResolvedValueOnce({ completed: false })
    const confirm = vi.fn(accept)
    const result = await mergePullRequest(
      provider,
      { ...req, repo: az, strategy: 'squash', transitionWorkItems: true },
      confirm,
    )
    expect(result.outcome).toBe('completing')
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({
      message: 'Complete PR #7?',
      confirmLabel: 'Complete',
    })
    expect(confirm.mock.calls[0]?.[0].detail).toContain('Completes 2 linked work item(s)')
  })

  it('Azure: work items the options could not read are never completed', async () => {
    const az: AzureRepoRef = {
      provider: 'azure',
      organization: 'contoso',
      project: 'Platform',
      name: 'orders-api',
      repositoryId: '11111111-1111-4111-8111-111111111111',
      fullName: 'contoso/Platform/orders-api',
    }
    const { provider, mergeWrite } = fakeProvider([{}], options({ workItems: 0 }), az)
    const confirm = vi.fn(accept)
    await mergePullRequest(provider, { ...req, repo: az, transitionWorkItems: true }, confirm)
    expect(confirm.mock.calls[0]?.[0].detail).not.toContain('work item')
    expect(mergeWrite).toHaveBeenCalledWith(expect.objectContaining({ transitionWorkItems: false }))
  })

  it('a failed branch delete is reported, the merge stands', async () => {
    const { provider, mergeWrite } = fakeProvider([{}, {}, { state: 'merged' }])
    mergeWrite.mockResolvedValueOnce({ completed: true, branchDeleteFailed: true } as never)
    await expect(mergePullRequest(provider, req, accept)).resolves.toMatchObject({
      outcome: 'merged',
      branchDeleteFailed: true,
    })
  })

  describe('in Spanish', () => {
    afterEach(() => setMainLocale('en'))

    it('the dialog follows the UI language', async () => {
      setMainLocale('es')
      const { provider } = fakeProvider()
      const confirm = vi.fn(accept)
      await mergePullRequest(provider, req, confirm)
      expect(confirm.mock.calls[0]?.[0]).toMatchObject({
        message: '¿Hacer merge del PR #7?',
        confirmLabel: 'Hacer merge',
      })
    })
  })
})

describe('setAutoMerge', () => {
  const on = {
    repo,
    number: 7,
    enable: true as const,
    expectedHeadSha: HEAD,
    strategy: 'squash' as const,
    deleteSourceBranch: true,
    transitionWorkItems: false,
  }

  it('turns auto-merge on after the dialog, at the reviewed head (GitHub never deletes the branch for it)', async () => {
    const { provider, autoWrite } = fakeProvider([{}], options({ blocker: 'checks_pending' }))
    const confirm = vi.fn(accept)
    await expect(setAutoMerge(provider, on, confirm)).resolves.toMatchObject({
      outcome: 'enabled',
    })
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({
      message: 'Enable auto-merge for PR #7?',
      confirmLabel: 'Enable',
    })
    expect(confirm.mock.calls[0]?.[0].detail).not.toContain('Deletes')
    expect(autoWrite).toHaveBeenCalledWith({
      repo,
      number: 7,
      enable: true,
      headSha: HEAD,
      strategy: 'squash',
      deleteSourceBranch: false,
      transitionWorkItems: false,
    })
  })

  it.each([
    ['repo_disabled', 'MERGE_BLOCKED'],
    ['nothing_to_wait_for', 'MERGE_BLOCKED'],
    ['no_permission', 'FORBIDDEN'],
  ] as const)('unavailable (%s) is refused with %s', async (reason, code) => {
    const { provider, autoWrite } = fakeProvider(
      [{}],
      options({ autoMerge: { available: false, reason } }),
    )
    await expect(setAutoMerge(provider, on, accept)).rejects.toMatchObject({ code })
    expect(autoWrite).not.toHaveBeenCalled()
  })

  it('turning it on is refused when the head moved', async () => {
    const { provider, autoWrite } = fakeProvider([{ headSha: MOVED }])
    await expect(setAutoMerge(provider, on, accept)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(autoWrite).not.toHaveBeenCalled()
  })

  it('turns it off, naming who set it; off when already off is a CONFLICT', async () => {
    const current = { setBy: { login: 'grace', displayName: 'Grace Hopper' }, strategy: null }
    const { provider, autoWrite } = fakeProvider([{}], options({ current }))
    const confirm = vi.fn(accept)
    await expect(
      setAutoMerge(provider, { repo, number: 7, enable: false }, confirm),
    ).resolves.toMatchObject({ outcome: 'disabled' })
    expect(confirm.mock.calls[0]?.[0].detail).toContain('Set by Grace Hopper')
    expect(autoWrite).toHaveBeenCalledWith({ repo, number: 7, enable: false })

    const off = fakeProvider()
    await expect(
      setAutoMerge(off.provider, { repo, number: 7, enable: false }, accept),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(off.autoWrite).not.toHaveBeenCalled()
  })

  it('declined: nothing is written', async () => {
    const { provider, autoWrite } = fakeProvider([{}], options({ blocker: 'checks_pending' }))
    await expect(setAutoMerge(provider, on, decline)).resolves.toEqual({ outcome: 'cancelled' })
    expect(autoWrite).not.toHaveBeenCalled()
  })
})
