import { describe, expect, it } from 'vitest'
import type { AzureRepoRef } from '../../../shared/scm'
import type { AzChangeEntry, AzPullRequest, AzThread } from './api-types'
import {
  isThreadOutdated,
  mapChangeEntry,
  mapChangeStatus,
  mapCiStatus,
  mapPrState,
  mapPullRequestSummary,
  mapReviewDecision,
  mapReviewer,
  mapThread,
  mapThreadStatus,
  mapVote,
  threadAnchor,
  threadStatusToAzure,
  toAzurePath,
} from './mappers'

const azRepo: AzureRepoRef = {
  provider: 'azure',
  organization: 'Contoso',
  project: 'Platform',
  name: 'orders api',
  repositoryId: 'repo-guid',
  fullName: 'Contoso/Platform/orders api',
}

const repository = {
  id: 'repo-guid',
  name: 'orders api',
  project: { id: 'p', name: 'Platform' },
}

function rawPr(overrides: Partial<AzPullRequest> = {}): AzPullRequest {
  return {
    pullRequestId: 42,
    status: 'active',
    title: 'Add things',
    createdBy: { id: 'u1', displayName: 'Ada', uniqueName: 'ada@contoso.example' },
    creationDate: '2026-10-01T00:00:00Z',
    sourceRefName: 'refs/heads/feature/x',
    targetRefName: 'refs/heads/main',
    isDraft: true,
    lastMergeSourceCommit: { commitId: 'abc123' },
    reviewers: [
      {
        id: 'u2',
        displayName: 'Grace',
        uniqueName: 'grace@contoso.example',
        vote: -5,
        isRequired: true,
      },
      { id: 't1', displayName: 'Team', vote: 0, isContainer: true },
    ],
    repository,
    ...overrides,
  }
}

