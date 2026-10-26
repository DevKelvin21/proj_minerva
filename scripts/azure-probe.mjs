#!/usr/bin/env node
/**
 * Read-only live smoke for the Azure DevOps infrastructure modules
 * (`src/main/scm/azure/*`, `src/main/scm/stacks.ts`).
 *
 *   node scripts/azure-probe.mjs [--org <name>] [--project <name>] [--pr <id>] [--zip]
 *
 * Uses whatever credential the Azure CLI already has (see credentials.ts).
 * Prints only counts, shapes and a stack summary (PR numbers + branch names):
 * never descriptions, code, file contents, paths or tokens. Performs GETs
 * only. `--zip` also downloads the PR's repo at its head commit into a temp
 * dir, extracts it with the safe extractor, prints counts, and deletes it.
 *
 * The TypeScript modules are bundled on the fly with esbuild (already in
 * node_modules via vite) into node_modules/.cache so bare imports resolve.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = join(import.meta.dirname, '..')

function arg(name) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const wantZip = process.argv.includes('--zip')

async function loadModules() {
  const contents = [
    "export * from './src/main/scm/azure/credentials'",
    "export * from './src/main/scm/azure/client'",
    "export * from './src/main/scm/azure/mappers'",
    "export * from './src/main/scm/azure/patch-builder'",
    "export * from './src/main/scm/azure/zip-extract'",
    "export * from './src/main/scm/stacks'",
    "export { parsePatch } from './src/renderer/src/lib/diff-parser'",
  ].join('\n')
  const result = await build({
    stdin: { contents, resolveDir: root, loader: 'ts', sourcefile: 'probe-entry.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    write: false,
    logLevel: 'error',
  })
  const outFile = join(root, 'node_modules', '.cache', 'minerva-azure-probe', 'modules.mjs')
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, result.outputFiles[0].text)
  return import(pathToFileURL(outFile).href)
}

function countBy(items, key) {
  const out = {}
  for (const item of items) {
    const k = key(item)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function ext(path) {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot) : '(none)'
}

const ok = (label, value) =>
  console.log(
    '  ' + label.padEnd(28) + ' ' + (typeof value === 'string' ? value : JSON.stringify(value)),
  )

async function main() {
  const m = await loadModules()
  const started = Date.now()

  console.log('== defaults')
  const defaults = await m.readAzDevopsDefaults()
  const org = arg('org') ?? defaults.organization
  const project = arg('project') ?? defaults.project
  ok('organization', org ?? '(none)')
  ok('project', project ?? '(none)')
  ok('known organizations', defaults.knownOrganizations.length)
  if (!org || !project) throw new Error('No default org/project: pass --org and --project')

  console.log('== credential')
  const credentials = new m.AzureCredentialSource()
  let t = Date.now()
  const auth = await credentials.getAuthHeader(org)
  ok('source', auth.source)
  ok('scheme', auth.header.split(' ')[0])
  ok('first lookup ms', Date.now() - t)
  t = Date.now()
  await credentials.getAuthHeader(org)
  ok('cached lookup ms', Date.now() - t)

  const client = new m.AzureDevOpsClient({ credentials })

  console.log('== identity')
  const conn = await client.json(org, m.orgApiUrl(org, '_apis', 'connectionData'), {
    apiVersion: '7.1-preview',
  })
  ok('connectionData user id', conn.authenticatedUser?.id ? 'present' : 'missing')
  try {
    const profile = await client.json(org, m.vsspsApiUrl(org, '_apis', 'profile', 'profiles', 'me'))
    ok('profile displayName', profile.displayName ? 'present' : 'missing')
  } catch (error) {
    ok('profile', 'error ' + error.code)
  }

  console.log('== pull requests')
  const prsUrl = m.orgApiUrl(org, project, '_apis', 'git', 'pullrequests')
  t = Date.now()
  const active = await client.listTopSkip(org, prsUrl, {
    query: { 'searchCriteria.status': 'active' },
    pageSize: 500,
    maxItems: 2000,
  })
  ok('active PRs', active.length)
  ok('active list ms', Date.now() - t)
  const completed = await client.listTopSkip(org, prsUrl, {
    query: { 'searchCriteria.status': 'completed' },
    pageSize: 500,
    maxItems: 1000,
  })
  ok('completed PRs (recent 1000)', completed.length)
  const summaries = active.map((pr) => m.mapPullRequestSummary(pr, org))
  ok('repos with active PRs', new Set(summaries.map((s) => s.repo.repositoryId)).size)
  ok('drafts', summaries.filter((s) => s.isDraft).length)
  ok('without headSha', summaries.filter((s) => !s.headSha).length)
  ok(
    'reviewer votes',
    countBy(
      summaries.flatMap((s) => s.reviewers),
      (r) => r.vote,
    ),
  )
  ok('required reviewers', summaries.flatMap((s) => s.reviewers).filter((r) => r.isRequired).length)
  ok(
    'top 5 (number)',
    summaries.slice(0, 5).map((s) => s.number),
  )

  console.log('== one PR')
  const prId = Number(arg('pr') ?? summaries[0]?.number)
  const pr =
    active.find((p) => p.pullRequestId === prId) ??
    (await client.json(org, m.orgApiUrl(org, project, '_apis', 'git', 'pullrequests', prId)))
  const summary = m.mapPullRequestSummary(pr, org)
  const repo = summary.repo
  ok('pr', summary.number)
  ok('state / draft', summary.state + ' / ' + summary.isDraft)
  const iterations = (
    await client.json(
      org,
      m.gitRepoUrl(org, project, repo.repositoryId, 'pullRequests', prId, 'iterations'),
    )
  ).value
  ok('iterations', iterations.length)
  const latest = iterations[iterations.length - 1]
  ok('latest iteration id', latest?.id)
  ok(
    'iteration reasons',
    countBy(iterations, (i) => i.reason ?? '?'),
  )

  // Changes: $top/$skip with nextSkip/nextTop in the BODY (not a header).
  const entries = []
  let skip = 0
  let pages = 0
  for (;;) {
    const page = await client.json(
      org,
      m.gitRepoUrl(
        org,
        project,
        repo.repositoryId,
        'pullRequests',
        prId,
        'iterations',
        latest.id,
        'changes',
      ),
      { query: { $compareTo: 0, $top: 2000, $skip: skip } },
    )
    pages++
    entries.push(...page.changeEntries)
    if (!page.nextSkip) break
    skip = page.nextSkip
  }
  const changes = entries.map(m.mapChangeEntry).filter(Boolean)
  ok('change entries / pages', entries.length + ' / ' + pages)
  ok(
    'changeType values',
    countBy(entries, (e) => e.changeType),
  )
  ok(
    'mapped file status',
    countBy(changes, (c) => c.status),
  )
  ok(
    'entries w/ changeTrackingId',
    entries.filter((e) => typeof e.changeTrackingId === 'number').length,
  )
  ok(
    'removed w/ objectId',
    entries.filter((e) => m.mapChangeStatus(e.changeType) === 'removed' && e.item.objectId).length,
  )

  const rawThreads = (
    await client.json(
      org,
      m.gitRepoUrl(org, project, repo.repositoryId, 'pullRequests', prId, 'threads'),
    )
  ).value
  const threads = m.mapThreads(rawThreads)
  ok('threads raw / mapped', rawThreads.length + ' / ' + threads.length)
  ok(
    'thread status',
    countBy(threads, (th) => th.status),
  )
  ok(
    'line threads / sides',
    threads.filter((th) => th.isLineThread).length +
      ' / ' +
      JSON.stringify(
        countBy(
          threads.filter((th) => th.side),
          (th) => th.side,
        ),
      ),
  )
  ok('threads w/ iteration ctx', threads.filter((th) => th.iteration).length)
  ok('replies (comments>1)', threads.filter((th) => th.comments.length > 1).length)

  console.log('== patches (up to 3 files)')
  const blobUrl = (sha) => m.gitRepoUrl(org, project, repo.repositoryId, 'blobs', sha)
  const fetchBlob = (sha) =>
    sha
      ? client.binary(org, blobUrl(sha), {
          query: { $format: 'octetstream' },
          maxBytes: 5 * 1024 * 1024,
        })
      : Promise.resolve(null)
  for (const change of changes.slice(0, 3)) {
    t = Date.now()
    const [base, head] = await Promise.all([
      fetchBlob(change.baseObjectId),
      fetchBlob(change.headObjectId),
    ])
    const built = m.buildPatch(base, head)
    const hunks = built.patch ? m.parsePatch(built.patch) : []
    const parsedAdds = hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add').length
    ok(change.status + ' ' + ext(change.path), {
      adds: built.additions,
      dels: built.deletions,
      hunks: hunks.length,
      parserAgrees: parsedAdds === built.additions,
      binary: built.isBinary,
      tooLarge: built.tooLarge,
      ms: Date.now() - t,
    })
  }

  console.log('== stacks (whole project)')
  const toInput = (raw) => {
    const s = m.mapPullRequestSummary(raw, org)
    return {
      repo: s.repo,
      number: s.number,
      title: '',
      headRef: s.headRef,
      baseRef: s.baseRef,
      state: s.state,
      isDraft: s.isDraft,
      createdAt: raw.creationDate,
      closedAt: raw.closedDate,
    }
  }
  const openInputs = active.map(toInput)
  const doneInputs = completed.map(toInput)
  const firstPass = m.buildStacks(openInputs, doneInputs)
  // Verify "target branch exists" for orphans only (one GET each).
  const exists = new Map()
  for (const stack of firstPass) {
    if (!stack.root.orphan) continue
    const key = stack.repo.repositoryId + ':' + stack.root.baseRef
    const refs = await client.json(
      org,
      m.gitRepoUrl(org, project, stack.repo.repositoryId, 'refs'),
      {
        query: { filter: 'heads/' + stack.root.baseRef },
      },
    )
    exists.set(
      key,
      refs.value.some((r) => r.name === 'refs/heads/' + stack.root.baseRef),
    )
  }
  const stacks = m.buildStacks(openInputs, doneInputs, {
    branchExists: (r, branch) => exists.get(r.repositoryId + ':' + branch),
  })
  ok('stacks', stacks.length)
  ok('orphaned roots', stacks.filter((s) => s.root.orphan).length)
  ok('grouped across repos', stacks.filter((s) => s.groupKey).length)
  for (const stack of stacks) {
    const chain = m
      .flattenStack(stack.root)
      .map((n) => '#' + n.number + ' ' + n.headRef + ' -> ' + n.baseRef)
      .join(' | ')
    const orphan = stack.root.orphan
      ? '  ORPHAN parent #' +
        stack.root.orphan.parent.number +
        ' merged into ' +
        stack.root.orphan.parent.mergedInto +
        ', suggest ' +
        stack.root.orphan.suggestedBase +
        ', target exists=' +
        stack.root.orphan.targetBranchExists
      : ''
    console.log(
      '  [' +
        stack.repo.name +
        '] size ' +
        stack.size +
        (stack.groupKey ? ' group=' + stack.groupKey : '') +
        '\n     ' +
        chain +
        (orphan ? '\n    ' + orphan : ''),
    )
  }

  if (wantZip && summary.headSha) {
    console.log('== zip snapshot')
    const dir = await mkdtemp(join(tmpdir(), 'minerva-azure-probe-'))
    try {
      const zipPath = join(dir, 'repo.zip')
      t = Date.now()
      const bytes = await client.download(
        org,
        m.gitRepoUrl(org, project, repo.repositoryId, 'items'),
        zipPath,
        {
          query: {
            path: '/',
            $format: 'zip',
            download: 'true',
            'versionDescriptor.version': summary.headSha,
            'versionDescriptor.versionType': 'commit',
          },
          maxBytes: m.MAX_ZIP_BYTES,
        },
      )
      ok('zip MB / ms', (bytes / 1048576).toFixed(1) + ' / ' + (Date.now() - t))
      const out = join(dir, 'tree')
      await mkdir(out)
      t = Date.now()
      const result = await m.extractZipSafely(zipPath, out)
      ok('files / dirs', result.files + ' / ' + result.directories)
      ok('extracted MB / ms', (result.bytes / 1048576).toFixed(1) + ' / ' + (Date.now() - t))
      ok('stripped wrapper folder', Boolean(result.strippedRoot))
      ok(
        'skipped',
        countBy(result.skipped, (s) => s.reason),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  console.log('== done in ' + (Date.now() - started) + ' ms')
}

main().catch((error) => {
  // AzureScmError messages never contain credentials by construction.
  console.error('PROBE FAILED:', error?.code ?? '', error?.message ?? String(error))
  process.exit(1)
})
