import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMainLocale } from '../i18n'
import type { AzureRepoRef } from '../../shared/scm'
import { githubRepo } from '../../shared/scm-guards'
import type { PullRequestDetail, SubmitReviewRequest } from '../../shared/types'
import type { ConfirmFn } from './confirm'
import type { ReviewWrite, ReviewWriteResult } from './provider'
import { submitReview, type ReviewCapable } from './review'

const repo = githubRepo('acme', 'api')
const az: AzureRepoRef = {
  provider: 'azure',
  organization: 'contoso',
  project: 'Platform',
  name: 'orders-api',
  repositoryId: '11111111-1111-4111-8111-111111111111',
  fullName: 'contoso/Platform/orders-api',
}
const HEAD = 'a'.repeat(40)
const MOVED = 'b'.repeat(40)

/** `details` are answered in order (validate, re-check, after the write); the last one repeats. */
function fakeProvider(
  details: Partial<PullRequestDetail>[] = [{}],
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
      viewer: { isAuthor: false, reviewer: 'required', vote: 'none' },
      ...detail,
    } as PullRequestDetail
  })
  const write = vi.fn(async (_req: ReviewWrite): Promise<ReviewWriteResult> => ({}))
  const provider: ReviewCapable = { getPullRequestDetail, submitReview: write }
  return { provider, write, getPullRequestDetail }
}

const approve: SubmitReviewRequest = {
  repo,
  number: 7,
  expectedHeadSha: HEAD,
  verdict: 'approved',
  body: '  Looks good.  ',
}
const accept: ConfirmFn = async () => true
const decline: ConfirmFn = async () => false

