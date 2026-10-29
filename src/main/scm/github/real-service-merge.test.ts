/**
 * `RealGithubService` merge / auto-merge over a fake Octokit: what is sent
 * (method, head sha, branch delete, GraphQL inputs) and how GitHub's refusals
 * map to typed codes. Writes are only recorded, never sent.
 */
import { describe, expect, it, vi } from 'vitest'
import { githubRepo } from '../../../shared/scm-guards'
import type { MergeWrite } from '../provider'
import { RealGithubService, mapGithubMergeError, type GithubClient } from './real-service'

const repo = githubRepo('acme', 'api')
const HEAD = 'a'.repeat(40)

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status, response: { data: { message }, headers: {} } })
}

function fakeClient(options: { mergeError?: unknown; deleteError?: unknown } = {}) {
  const graphql = vi.fn(async (query: string, _vars?: Record<string, unknown>) => {
    const op = /(query|mutation)\s+(\w+)/.exec(query)?.[2]
    if (op === 'PullRequestMergeOptions') {
      return {
        repository: {
          mergeCommitAllowed: true,
          squashMergeAllowed: false,
          rebaseMergeAllowed: true,
          autoMergeAllowed: true,
          deleteBranchOnMerge: false,
          viewerPermission: 'WRITE',
          pullRequest: {
            state: 'OPEN',
            isDraft: false,
            headRefOid: HEAD,
            isCrossRepository: false,
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'BLOCKED',
            reviewDecision: 'APPROVED',
            viewerCanEnableAutoMerge: true,
            autoMergeRequest: null,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
          },
        },
      }
    }
    return {}
  })
  const merge = vi.fn(async () => {
    if (options.mergeError) throw options.mergeError
    return { data: { merged: true } }
  })
  const deleteRef = vi.fn(async () => {
    if (options.deleteError) throw options.deleteError
    return { data: {} }
  })
  const get = vi.fn(async () => ({ data: { node_id: 'PR_node' } }))
  const client = {
    graphql,
    rest: { pulls: { merge, get }, git: { deleteRef } },
    request: vi.fn(),
  } as unknown as GithubClient
  return { client, graphql, merge, deleteRef }
}

const write: MergeWrite = {
  repo,
  number: 7,
  headSha: HEAD,
  sourceBranch: 'feature/x',
  strategy: 'rebase',
  deleteSourceBranch: true,
  transitionWorkItems: false,
}

function service(client: GithubClient): RealGithubService {
  return new RealGithubService(
    () => 'token',
    () => client,
  )
}

describe('RealGithubService merge', () => {
  it('reads merge options with the merge-info preview header', async () => {
    const fake = fakeClient()
    const options = await service(fake.client).getMergeOptions(repo, 7)
    expect(options.blocker).toBe('checks_pending')
    expect(options.autoMerge).toEqual({ available: true })
    expect(options.strategies.find((item) => item.strategy === 'squash')?.allowed).toBe(false)
    expect(fake.graphql.mock.calls[0]?.[1]).toMatchObject({
      headers: { accept: 'application/vnd.github.merge-info-preview+json' },
    })
  })

  it('merges with the reviewed sha and method, then deletes the head branch', async () => {
    const fake = fakeClient()
    await expect(service(fake.client).mergePullRequest(write)).resolves.toEqual({ completed: true })
    expect(fake.merge).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'api',
      pull_number: 7,
      sha: HEAD,
      merge_method: 'rebase',
    })
    expect(fake.deleteRef).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', ref: 'heads/feature/x' })
  })

  it('a failed branch delete keeps the merge and says so', async () => {
    const fake = fakeClient({ deleteError: httpError(422, 'Reference does not exist') })
    await expect(service(fake.client).mergePullRequest(write)).resolves.toEqual({
      completed: true,
      branchDeleteFailed: true,
    })
  })

  it('never sends semi-linear merge to GitHub', async () => {
    const fake = fakeClient()
    await expect(
      service(fake.client).mergePullRequest({ ...write, strategy: 'rebase_merge' }),
    ).rejects.toMatchObject({ code: 'MERGE_BLOCKED' })
    expect(fake.merge).not.toHaveBeenCalled()
  })

  it('enables auto-merge with the method and expectedHeadOid; disables it', async () => {
    const fake = fakeClient()
    const github = service(fake.client)
    await github.setAutoMerge({
      repo,
      number: 7,
      enable: true,
      headSha: HEAD,
      strategy: 'merge',
      deleteSourceBranch: false,
      transitionWorkItems: false,
    })
    expect(fake.graphql).toHaveBeenLastCalledWith(expect.stringContaining('enablePullRequestAutoMerge'), {
      pullRequestId: 'PR_node',
      mergeMethod: 'MERGE',
      expectedHeadOid: HEAD,
    })
    await github.setAutoMerge({ repo, number: 7, enable: false })
    expect(fake.graphql).toHaveBeenLastCalledWith(expect.stringContaining('disablePullRequestAutoMerge'), {
      pullRequestId: 'PR_node',
    })
  })
})

describe('mapGithubMergeError', () => {
  it.each([
    [httpError(409, 'Head branch was modified. Review and try the merge again.'), 'CONFLICT'],
    [httpError(405, 'Pull Request is not mergeable'), 'MERGE_BLOCKED'],
    [httpError(405, 'Merge conflict'), 'MERGE_CONFLICT'],
    [httpError(422, 'Required status check "ci" is expected.'), 'MERGE_BLOCKED'],
    [httpError(403, 'Resource not accessible by integration'), 'FORBIDDEN'],
    [Object.assign(new Error('x'), { errors: [{ type: 'UNPROCESSABLE', message: 'Pull request is in clean status' }] }), 'MERGE_BLOCKED'],
  ])('%s -> %s', (error, code) => {
    expect(mapGithubMergeError(error, 'acme/api').code).toBe(code)
  })

  it("keeps GitHub's one-line reason in the message", () => {
    const mapped = mapGithubMergeError(httpError(405, 'Pull Request is not mergeable'), 'acme/api')
    expect(mapped.message).toContain('Pull Request is not mergeable')
  })
})
