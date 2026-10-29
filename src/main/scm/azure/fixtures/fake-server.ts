/**
 * In-memory fake of the Azure DevOps REST API, served from the mock universe
 * (`./universe.ts`) through a `fetch` function. The mock provider
 * (`MINERVA_MOCK=1`) and the provider's unit tests run the REAL
 * `AzureScmProvider` + `AzureDevOpsClient` on top of it, so mock mode
 * exercises the same URLs, paging and mappers as production.
 *
 * Writes (new threads, replies, thread status, retarget, completion,
 * auto-complete) mutate this server's own copy of the universe and nothing
 * else: nothing here ever talks to the network.
 *
 * Only the routes the provider uses exist; anything else is a 404, which
 * keeps tests honest about new endpoints.
 */
import type {
  AzComment,
  AzIdentityRef,
  AzIteration,
  AzPolicyEvaluation,
  AzPullRequest,
  AzPullRequestStatusEntry,
  AzThread,
} from '../api-types'
import {
  BRANCHES,
  CHANGES,
  ITERATIONS,
  MOCK_ME,
  MOCK_ORG,
  MOCK_PROJECT,
  PEOPLE,
  PULL_REQUESTS,
  REPOS,
  THREADS,
  getMockBlob,
} from './universe'

export interface FakeAzureServerOptions {
  /** Simulated latency per request (ms). Default 0. */
  latencyMs?: number
}

export interface FakeRequestLogEntry {
  method: string
  /** Path without the query string, decoded. */
  path: string
  query: Record<string, string>
  body?: unknown
}

export interface FakeAzureServer {
  fetch: typeof fetch
  /** Every request served, in order (tests assert on writes). */
  log: FakeRequestLogEntry[]
  /** Files of the repo at a head commit, for the cheap mock snapshot. */
  snapshotFiles(repositoryId: string, commitId: string): { path: string; content: Buffer }[]
  /** Current (mutated) PR, for tests. */
  pullRequest(id: number): AzPullRequest | undefined
}

const README =
  '# Contoso mock repository\n\nServed by the Minerva Azure DevOps mock (fixtures/universe.ts).\n'

/** Statuses (CI) per PR id. */
const STATUSES: Record<number, AzPullRequestStatusEntry[]> = {
  101: [
    {
      id: 1,
      state: 'pending',
      description: 'Build queued',
      context: { name: 'build', genre: 'ci' },
      creationDate: '2026-10-10T10:05:00Z',
    },
  ],
  105: [
    {
      id: 1,
      state: 'failed',
      description: 'Migration check failed',
      context: { name: 'db-check', genre: 'ci' },
      creationDate: '2026-10-03T12:10:00Z',
    },
  ],
  108: [
    {
      id: 1,
      state: 'succeeded',
      description: 'Build succeeded',
      context: { name: 'build', genre: 'ci' },
      creationDate: '2026-10-14T08:10:00Z',
    },
  ],
}

/** Linked work items per PR id. */
/** Branch policy evaluations per PR id (`_apis/policy/evaluations?artifactId=…`). */
function policy(
  id: number,
  status: AzPolicyEvaluation['status'],
  typeName: string,
  isBlocking: boolean,
  displayName?: string,
): AzPolicyEvaluation {
  return {
    evaluationId: 'eval-' + id,
    status,
    configuration: {
      id,
      isBlocking,
      isEnabled: true,
      type: { id: 'policy-type-' + id, displayName: typeName },
      ...(displayName ? { settings: { displayName } } : {}),
    },
  }
}