describe('submitReview', () => {
  it('approve: confirms with the facts main read, re-checks, then writes at the reviewed head', async () => {
    const { provider, write } = fakeProvider([
      {},
      {},
      {
        reviewDecision: 'approved',
        viewer: { isAuthor: false, reviewer: 'required', vote: 'approved' },
      },
    ])
    const confirm = vi.fn(accept)
    await expect(submitReview(provider, approve, confirm)).resolves.toMatchObject({
      outcome: 'submitted',
      pr: { viewer: { vote: 'approved' } },
    })
    expect(confirm).toHaveBeenCalledWith({
      message: 'Approve PR #7?',
      detail:
        'acme/api\nAdd refunds\nfeature/refunds → main\nReviewed head aaaaaaa\n' +
        'Summary (11 chars): Looks good.',
      confirmLabel: 'Approve',
    })
    expect(write).toHaveBeenCalledWith({
      repo,
      number: 7,
      headSha: HEAD,
      verdict: 'approved',
      body: 'Looks good.',
    })
  })

  it('declined: nothing is written', async () => {
    const { provider, write } = fakeProvider()
    await expect(submitReview(provider, approve, decline)).resolves.toEqual({
      outcome: 'cancelled',
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('a plain comment needs no dialog (it is just a comment)', async () => {
    const { provider, write } = fakeProvider()
    const confirm = vi.fn(accept)
    await submitReview(provider, { ...approve, verdict: 'comment', body: 'Some notes' }, confirm)
    expect(confirm).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'comment', body: 'Some notes' }),
    )
  })

  it('a head that moved before the dialog is a CONFLICT, and nothing is asked', async () => {
    const { provider, write } = fakeProvider([{ headSha: MOVED }])
    const confirm = vi.fn(accept)
    await expect(submitReview(provider, approve, confirm)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/.*head is now bbbbbbb, you reviewed aaaaaaa/),
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('a head that moved while the dialog was open is a CONFLICT, and nothing is written', async () => {
    const { provider, write } = fakeProvider([{}, { headSha: MOVED }])
    await expect(submitReview(provider, approve, accept)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('a closed PR is a CONFLICT', async () => {
    const { provider, write } = fakeProvider([{ state: 'merged' }])
    await expect(submitReview(provider, approve, accept)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/Pull request #7 is no longer open/),
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('GitHub: no vote on your own PR (FORBIDDEN), but a comment is fine', async () => {
    const own = { viewer: { isAuthor: true, reviewer: null } } as Partial<PullRequestDetail>
    const { provider, write } = fakeProvider([own])
    await expect(submitReview(provider, approve, accept)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      submitReview(provider, { ...approve, verdict: 'changes_requested', body: 'x' }, accept),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(write).not.toHaveBeenCalled()
    await submitReview(provider, { ...approve, verdict: 'comment', body: 'Note' }, accept)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a summary is required for a comment and for GitHub "request changes"', async () => {
    const { provider, write } = fakeProvider()
    await expect(
      submitReview(provider, { ...approve, verdict: 'comment', body: '   ' }, accept),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/This review needs a summary/),
    })
    await expect(
      submitReview(provider, { ...approve, verdict: 'changes_requested', body: '' }, accept),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/needs a summary/) })
    // Approve needs none.
    await submitReview(provider, { ...approve, body: '' }, accept)
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'approved', body: '' }))
  })

  it('GitHub has no "approve with suggestions" or "reject"', async () => {
    const { provider, write } = fakeProvider()
    for (const verdict of ['approved_with_suggestions', 'rejected'] as const) {
      await expect(submitReview(provider, { ...approve, verdict }, accept)).rejects.toMatchObject({
        code: 'CONFLICT',
      })
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('Azure: "Wait for author" wording, every vote, the author may vote, no summary needed', async () => {
    const own = { viewer: { isAuthor: true, reviewer: null } } as Partial<PullRequestDetail>
    const { provider, write } = fakeProvider([own], az)
    const confirm = vi.fn(accept)
    await submitReview(
      provider,
      { ...approve, repo: az, verdict: 'changes_requested', body: '' },
      confirm,
    )
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Vote "Wait for author" on PR #7?',
        confirmLabel: 'Wait for author',
        detail: expect.stringContaining('No summary'),
      }),
    )
    await submitReview(provider, { ...approve, repo: az, verdict: 'rejected', body: '' }, accept)
    await submitReview(
      provider,
      { ...approve, repo: az, verdict: 'approved_with_suggestions', body: '' },
      accept,
    )
    expect(write.mock.calls.map(([call]) => call.verdict)).toEqual([
      'changes_requested',
      'rejected',
      'approved_with_suggestions',
    ])
  })

  it('Azure: a summary that failed after the vote is reported, not thrown', async () => {
    const { provider, write } = fakeProvider([{}], az)
    write.mockResolvedValueOnce({ summaryFailed: true })
    await expect(submitReview(provider, { ...approve, repo: az }, accept)).resolves.toMatchObject({
      outcome: 'submitted',
      summaryFailed: true,
    })
  })

  it('sanitizes the summary in the dialog (no bidi overrides, capped)', async () => {
    const { provider } = fakeProvider()
    const confirm = vi.fn(accept)
    await submitReview(provider, { ...approve, body: 'ok‮evil\n' + 'x'.repeat(400) }, confirm)
    const detail = confirm.mock.calls[0]![0].detail
    expect(detail).not.toContain('‮')
    expect(detail.split('\n').at(-1)!.length).toBeLessThanOrEqual(
      'Summary (408 chars): '.length + 160,
    )
    expect(detail).toContain('Summary (408 chars): ')
  })

  it('a failed read after the write still reports the review as submitted (no double submit)', async () => {
    const { provider, getPullRequestDetail } = fakeProvider()
    const open = {
      repo,
      number: 7,
      title: 'Add refunds',
      state: 'open',
      baseRef: 'main',
      headRef: 'feature/refunds',
      headSha: HEAD,
    } as PullRequestDetail
    getPullRequestDetail
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(open)
      .mockRejectedValueOnce(new Error('network down'))
    await expect(submitReview(provider, approve, accept)).resolves.toEqual({ outcome: 'submitted' })
  })

  describe('in Spanish', () => {
    afterEach(() => setMainLocale('en'))

    it('asks in the UI language', async () => {
      setMainLocale('es')
      const { provider } = fakeProvider()
      const confirm = vi.fn(accept)
      await submitReview(provider, approve, confirm)
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: '¿Aprobar el PR #7?', confirmLabel: 'Aprobar' }),
      )
    })
  })
})