describe('mapPullRequestSummary', () => {
  it('maps the neutral summary fields', () => {
    const pr = mapPullRequestSummary(rawPr(), 'Contoso')
    expect(pr).toEqual({
      id: 'azure:contoso/platform/repo-guid#42',
      number: 42,
      title: 'Add things',
      author: { login: 'ada@contoso.example', displayName: 'Ada' },
      repo: {
        provider: 'azure',
        organization: 'Contoso',
        project: 'Platform',
        name: 'orders api',
        repositoryId: 'repo-guid',
        fullName: 'Contoso/Platform/orders api',
      },
      state: 'open',
      isDraft: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      headRef: 'feature/x',
      baseRef: 'main',
      headSha: 'abc123',
      webUrl: 'https://dev.azure.com/Contoso/Platform/_git/orders%20api/pullrequest/42',
      commentCount: null,
      reviewDecision: 'changes_requested',
      ciStatus: null,
      additions: null,
      deletions: null,
      changedFiles: null,
    })
  })

  it('maps reviewers to the neutral shape (no avatar URL: Azure avatars need the credential)', () => {
    const [grace, team] = (rawPr().reviewers ?? []).map(mapReviewer)
    expect(grace).toEqual({
      user: { login: 'grace@contoso.example', displayName: 'Grace' },
      vote: 'changes_requested',
      isRequired: true,
    })
    expect(team).toEqual({
      user: { login: 'Team', displayName: 'Team' },
      vote: 'none',
      isRequired: false,
    })
  })

  it('derives the review decision from votes', () => {
    expect(mapReviewDecision([])).toBeNull()
    expect(mapReviewDecision([{ id: 'a', displayName: 'A', vote: 10 }])).toBe('approved')
    expect(
      mapReviewDecision([
        { id: 'a', displayName: 'A', vote: 10 },
        { id: 'b', displayName: 'B', vote: 0, isRequired: true },
      ]),
    ).toBe('review_required')
    expect(
      mapReviewDecision([
        { id: 'a', displayName: 'A', vote: 10, isRequired: true },
        { id: 'b', displayName: 'B', vote: -10 },
      ]),
    ).toBe('changes_requested')
  })

  it('derives updatedAt from the latest known activity and maps states', () => {
    const pr = mapPullRequestSummary(
      rawPr({ status: 'completed', closedDate: '2026-10-05T00:00:00Z' }),
      'c',
      ['2026-10-03T00:00:00Z', undefined, 'garbage'],
    )
    expect(pr.updatedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(pr.state).toBe('merged')
    expect(mapPullRequestSummary(rawPr(), 'c', ['2026-10-09T00:00:00Z']).updatedAt).toBe(
      '2026-10-09T00:00:00.000Z',
    )
    // Normalized ISO: the seen-store compares updatedAt as strings.
    expect(mapPullRequestSummary(rawPr(), 'c', ['2026-10-09T00:00:00.5+00:00']).updatedAt).toBe(
      '2026-10-09T00:00:00.500Z',
    )
    expect(mapPrState('abandoned')).toBe('closed')
    expect(mapPullRequestSummary(rawPr({ lastMergeSourceCommit: undefined }), 'c').headSha).toBe('')
  })
})

describe('votes and statuses', () => {
  it('maps every Azure vote', () => {
    expect([10, 5, 0, -5, -10].map(mapVote)).toEqual([
      'approved',
      'approved_with_suggestions',
      'none',
      'changes_requested',
      'rejected',
    ])
  })

  it('round-trips thread statuses', () => {
    for (const status of ['active', 'pending', 'fixed', 'wontFix', 'closed', 'byDesign'] as const) {
      expect(threadStatusToAzure(mapThreadStatus(status))).toBe(status)
    }
    expect(mapThreadStatus(undefined)).toBe('active')
    expect(mapThreadStatus('unknown')).toBe('active')
  })
})

describe('mapThread', () => {
  const base: AzThread = {
    id: 9,
    publishedDate: '2026-10-01T00:00:00Z',
    lastUpdatedDate: '2026-10-02T00:00:00Z',
    status: 'fixed',
    threadContext: {
      filePath: '/src/a.ts',
      rightFileStart: { line: 10, offset: 1 },
      rightFileEnd: { line: 12, offset: 5 },
    },
    pullRequestThreadContext: {
      changeTrackingId: 3,
      iterationContext: { firstComparingIteration: 1, secondComparingIteration: 2 },
    },
    comments: [
      {
        id: 1,
        parentCommentId: 0,
        author: { id: 'u', displayName: 'U' },
        content: 'Hi',
        publishedDate: '2026-10-01T00:00:00Z',
        commentType: 'text',
      },
      {
        id: 2,
        parentCommentId: 1,
        author: { id: 'u', displayName: 'U' },
        content: 'gone',
        publishedDate: '2026-10-01T00:00:00Z',
        commentType: 'text',
        isDeleted: true,
      },
      {
        id: 3,
        parentCommentId: 1,
        author: { id: 'v', displayName: 'V' },
        content: 'Reply',
        publishedDate: '2026-10-02T00:00:00Z',
        commentType: 'text',
      },
    ],
  }

  it('maps a line thread to the neutral shape, with its anchor', () => {
    expect(mapThread(base, azRepo, 42)).toEqual({
      id: '9',
      status: 'resolved',
      isResolved: true,
      isLineThread: true,
      path: 'src/a.ts',
      line: 10,
      lineEnd: 12,
      side: 'RIGHT',
      comments: [
        {
          id: '9/1',
          author: { login: 'U', displayName: 'U' },
          bodyMarkdown: 'Hi',
          createdAt: '2026-10-01T00:00:00.000Z',
          isMinimized: false,
          htmlUrl:
            'https://dev.azure.com/Contoso/Platform/_git/orders%20api/pullrequest/42?discussionId=9',
        },
        expect.objectContaining({ id: '9/3', bodyMarkdown: 'Reply' }),
      ],
    })
    expect(threadAnchor(base)).toEqual({
      iteration: { first: 1, second: 2 },
      changeTrackingId: 3,
      tracked: false,
    })
  })

  it('maps LEFT, file-level and PR-level threads', () => {
    const left = mapThread(
      { ...base, threadContext: { filePath: '/a', leftFileStart: { line: 4, offset: 1 } } },
      azRepo,
      1,
    )
    expect(left).toMatchObject({ side: 'LEFT', line: 4 })
    expect(left?.lineEnd).toBeUndefined()
    const fileLevel = mapThread({ ...base, threadContext: { filePath: '/a' } }, azRepo, 1)
    expect(fileLevel).toMatchObject({ isLineThread: false, path: 'a' })
    expect(fileLevel?.line).toBeUndefined()
    const prLevel = mapThread(
      { ...base, threadContext: null, pullRequestThreadContext: null },
      azRepo,
      1,
    )
    expect(prLevel?.path).toBeUndefined()
    expect(threadAnchor({ ...base, pullRequestThreadContext: null })).toEqual({
      iteration: null,
      changeTrackingId: null,
      tracked: false,
    })
  })

  it('drops system and deleted threads', () => {
    const system = {
      ...base,
      comments: base.comments.map((c) => ({ ...c, commentType: 'system' as const })),
    }
    expect(mapThread(system, azRepo, 1)).toBeNull()
    expect(mapThread({ ...base, isDeleted: true }, azRepo, 1)).toBeNull()
  })

  it('marks a line thread outdated only when older AND not re-tracked (or its file left the diff)', () => {
    const thread = mapThread(base, azRepo, 1)
    if (!thread) throw new Error('expected a thread')
    const anchor = threadAnchor(base)
    const paths = new Set(['src/a.ts'])
    // Created on iteration 2, latest is 2: trusted.
    expect(isThreadOutdated(thread, anchor, 2, paths)).toBe(false)
    // Latest is 3 and the server did not re-track it: outdated.
    expect(isThreadOutdated(thread, anchor, 3, paths)).toBe(true)
    // Re-tracked by the server onto iteration 3: trusted.
    expect(isThreadOutdated(thread, { ...anchor, tracked: true }, 3, paths)).toBe(false)
    // Re-tracked, but the file is no longer in the latest diff: outdated.
    expect(isThreadOutdated(thread, { ...anchor, tracked: true }, 3, new Set(['b.ts']))).toBe(true)
    // PR-level threads are never outdated.
    const general = mapThread({ ...base, threadContext: null }, azRepo, 1)
    if (!general) throw new Error('expected a thread')
    expect(isThreadOutdated(general, anchor, 9, paths)).toBe(false)
  })
})

describe('ci status', () => {
  const status = (
    id: number,
    state: 'succeeded' | 'failed' | 'pending',
    date: string,
    name = 'build',
  ) => ({
    id,
    state,
    context: { name, genre: 'ci' },
    creationDate: date,
  })
  const evaluation = (
    status: 'approved' | 'rejected' | 'running',
    typeName: string,
    isBlocking = true,
  ) => ({
    evaluationId: typeName + status,
    status,
    configuration: { id: 1, isBlocking, isEnabled: true, type: { id: 't', displayName: typeName } },
  })

  it('keeps the latest status per context and lets failure beat pending beat success', () => {
    expect(mapCiStatus([], [])).toBeNull()
    expect(
      mapCiStatus(
        [
          status(1, 'failed', '2026-10-01T00:00:00Z'),
          status(2, 'succeeded', '2026-10-02T00:00:00Z'),
        ],
        [],
      ),
    ).toBe('success')
    expect(
      mapCiStatus(
        [
          status(1, 'succeeded', '2026-10-01T00:00:00Z'),
          status(2, 'pending', '2026-10-01T00:00:00Z', 'lint'),
        ],
        [],
      ),
    ).toBe('pending')
    expect(
      mapCiStatus(
        [status(1, 'succeeded', '2026-10-01T00:00:00Z')],
        [evaluation('rejected', 'Build')],
      ),
    ).toBe('failure')
  })

  it('ignores non-CI and non-blocking policies', () => {
    expect(mapCiStatus([], [evaluation('rejected', 'Minimum number of reviewers')])).toBeNull()
    expect(mapCiStatus([], [evaluation('rejected', 'Build', false)])).toBeNull()
    expect(mapCiStatus([], [evaluation('running', 'Status')])).toBe('pending')
  })
})

describe('changes', () => {
  const entry = (changeType: string, item: Partial<AzChangeEntry['item']> = {}): AzChangeEntry => ({
    changeTrackingId: 1,
    changeId: 1,
    changeType,
    item: { path: '/x/y.ts', objectId: 'h', originalObjectId: 'b', ...item },
  })

  it('converts paths both ways', () => {
    expect(toAzurePath('src/a.ts')).toBe('/src/a.ts')
    expect(toAzurePath('/src/a.ts')).toBe('/src/a.ts')
  })

  it('maps change types', () => {
    expect(mapChangeStatus('edit')).toBe('modified')
    expect(mapChangeStatus('add')).toBe('added')
    expect(mapChangeStatus('delete')).toBe('removed')
    expect(mapChangeStatus('edit, rename')).toBe('renamed')
    expect(mapChangeStatus('sourceRename')).toBe('renamed')
  })

  it('maps entries and drops folders', () => {
    expect(mapChangeEntry(entry('add', { originalObjectId: undefined }))).toMatchObject({
      path: 'x/y.ts',
      status: 'added',
      baseObjectId: null,
      headObjectId: 'h',
    })
    expect(
      mapChangeEntry(entry('delete', { objectId: 'old', originalObjectId: undefined })),
    ).toMatchObject({
      status: 'removed',
      baseObjectId: 'old',
      headObjectId: null,
    })
    expect(mapChangeEntry({ ...entry('rename'), originalPath: '/x/old.ts' })?.previousPath).toBe(
      'x/old.ts',
    )
    expect(mapChangeEntry(entry('edit', { isFolder: true }))).toBeNull()
  })
})