/** "Require a merge strategy" (real type id): storefront-web allows merge, squash and semi-linear. */
const MERGE_STRATEGY_POLICY: AzPolicyEvaluation = {
  evaluationId: 'eval-9',
  status: 'approved',
  configuration: {
    id: 9,
    isBlocking: true,
    isEnabled: true,
    type: { id: 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab', displayName: 'Require a merge strategy' },
    settings: {
      allowNoFastForward: true,
      allowSquash: true,
      allowRebase: false,
      allowRebaseMerge: true,
    },
  },
}

const POLICY_EVALUATIONS: Record<number, AzPolicyEvaluation[]> = {
  101: [
    policy(1, 'running', 'Minimum number of reviewers', true),
    policy(2, 'queued', 'Build', true, 'orders-api CI'),
    policy(3, 'approved', 'Work item linking', true),
    policy(4, 'approved', 'Comment requirements', false),
  ],
  105: [
    policy(1, 'rejected', 'Minimum number of reviewers', true),
    policy(2, 'rejected', 'Build', true, 'orders-api CI'),
  ],
  108: [
    policy(1, 'approved', 'Minimum number of reviewers', true),
    policy(5, 'approved', 'Build', true, 'storefront-web CI'),
    MERGE_STRATEGY_POLICY,
  ],
}

/** Identities a PATCH may name as `autoCompleteSetBy`. */
const IDENTITIES: AzIdentityRef[] = Object.values(PEOPLE)

/** Cleared `autoCompleteSetBy` (Azure DevOps' way to cancel auto-complete). */
const EMPTY_IDENTITY_ID = '00000000-0000-0000-0000-000000000000'

const WORK_ITEMS: Record<number, { id: number; title: string; type: string; state: string }[]> = {
  108: [{ id: 4711, title: 'Cart total is off by a cent', type: 'Bug', state: 'Active' }],
  101: [{ id: 4700, title: 'Checkout v2', type: 'User Story', state: 'Active' }],
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function notFound(what: string): Response {
  return json({ message: 'Not found: ' + what }, 404)
}

function bytes(buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(buffer.length),
    },
  })
}

function stripRefs(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}

