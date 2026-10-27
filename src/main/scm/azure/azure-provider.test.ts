/**
 * `AzureScmProvider` end to end over the in-memory fake REST server
 * (`./fixtures/fake-server.ts`): the REAL client, URLs, paging and mappers,
 * no network. Writes only ever reach the fake.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AzureRepoRef, RepoRef } from '../../../shared/scm'
import { ScmError } from '../errors'
import { stacksForProvider } from '../stacks-service'
import { AzureScmProvider, type AzureProviderConfig } from './azure-provider'
import { AzureDevOpsClient, type CredentialProvider } from './client'
import { AzureScmError } from './errors'
import { createFakeAzureServer, type FakeAzureServer } from './fixtures/fake-server'
import { buildZip } from './fixtures/test-zip'
import { MOCK_ORG, MOCK_PROJECT, PEOPLE, REPOS } from './fixtures/universe'
import { mapRepo } from './mappers'

const okCredentials: CredentialProvider = {
  getAuthHeader: async () => ({ header: 'Basic test', source: 'az-devops-pat' }),
  invalidate: () => {},
}

const enabledConfig: AzureProviderConfig = {
  enabled: true,
  organizations: [{ organization: MOCK_ORG, projects: [MOCK_PROJECT] }],
}

const apiRepo = mapRepo(REPOS.api, MOCK_ORG)
const webRepo = mapRepo(REPOS.web, MOCK_ORG)
const infraRepo = mapRepo(REPOS.infra, MOCK_ORG)

let server: FakeAzureServer
let clock: number

function provider(
  options: {
    config?: AzureProviderConfig
    credentials?: CredentialProvider
    client?: AzureDevOpsClient
  } = {},
): AzureScmProvider {
  const credentials = options.credentials ?? okCredentials
  return new AzureScmProvider({
    client: options.client ?? new AzureDevOpsClient({ credentials, fetch: server.fetch }),
    credentials,
    getConfig: () => options.config ?? enabledConfig,
    now: () => clock,
  })
}

function writes(): { method: string; path: string; body?: unknown }[] {
  return server.log.filter((entry) => entry.method !== 'GET')
}

beforeEach(() => {
  server = createFakeAzureServer()
  clock = Date.parse('2026-10-26T12:00:00Z')
})

describe('getAuthStatus', () => {
  it('is signed_in with the connectionData identity and the credential source', async () => {
    await expect(provider().getAuthStatus()).resolves.toEqual({
      provider: 'azure',
      state: 'signed_in',
      user: { login: PEOPLE.ada.uniqueName, displayName: PEOPLE.ada.displayName },
      credentialSource: 'az-devops-pat',
    })
  })

  it('is disabled when turned off or with no organization', async () => {
    const off = await provider({ config: { ...enabledConfig, enabled: false } }).getAuthStatus()
    expect(off).toMatchObject({ provider: 'azure', state: 'disabled' })
    const empty = await provider({ config: { enabled: true, organizations: [] } }).getAuthStatus()
    expect(empty.state).toBe('disabled')
    expect(empty.detail).toMatch(/organization/)
    expect(server.log).toHaveLength(0)
  })

  it('maps credential failures to cli_unavailable / cli_unauthenticated with a hint', async () => {
    const failing = (error: Error): CredentialProvider => ({
      getAuthHeader: async () => {
        throw error
      },
      invalidate: () => {},
    })
    const missing = await provider({
      credentials: failing(new AzureScmError('CLI_UNAVAILABLE', 'Azure CLI (az) was not found.')),
    }).getAuthStatus()
    expect(missing).toMatchObject({ state: 'cli_unavailable' })

    const noPat = await provider({
      credentials: failing(
        new AzureScmError(
          'UNAUTHENTICATED',
          'No credential. Run: az devops login --organization x',
        ),
      ),
    }).getAuthStatus()
    expect(noPat.state).toBe('cli_unauthenticated')
    expect(noPat.detail).toContain('az devops login')
  })

  it('adds the az devops login hint when the REST call itself is rejected', async () => {
    const rejecting = (async () => new Response('', { status: 401 })) as unknown as typeof fetch
    const status = await provider({
      client: new AzureDevOpsClient({ credentials: okCredentials, fetch: rejecting }),
    }).getAuthStatus()
    expect(status.state).toBe('cli_unauthenticated')
    expect(status.detail).toContain('az devops login --organization https://dev.azure.com/contoso')
    expect(JSON.stringify(status)).not.toContain('Basic')
  })
})

describe('listPullRequests', () => {
  it('lists PRs I created or review, merged and de-duplicated, newest activity first', async () => {
    const prs = await provider().listPullRequests({})
    const numbers = prs.map((pr) => pr.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect([...numbers].sort()).toEqual([101, 102, 103, 104, 105, 106, 108, 110])
    expect(prs.every((pr) => pr.state === 'open' && pr.repo.provider === 'azure')).toBe(true)
    const sorted = [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    expect(prs.map((pr) => pr.number)).toEqual(sorted.map((pr) => pr.number))
    // One query per role per status per project.
    const searches = server.log.filter((entry) => entry.path.endsWith('/_apis/git/pullrequests'))
    expect(searches.map((entry) => Object.keys(entry.query).find((k) => k.endsWith('Id')))).toEqual(
      ['searchCriteria.creatorId', 'searchCriteria.reviewerId'],
    )
  })

  it('maps the state filter: closed = completed + abandoned, all = everything', async () => {
    const closed = await provider().listPullRequests({ state: 'closed' })
    expect(closed.map((pr) => [pr.number, pr.state]).sort()).toEqual([
      [100, 'merged'],
      [107, 'closed'],
    ])
    const all = await provider().listPullRequests({ state: 'all' })
    expect(all).toHaveLength(10)
  })

  it('searches client-side over title, repo, branch and number', async () => {
    const p = provider()
    expect((await p.listPullRequests({ search: 'cart rounding' })).map((pr) => pr.number)).toEqual([
      108,
    ])
    expect((await p.listPullRequests({ search: 'platform-infra' })).map((pr) => pr.number)).toEqual(
      [106],
    )
    expect(
      (await p.listPullRequests({ search: 'feature/refund-ledger' })).map((pr) => pr.number),
    ).toEqual([105])
    expect((await p.listPullRequests({ search: '#103' })).map((pr) => pr.number)).toEqual([103])
  })

  it('derives updatedAt from the last push, then from observed changes', async () => {
    const p = provider()
    const first = await p.listPullRequests({})
    // #102 got a second push on 2026-10-13 (iteration 2).
    expect(first.find((pr) => pr.number === 102)?.updatedAt).toBe('2026-10-13T09:00:00.000Z')
    expect(first.find((pr) => pr.number === 108)?.updatedAt).toBe('2026-10-14T08:00:00.000Z')
    expect(first.every((pr) => pr.commentCount === null)).toBe(true)

    // Same data again: nothing moves (the watcher must not see a change).
    clock += 60_000
    const again = await p.listPullRequests({})
    expect(again.map((pr) => pr.updatedAt)).toEqual(first.map((pr) => pr.updatedAt))

    // A vote carries no timestamp: dated when this process first sees it.
    const pr108 = server.pullRequest(108)
    if (!pr108?.reviewers) throw new Error('fixture')
    pr108.reviewers[1].vote = 10
    clock += 60_000
    const afterVote = await p.listPullRequests({})
    expect(afterVote.find((pr) => pr.number === 108)?.updatedAt).toBe(new Date(clock).toISOString())
    expect(afterVote.find((pr) => pr.number === 101)?.updatedAt).toBe(
      first.find((pr) => pr.number === 101)?.updatedAt,
    )
  })

  it('returns nothing (and calls nothing) when disabled', async () => {
    await expect(
      provider({ config: { ...enabledConfig, enabled: false } }).listPullRequests({}),
    ).resolves.toEqual([])
    expect(server.log).toHaveLength(0)
  })
})

describe('detail', () => {
  it('carries the description, reviewers, work items, CI and commit count', async () => {
    const detail = await provider().getPullRequestDetail(webRepo, 108)
    expect(detail.bodyMarkdown).toBe('Mock PR 108.')
    expect(detail.reviewers).toEqual([
      {
        user: { login: PEOPLE.ada.uniqueName, displayName: 'Ada Lovelace' },
        vote: 'approved',
        isRequired: false,
      },
      {
        user: { login: PEOPLE.linus.uniqueName, displayName: 'Linus Pauling' },
        vote: 'none',
        isRequired: false,
      },
    ])
    expect(detail.workItems).toEqual([
      {
        id: '4711',
        title: 'Cart total is off by a cent',
        url: 'https://dev.azure.com/contoso/Platform/_workitems/edit/4711',
        type: 'Bug',
        state: 'Active',
      },
    ])
    expect(detail.ciStatus).toBe('success')
    expect(detail.commits).toBe(1)
    expect(detail.reviewDecision).toBe('approved')
  })

  it('reports required reviewers, failing CI and the merged state', async () => {
    const p = provider()
    const pr101 = await p.getPullRequestDetail(apiRepo, 101)
    expect(pr101.reviewers.filter((r) => r.isRequired)).toHaveLength(2)
    expect(pr101.reviewDecision).toBe('review_required')
    expect(pr101.ciStatus).toBe('pending')
    expect((await p.getPullRequestDetail(apiRepo, 105)).ciStatus).toBe('failure')
    expect((await p.getPullRequestDetail(apiRepo, 100)).state).toBe('merged')
  })

  it('fills the diff stats once the files were built', async () => {
    const p = provider()
    expect((await p.getPullRequestDetail(webRepo, 108)).changedFiles).toBeNull()
    await p.getPullRequestFiles(webRepo, 108)
    expect(await p.getPullRequestDetail(webRepo, 108)).toMatchObject({
      changedFiles: 1,
      additions: 2,
      deletions: 1,
    })
  })

  it('refuses a repo of an organization that is not configured, before any request', async () => {
    const forged: AzureRepoRef = { ...apiRepo, organization: 'evil-org', fullName: 'evil-org/x/y' }
    await expect(provider().getPullRequestDetail(forged, 101)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const github: RepoRef = { provider: 'github', owner: 'o', name: 'n', fullName: 'o/n' }
    await expect(provider().getPullRequestFiles(github, 1)).rejects.toBeInstanceOf(ScmError)
    expect(server.log).toHaveLength(0)
  })
})

describe('files', () => {
  it('builds unified patches from blobs (latest iteration vs. merge base)', async () => {
    const files = await provider().getPullRequestFiles(apiRepo, 102)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      path: 'src/Services/CheckoutService.cs',
      status: 'modified',
      additions: 3,
      deletions: 0,
      isBinary: false,
    })
    expect(files[0].patch?.split('\n')[0]).toBe('@@ -14,6 +14,9 @@')
    expect(files[0].patch).toContain('+            throw new InvalidOperationException')
    const changes = server.log.find((entry) => entry.path.endsWith('/iterations/2/changes'))
    expect(changes?.query.$compareTo).toBe('0')
  })

  it('handles renames, pure renames, binaries and deletes', async () => {
    const files = await provider().getPullRequestFiles(infraRepo, 106)
    const byPath = new Map(files.map((file) => [file.path, file]))
    expect(byPath.get('modules/virtual-network/main.tf')).toMatchObject({
      status: 'renamed',
      previousPath: 'modules/network/main.tf',
      additions: 1,
      deletions: 1,
    })
    const pure = byPath.get('modules/virtual-network/README.md')
    expect(pure).toMatchObject({ status: 'renamed', previousPath: 'modules/network/README.md' })
    expect(pure?.patch).toBeUndefined()
    const logo = byPath.get('docs/logo.png')
    expect(logo).toMatchObject({ isBinary: true })
    expect(logo?.patch).toBeUndefined()
    expect(byPath.get('modules/network/legacy.tf')).toMatchObject({
      status: 'removed',
      deletions: 1,
    })
    // The .png was never downloaded; the pure rename neither.
    const blobs = server.log.filter((entry) => entry.path.includes('/blobs/'))
    expect(blobs).toHaveLength(3)
  })

  it('caches per iteration (iterations are immutable)', async () => {
    const p = provider()
    await p.getPullRequestFiles(webRepo, 108)
    const before = server.log.length
    await p.getPullRequestFiles(webRepo, 108)
    expect(server.log.slice(before).map((entry) => entry.path.split('/').pop())).toEqual([
      'iterations',
    ])
  })
})

describe('threads', () => {
  it('maps every status and filters system and deleted threads', async () => {
    const threads = await provider().getCommentThreads(webRepo, 108)
    expect(threads.map((thread) => [thread.id, thread.status])).toEqual([
      ['1', 'active'],
      ['2', 'pending'],
      ['3', 'resolved'],
      ['4', 'wont_fix'],
      ['5', 'closed'],
      ['6', 'by_design'],
    ])
    expect(threads.find((thread) => thread.id === '3')).toMatchObject({
      side: 'LEFT',
      line: 2,
      isResolved: true,
    })
    expect(threads.find((thread) => thread.id === '1')).toMatchObject({
      path: 'src/cart/total.ts',
      line: 2,
      lineEnd: 3,
      side: 'RIGHT',
    })
    expect(threads.some((thread) => thread.isOutdated)).toBe(false)
    const read = server.log.find((entry) => entry.path.endsWith('/threads'))
    expect(read?.query).toMatchObject({ $iteration: '1', $baseIteration: '0' })
  })

  it('flags a line thread from an older iteration that the server did not re-track', async () => {
    const threads = await provider().getCommentThreads(apiRepo, 102)
    expect(threads.find((thread) => thread.id === '1')?.isOutdated).toBeUndefined()
    expect(threads.find((thread) => thread.id === '2')?.isOutdated).toBe(true)
  })
})

describe('writes (fake server only)', () => {
  it('replies to a thread under its root comment', async () => {
    const comment = await provider().postComment({
      repo: webRepo,
      number: 108,
      threadId: '1',
      bodyMarkdown: 'Agreed.',
    })
    expect(comment).toMatchObject({ id: '1/4', bodyMarkdown: 'Agreed.' })
    expect(comment.htmlUrl).toContain('/pullrequest/108?discussionId=1')
    expect(writes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: expect.stringMatching(/\/pullRequests\/108\/threads\/1\/comments$/),
        body: { content: 'Agreed.', commentType: 1, parentCommentId: 1 },
      }),
    ])
  })

  it('starts a line thread with the changeTrackingId and iteration context {1, latest}', async () => {
    const p = provider()
    await p.postComment({
      repo: apiRepo,
      number: 102,
      path: 'src/Services/CheckoutService.cs',
      line: 15,
      side: 'RIGHT',
      bodyMarkdown: 'Nit.',
    })
    const post = writes()[0]
    expect(post.body).toMatchObject({
      threadContext: {
        filePath: '/src/Services/CheckoutService.cs',
        rightFileStart: { line: 15, offset: 1 },
        rightFileEnd: { line: 15, offset: 1 },
      },
      pullRequestThreadContext: {
        changeTrackingId: expect.any(Number),
        iterationContext: { firstComparingIteration: 1, secondComparingIteration: 2 },
      },
      status: 1,
    })
    const threads = await p.getCommentThreads(apiRepo, 102)
    const created = threads.find((thread) => thread.comments[0]?.bodyMarkdown === 'Nit.')
    expect(created).toMatchObject({ line: 15, side: 'RIGHT', status: 'active' })
    expect(created?.isOutdated).toBeUndefined()
  })

  it('starts a LEFT-side thread and a general thread', async () => {
    const p = provider()
    await p.postComment({
      repo: webRepo,
      number: 108,
      path: 'src/cart/total.ts',
      line: 2,
      side: 'LEFT',
      bodyMarkdown: 'Old side.',
    })
    await p.postComment({ repo: webRepo, number: 108, bodyMarkdown: 'Overall LGTM.' })
    const [left, general] = writes()
    expect(left.body).toMatchObject({ threadContext: { leftFileStart: { line: 2, offset: 1 } } })
    expect(general.body).toEqual({
      comments: [{ content: 'Overall LGTM.', commentType: 1, parentCommentId: 0 }],
      status: 1,
    })
  })

  it('refuses a line comment on a file outside the latest iteration', async () => {
    await expect(
      provider().postComment({
        repo: webRepo,
        number: 108,
        path: 'not/in/the/diff.ts',
        line: 1,
        bodyMarkdown: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(writes()).toHaveLength(0)
  })

  it('sets a thread status and answers the updated thread', async () => {
    const thread = await provider().setThreadStatus({
      repo: webRepo,
      number: 108,
      threadId: '2',
      status: 'wont_fix',
    })
    expect(thread).toMatchObject({ id: '2', status: 'wont_fix', isResolved: true })
    expect(writes()).toEqual([
      expect.objectContaining({ method: 'PATCH', body: { status: 'wontFix' } }),
    ])
  })

  it('retargets with a PATCH of targetRefName', async () => {
    const summary = await provider().updatePullRequestBase(apiRepo, 105, 'main')
    expect(summary.baseRef).toBe('main')
    expect(writes()).toEqual([
      expect.objectContaining({ method: 'PATCH', body: { targetRefName: 'refs/heads/main' } }),
    ])
  })
})

describe('file content', () => {
  it('reads head and base (merge base) contents', async () => {
    const p = provider()
    const head = await p.getFileContent({
      repo: apiRepo,
      number: 102,
      path: 'src/Services/CheckoutService.cs',
      side: 'head',
    })
    expect(head.content).toContain('order.Status = OrderStatus.Submitted;')
    const base = await p.getFileContent({
      repo: apiRepo,
      number: 102,
      path: 'src/Services/CheckoutService.cs',
      side: 'base',
    })
    expect(base.content).not.toContain('OrderStatus.Submitted')
    expect(base.content).toContain('// Line 12: kept as context.')
  })

  it('reports binaries, and NOT_FOUND for a file missing on that side', async () => {
    const p = provider()
    await expect(
      p.getFileContent({ repo: infraRepo, number: 106, path: 'docs/logo.png', side: 'head' }),
    ).resolves.toEqual({ content: null, isBinary: true, tooLarge: false })
    await expect(
      p.getFileContent({
        repo: apiRepo,
        number: 103,
        path: 'src/Api/CheckoutEndpoints.cs',
        side: 'base',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('branches and stacks', () => {
  it('matches branches exactly (the refs filter is a prefix match)', async () => {
    const p = provider()
    await expect(p.branchExists(apiRepo, 'feature/refund-schema')).resolves.toBe(true)
    await expect(p.branchExists(apiRepo, 'feature/checkout-v2')).resolves.toBe(false)
    await expect(p.branchExists(apiRepo, 'refs/heads/main')).resolves.toBe(true)
  })

  it('finds the orphan through an exact sourceRefName query', async () => {
    const stacks = await stacksForProvider(provider())
    const orphan = stacks.find((stack) => stack.root.number === 105)
    expect(orphan?.root.orphan).toEqual({
      parent: { number: 100, title: 'Add refunds table', mergedInto: 'main' },
      targetBranchExists: true,
      suggestedBase: 'main',
    })
    expect(stacks.map((stack) => stack.size).sort()).toEqual([1, 2, 3])
    const lookups = server.log.filter((entry) => entry.query['searchCriteria.sourceRefName'])
    expect(lookups.map((entry) => entry.query['searchCriteria.sourceRefName'])).toEqual([
      'refs/heads/feature/refund-schema',
    ])
  })
})

describe('writeSnapshot (real zip path)', () => {
  let work: string
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'minerva-azure-provider-test-'))
  })
  afterEach(async () => {
    await rm(work, { recursive: true, force: true })
  })

  function zipClient(zip: Buffer, seen: string[]): AzureDevOpsClient {
    const client = new AzureDevOpsClient({ credentials: okCredentials, fetch: server.fetch })
    client.download = async (_org, url, destPath) => {
      seen.push(url, destPath)
      await writeFile(destPath, zip)
      return zip.length
    }
    return client
  }

  it('downloads to a unique temp file, extracts safely, and cleans the temp file', async () => {
    const seen: string[] = []
    const zip = buildZip([
      { name: 'repo/', mode: 0o040755 },
      { name: 'repo/src/a.ts', data: 'export const a = 1\n' },
      { name: 'repo/link', data: '/etc/passwd', mode: 0o120777 },
    ])
    const dest = join(work, 'dest')
    await (await import('node:fs/promises')).mkdir(dest)
    const p = new AzureScmProvider({
      client: zipClient(zip, seen),
      credentials: okCredentials,
      getConfig: () => enabledConfig,
      tmpRoot: () => work,
    })
    await p.writeSnapshot({ repo: apiRepo, headSha: 'a'.repeat(40) }, dest)
    expect(await readFile(join(dest, 'src/a.ts'), 'utf8')).toBe('export const a = 1\n')
    expect((await readdir(dest)).sort()).toEqual(['src'])
    expect(seen[0]).toContain('/items')
    // The temp zip lived in its own dir under tmpRoot and is gone.
    expect((await readdir(work)).sort()).toEqual(['dest'])
  })

  it('fails (so snapshot-store discards the dir) on an unsafe archive or a bad sha', async () => {
    const zip = buildZip([{ name: '../evil.txt', data: 'x' }])
    const dest = join(work, 'dest')
    await (await import('node:fs/promises')).mkdir(dest)
    const p = new AzureScmProvider({
      client: zipClient(zip, []),
      credentials: okCredentials,
      getConfig: () => enabledConfig,
      tmpRoot: () => work,
    })
    await expect(
      p.writeSnapshot({ repo: apiRepo, headSha: 'b'.repeat(40) }, dest),
    ).rejects.toThrow()
    await expect(p.writeSnapshot({ repo: apiRepo, headSha: 'nope' }, dest)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect((await readdir(work)).sort()).toEqual(['dest'])
  })
})

describe('listProjects', () => {
  it('lists the organization projects for the picker', async () => {
    await expect(provider().listProjects(MOCK_ORG)).resolves.toEqual([MOCK_PROJECT])
  })
})
