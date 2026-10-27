import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMainLocale } from '../i18n'
import { githubRepo } from '../../shared/scm-guards'
import type { PullRequestDetail, PullRequestSummary } from '../../shared/types'
import type { ConfirmFn } from './confirm'
import { retargetPullRequest, type RetargetCapable } from './retarget'

const repo = githubRepo('acme', 'api')

function fakeProvider(
  detail: Partial<PullRequestDetail>,
  branches: string[] = ['main', 'develop'],
) {
  const updatePullRequestBase = vi.fn(
    async (_repo: unknown, number: number, newBase: string) =>
      ({ number, baseRef: newBase }) as PullRequestSummary,
  )
  const getPullRequestDetail = vi.fn(
    async () =>
      ({
        repo,
        number: 7,
        title: 'Child PR',
        state: 'open',
        baseRef: 'feature/parent',
        headRef: 'feature/child',
        ...detail,
      }) as PullRequestDetail,
  )
  const provider: RetargetCapable = {
    getPullRequestDetail,
    branchExists: vi.fn(async (_repo, branch: string) => branches.includes(branch)),
    updatePullRequestBase,
  }
  return { provider, updatePullRequestBase, getPullRequestDetail }
}

const req = { repo, number: 7, expectedCurrentBase: 'feature/parent', newBase: 'main' }
const accept: ConfirmFn = async () => true

describe('retargetPullRequest', () => {
  it('re-validates, confirms with the facts it read, then writes the new base', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({})
    const confirm = vi.fn(accept)
    await expect(retargetPullRequest(provider, req, confirm)).resolves.toMatchObject({
      outcome: 'retargeted',
      pr: { baseRef: 'main' },
    })
    expect(updatePullRequestBase).toHaveBeenCalledWith(repo, 7, 'main')
    expect(confirm).toHaveBeenCalledWith({
      message: 'Retarget PR #7?',
      detail: 'Repository: acme/api\nTitle: Child PR\n\nBase branch: feature/parent → main',
      confirmLabel: 'Retarget',
    })
  })

  describe('in Spanish', () => {
    afterEach(() => setMainLocale('en'))

    it('the dialog and the CONFLICT messages follow the UI language', async () => {
      setMainLocale('es')
      const { provider } = fakeProvider({})
      const confirm = vi.fn(accept)
      await retargetPullRequest(provider, req, confirm)
      expect(confirm).toHaveBeenCalledWith({
        message: '¿Cambiar la rama base del PR #7?',
        detail: 'Repositorio: acme/api\nTítulo: Child PR\n\nRama base: feature/parent → main',
        confirmLabel: 'Cambiar base',
      })
      await expect(
        retargetPullRequest(fakeProvider({ state: 'closed' }).provider, req, accept),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'El pull request #7 ya no está abierto.',
      })
    })
  })

  it('answers cancelled and never writes when the user declines', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({})
    await expect(retargetPullRequest(provider, req, async () => false)).resolves.toEqual({
      outcome: 'cancelled',
    })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('does not ask when a pre-check fails', async () => {
    const { provider } = fakeProvider({}, ['develop'])
    const confirm = vi.fn(accept)
    await expect(retargetPullRequest(provider, req, confirm)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('re-checks the base after the dialog: a retarget while it was open is a CONFLICT', async () => {
    const { provider, updatePullRequestBase, getPullRequestDetail } = fakeProvider({})
    const confirm: ConfirmFn = async () => {
      getPullRequestDetail.mockResolvedValue({
        repo,
        number: 7,
        title: 'Child PR',
        state: 'open',
        baseRef: 'develop',
        headRef: 'feature/child',
      } as PullRequestDetail)
      return true
    }
    await expect(retargetPullRequest(provider, req, confirm)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('now targets develop'),
    })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('re-checks the state after the dialog: merged meanwhile is a CONFLICT', async () => {
    const { provider, updatePullRequestBase, getPullRequestDetail } = fakeProvider({})
    const confirm: ConfirmFn = async () => {
      getPullRequestDetail.mockResolvedValue({
        repo,
        number: 7,
        state: 'merged',
        baseRef: 'feature/parent',
        headRef: 'feature/child',
      } as PullRequestDetail)
      return true
    }
    await expect(retargetPullRequest(provider, req, confirm)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('sanitizes the untrusted title in the dialog (bidi overrides, newlines, length)', async () => {
    const { provider } = fakeProvider({ title: 'Evil‮\nmain → prod' + 'x'.repeat(300) })
    const confirm = vi.fn<ConfirmFn>(async () => false)
    await retargetPullRequest(provider, req, confirm)
    const detail = confirm.mock.calls[0][0].detail
    expect(detail).not.toMatch(/[‮]/)
    expect(detail.split('\n')[1]).toMatch(/^Title: Evil main → prodx+…$/)
    expect(detail.split('\n')[1].length).toBeLessThanOrEqual('Title: '.length + 200)
  })

  it('refuses with CONFLICT when the base moved since the UI read it', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({ baseRef: 'refs/heads/develop' })
    await expect(retargetPullRequest(provider, req, accept)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('now targets develop'),
    })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('refuses with CONFLICT when the PR is no longer open', async () => {
    for (const state of ['merged', 'closed'] as const) {
      const { provider, updatePullRequestBase } = fakeProvider({ state })
      await expect(retargetPullRequest(provider, req, accept)).rejects.toMatchObject({
        code: 'CONFLICT',
      })
      expect(updatePullRequestBase).not.toHaveBeenCalled()
    }
  })

  it('refuses its own head branch and a no-op', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({}, ['feature/child', 'main'])
    await expect(
      retargetPullRequest(provider, { ...req, newBase: 'feature/child' }, accept),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      retargetPullRequest(provider, { ...req, newBase: 'feature/parent' }, accept),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })

  it('refuses a new base that does not exist with NOT_FOUND', async () => {
    const { provider, updatePullRequestBase } = fakeProvider({}, ['develop'])
    await expect(retargetPullRequest(provider, req, accept)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(updatePullRequestBase).not.toHaveBeenCalled()
  })
})