export function createFakeAzureServer(options: FakeAzureServerOptions = {}): FakeAzureServer {
  const latency = options.latencyMs ?? 0
  const prs = new Map<number, AzPullRequest>(
    PULL_REQUESTS.map((pr) => [pr.pullRequestId, clone(pr)]),
  )
  const threads = new Map<number, AzThread[]>(
    Object.entries(THREADS).map(([id, list]) => [Number(id), clone(list)]),
  )
  const iterations = new Map<number, AzIteration[]>(
    Object.entries(ITERATIONS).map(([id, list]) => [Number(id), clone(list)]),
  )
  const branches = new Map<string, string[]>(
    Object.entries(BRANCHES).map(([id, list]) => [id, [...list]]),
  )
  const branchesOf = (repoId: string): string[] => branches.get(repoId) ?? []
  const log: FakeRequestLogEntry[] = []
  let clock = Date.parse('2026-10-20T09:00:00Z')
  const tick = (): string => {
    clock += 60_000
    return new Date(clock).toISOString()
  }

  /** commitId -> path -> blob id: head files at the head commit, base files at the target commit. */
  const filesAtCommit = new Map<string, Map<string, string>>()
  const addFile = (commit: string | undefined, path: string, blobId: string | undefined): void => {
    if (!commit || !blobId) return
    const files = filesAtCommit.get(commit) ?? new Map<string, string>()
    files.set(path, blobId)
    filesAtCommit.set(commit, files)
  }
  for (const pr of PULL_REQUESTS) {
    for (const entry of CHANGES[pr.pullRequestId] ?? []) {
      addFile(pr.lastMergeSourceCommit?.commitId, entry.item.path, entry.item.objectId)
      addFile(
        pr.lastMergeTargetCommit?.commitId,
        entry.originalPath ?? entry.item.path,
        entry.item.originalObjectId,
      )
    }
  }
  const repoOfCommit = new Map<string, string>()
  for (const pr of PULL_REQUESTS) {
    for (const commit of [pr.lastMergeSourceCommit?.commitId, pr.lastMergeTargetCommit?.commitId]) {
      if (commit) repoOfCommit.set(commit, pr.repository.id)
    }
  }

  const prInRepo = (repoId: string, id: number): AzPullRequest | undefined => {
    const pr = prs.get(id)
    return pr && pr.repository.id === repoId ? pr : undefined
  }

  const searchPrs = (query: URLSearchParams, repoId?: string): AzPullRequest[] => {
    const status = query.get('searchCriteria.status') ?? 'active'
    const creator = query.get('searchCriteria.creatorId')
    const reviewer = query.get('searchCriteria.reviewerId')
    const source = query.get('searchCriteria.sourceRefName')
    const target = query.get('searchCriteria.targetRefName')
    const top = Number(query.get('$top') ?? '101')
    const skip = Number(query.get('$skip') ?? '0')
    return [...prs.values()]
      .filter((pr) => !repoId || pr.repository.id === repoId)
      .filter((pr) => status === 'all' || pr.status === status)
      .filter((pr) => !creator || pr.createdBy.id === creator)
      .filter((pr) => !reviewer || (pr.reviewers ?? []).some((r) => r.id === reviewer))
      .filter((pr) => !source || pr.sourceRefName === source)
      .filter((pr) => !target || pr.targetRefName === target)
      .sort((a, b) => b.pullRequestId - a.pullRequestId)
      .slice(skip, skip + top)
  }

  const threadById = (prId: number, threadId: number): AzThread | undefined =>
    threads.get(prId)?.find((thread) => thread.id === threadId)

  const comment = (id: number, parent: number, content: string): AzComment => {
    const date = tick()
    return {
      id,
      parentCommentId: parent,
      author: MOCK_ME,
      content,
      publishedDate: date,
      lastUpdatedDate: date,
      lastContentUpdatedDate: date,
      commentType: 'text',
    }
  }

  const handleRepo = (
    method: string,
    repoId: string,
    rest: string[],
    query: URLSearchParams,
    body: unknown,
  ): Response => {
    const [first, second, third, fourth, fifth, sixth] = rest
    const lower = first?.toLowerCase()

    if (lower === 'blobs' && second && method === 'GET') {
      const blob = getMockBlob(second)
      return blob ? bytes(blob) : notFound('blob')
    }
    if (lower === 'items' && method === 'GET') {
      const path = query.get('path') ?? ''
      const version = query.get('versionDescriptor.version') ?? ''
      if (repoOfCommit.get(version) !== repoId) return notFound('commit')
      if (path === 'README.md' || path === '/README.md') return bytes(Buffer.from(README))
      const blobId = filesAtCommit.get(version)?.get(path)
      const blob = blobId ? getMockBlob(blobId) : null
      return blob ? bytes(blob) : notFound('item ' + path)
    }
    if (lower === 'refs' && method === 'GET') {
      const filter = query.get('filter') ?? ''
      const prefix = filter.startsWith('heads/') ? filter.slice('heads/'.length) : filter
      const value = branchesOf(repoId)
        .filter((branch) => branch.startsWith(prefix))
        .map((branch) => ({ name: 'refs/heads/' + branch, objectId: '0'.repeat(40) }))
      return json({ count: value.length, value })
    }
    if (lower !== 'pullrequests') return notFound(rest.join('/'))

    if (!second) {
      return method === 'GET' ? json({ value: searchPrs(query, repoId) }) : notFound('method')
    }
    const prId = Number(second)
    const pr = prInRepo(repoId, prId)
    if (!pr) return notFound('pull request ' + second)

    if (!third) {
      if (method === 'GET') return json(pr)
      if (method === 'PATCH') {
        const patch = body as {
          targetRefName?: unknown
          status?: unknown
          lastMergeSourceCommit?: { commitId?: unknown }
          completionOptions?: AzPullRequest['completionOptions']
          autoCompleteSetBy?: { id?: unknown }
        }
        if (typeof patch.targetRefName === 'string') {
          const branch = stripRefs(patch.targetRefName)
          if (!branchesOf(repoId).includes(branch)) {
            return json({ message: 'TF401398: target branch does not exist' }, 400)
          }
          pr.targetRefName = 'refs/heads/' + branch
        }
        if (patch.autoCompleteSetBy !== undefined) {
          const id = patch.autoCompleteSetBy.id
          if (id === EMPTY_IDENTITY_ID) {
            delete pr.autoCompleteSetBy
          } else {
            const identity = IDENTITIES.find((person) => person.id === id)
            if (!identity) return json({ message: 'TF400813: unknown identity' }, 400)
            pr.autoCompleteSetBy = clone(identity)
          }
          if (patch.completionOptions) pr.completionOptions = clone(patch.completionOptions)
        }
        if (patch.status === 'completed') {
          if (pr.status !== 'active') {
            return json({ message: 'TF401181: the pull request is not active' }, 409)
          }
          if (patch.lastMergeSourceCommit?.commitId !== pr.lastMergeSourceCommit?.commitId) {
            return json({ message: 'TF401192: the source branch was updated' }, 409)
          }
          if (pr.mergeStatus === 'conflicts') {
            return json({ message: 'TF401179: the merge has conflicts' }, 400)
          }
          const pending = (POLICY_EVALUATIONS[prId] ?? []).filter(
            (evaluation) =>
              evaluation.configuration.isEnabled &&
              evaluation.configuration.isBlocking &&
              evaluation.status !== 'approved' &&
              evaluation.status !== 'notApplicable',
          )
          if (pending.length > 0) {
            return json(
              { message: 'TF402455: pushes to this branch are not permitted by a policy' },
              400,
            )
          }
          pr.status = 'completed'
          pr.closedDate = tick()
          pr.completionOptions = clone(patch.completionOptions ?? {})
          delete pr.autoCompleteSetBy
          pr.lastMergeCommit = { commitId: 'f'.repeat(40) }
          if (patch.completionOptions?.deleteSourceBranch) {
            const source = stripRefs(pr.sourceRefName)
            branches.set(
              repoId,
              branchesOf(repoId).filter((branch) => branch !== source),
            )
          }
        }
        return json(pr)
      }
      return notFound('method')
    }

    switch (third.toLowerCase()) {
      case 'iterations': {
        const list = iterations.get(prId) ?? []
        if (!fourth) return json({ count: list.length, value: list })
        if (fifth?.toLowerCase() !== 'changes') return notFound('iteration route')
        const entries = CHANGES[prId] ?? []
        const top = Number(query.get('$top') ?? '100')
        const skip = Number(query.get('$skip') ?? '0')
        const page = entries.slice(skip, skip + top)
        const nextSkip = skip + top < entries.length ? skip + top : 0
        return json(
          nextSkip ? { changeEntries: page, nextSkip, nextTop: top } : { changeEntries: page },
        )
      }
      case 'threads': {
        const list = threads.get(prId) ?? []
        if (!fourth) {
          if (method === 'GET') return json({ count: list.length, value: list })
          if (method === 'POST') {
            const input = body as {
              comments?: { content?: string }[]
              threadContext?: AzThread['threadContext']
              pullRequestThreadContext?: AzThread['pullRequestThreadContext']
            }
            const created: AzThread = {
              id: list.reduce((max, thread) => Math.max(max, thread.id), 0) + 1,
              publishedDate: tick(),
              status: 'active',
              threadContext: input.threadContext ?? null,
              pullRequestThreadContext: input.pullRequestThreadContext ?? null,
              comments: [comment(1, 0, String(input.comments?.[0]?.content ?? ''))],
            }
            created.lastUpdatedDate = created.publishedDate
            list.push(created)
            threads.set(prId, list)
            return json(created)
          }
          return notFound('method')
        }
        const thread = threadById(prId, Number(fourth))
        if (!thread) return notFound('thread ' + fourth)
        if (!fifth) {
          if (method === 'GET') return json(thread)
          if (method === 'PATCH') {
            const input = body as { status?: AzThread['status'] }
            if (input.status) thread.status = input.status
            thread.lastUpdatedDate = tick()
            return json(thread)
          }
          return notFound('method')
        }
        if (fifth.toLowerCase() === 'comments' && !sixth && method === 'POST') {
          const input = body as { content?: string; parentCommentId?: number }
          const created = comment(
            thread.comments.reduce((max, c) => Math.max(max, c.id), 0) + 1,
            input.parentCommentId ?? 0,
            String(input.content ?? ''),
          )
          thread.comments.push(created)
          thread.lastUpdatedDate = created.publishedDate
          return json(created)
        }
        return notFound('thread route')
      }
      case 'statuses':
        return json({ value: STATUSES[prId] ?? [] })
      case 'workitems':
        return json({
          value: (WORK_ITEMS[prId] ?? []).map((item) => ({
            id: String(item.id),
            url: 'https://dev.azure.com/' + MOCK_ORG + '/_apis/wit/workItems/' + item.id,
          })),
        })
      case 'commits': {
        const list = (iterations.get(prId) ?? []).map((iteration) => ({
          commitId: iteration.sourceRefCommit?.commitId ?? '',
        }))
        return json({ count: list.length, value: list })
      }
      default:
        return notFound(third)
    }
  }

  const route = (method: string, url: URL, body: unknown): Response => {
    if (url.hostname !== 'dev.azure.com') return notFound('host')
    const segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
    const [org, ...rest] = segments
    if (org?.toLowerCase() !== MOCK_ORG) return notFound('organization')
    const query = url.searchParams

    if (rest[0] === '_apis') {
      const what = rest.slice(1).join('/').toLowerCase()
      if (what === 'connectiondata') {
        return json({
          authenticatedUser: {
            id: MOCK_ME.id,
            providerDisplayName: MOCK_ME.displayName,
            properties: { Account: { $type: 'System.String', $value: MOCK_ME.uniqueName } },
          },
        })
      }
      if (what === 'projects') {
        return json({ count: 1, value: [{ id: REPOS.api.project.id, name: MOCK_PROJECT }] })
      }
      if (what === 'wit/workitems') {
        const ids = (query.get('ids') ?? '').split(',').map(Number)
        const all = Object.values(WORK_ITEMS).flat()
        const value = ids
          .map((id) => all.find((item) => item.id === id))
          .filter((item) => item !== undefined)
          .map((item) => ({
            id: item.id,
            fields: {
              'System.Title': item.title,
              'System.WorkItemType': item.type,
              'System.State': item.state,
              'System.TeamProject': MOCK_PROJECT,
            },
          }))
        return json({ count: value.length, value })
      }
      return notFound(what)
    }

    const [project, apis, area, kind, repoId, ...repoRest] = rest
    if (project?.toLowerCase() !== MOCK_PROJECT.toLowerCase() || apis !== '_apis') {
      return notFound('project')
    }
    if (area === 'policy' && kind === 'evaluations') {
      // artifactId = vstfs:///CodeReview/CodeReviewId/{projectId}/{pullRequestId}
      const prId = Number((query.get('artifactId') ?? '').split('/').pop())
      const value = clone(POLICY_EVALUATIONS[prId] ?? [])
      return json({ count: value.length, value })
    }
    if (area !== 'git') return notFound(area ?? '')
    if (kind?.toLowerCase() === 'pullrequests' && !repoId) {
      return json({ value: searchPrs(query) })
    }
    if (kind !== 'repositories' || !repoId) return notFound(kind ?? '')
    const known = Object.values(REPOS).some((repo) => repo.id === repoId)
    if (!known) return notFound('repository')
    return handleRepo(method, repoId, repoRest, query, body)
  }

  const fakeFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })
    log.push({ method, path: decodeURIComponent(url.pathname), query, body })
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency))
    return route(method, url, body)
  }) as typeof fetch

  return {
    fetch: fakeFetch,
    log,
    pullRequest: (id) => prs.get(id),
    snapshotFiles(repositoryId, commitId) {
      if (repoOfCommit.get(commitId) !== repositoryId) return []
      const out: { path: string; content: Buffer }[] = [
        { path: 'README.md', content: Buffer.from(README) },
      ]
      for (const [path, blobId] of filesAtCommit.get(commitId) ?? []) {
        const blob = getMockBlob(blobId)
        if (blob) out.push({ path: path.replace(/^\/+/, ''), content: blob })
      }
      return out
    },
  }
}
