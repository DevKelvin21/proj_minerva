import { describe, expect, it } from 'vitest'
import type { AzChangeEntry, AzPullRequest, AzThread } from './api-types'
import {
  mapChangeEntry,
  mapChangeStatus,
  mapPrState,
  mapPullRequestSummary,
  mapThread,
  mapThreadStatus,
  mapVote,
  threadStatusToAzure,
} from './mappers'

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
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      headRef: 'feature/x',
      baseRef: 'main',
      headSha: 'abc123',
      webUrl: 'https://dev.azure.com/Contoso/Platform/_git/orders%20api/pullrequest/42',
      reviewers: [
        {
          login: 'grace@contoso.example',
          displayName: 'Grace',
          id: 'u2',
          vote: 'changes_requested',
          isRequired: true,
          isGroup: false,
        },
        {
          login: 'Team',
          displayName: 'Team',
          id: 't1',
          vote: 'none',
          isRequired: false,
          isGroup: true,
        },
      ],
    })
  })

  it('derives updatedAt from the latest known activity and maps states', () => {
    const pr = mapPullRequestSummary(
      rawPr({ status: 'completed', closedDate: '2026-10-05T00:00:00Z' }),
      'c',
      ['2026-10-03T00:00:00Z', undefined, 'garbage'],
    )
    expect(pr.updatedAt).toBe('2026-10-05T00:00:00Z')
    expect(pr.state).toBe('merged')
    expect(mapPullRequestSummary(rawPr(), 'c', ['2026-10-09T00:00:00Z']).updatedAt).toBe(
      '2026-10-09T00:00:00Z',
    )
    expect(mapPrState('abandoned')).toBe('closed')
    expect(
      mapPullRequestSummary(rawPr({ lastMergeSourceCommit: undefined }), 'c').headSha,
    ).toBeNull()
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

  it('maps a line thread with its iteration context', () => {
    expect(mapThread(base)).toMatchObject({
      id: 9,
      status: 'resolved',
      isLineThread: true,
      path: 'src/a.ts',
      line: 10,
      lineEnd: 12,
      side: 'RIGHT',
      iteration: { first: 1, second: 2 },
      changeTrackingId: 3,
      updatedAt: '2026-10-02T00:00:00Z',
    })
    expect(mapThread(base)?.comments.map((c) => [c.id, c.parentId])).toEqual([
      [1, null],
      [3, 1],
    ])
  })

  it('maps LEFT, file-level and PR-level threads', () => {
    const left = mapThread({
      ...base,
      threadContext: { filePath: '/a', leftFileStart: { line: 4, offset: 1 } },
    })
    expect(left).toMatchObject({ side: 'LEFT', line: 4, lineEnd: 4 })
    const fileLevel = mapThread({ ...base, threadContext: { filePath: '/a' } })
    expect(fileLevel).toMatchObject({ isLineThread: false, path: 'a', line: null, side: null })
    const prLevel = mapThread({ ...base, threadContext: null, pullRequestThreadContext: null })
    expect(prLevel).toMatchObject({ path: null, iteration: null, changeTrackingId: null })
  })

  it('drops system and deleted threads', () => {
    const system = {
      ...base,
      comments: base.comments.map((c) => ({ ...c, commentType: 'system' as const })),
    }
    expect(mapThread(system)).toBeNull()
    expect(mapThread({ ...base, isDeleted: true })).toBeNull()
  })
})

describe('changes', () => {
  const entry = (changeType: string, item: Partial<AzChangeEntry['item']> = {}): AzChangeEntry => ({
    changeTrackingId: 1,
    changeId: 1,
    changeType,
    item: { path: '/x/y.ts', objectId: 'h', originalObjectId: 'b', ...item },
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
