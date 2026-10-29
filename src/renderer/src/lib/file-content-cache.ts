/**
 * Renderer-side cache of `scm:getFileContent` answers, shared by everything
 * that shows code next to a comment (expand context in the diff, excerpts in
 * the Comments view, suggestion prefill). One request per file/side/head:
 * a PR with 30 comments on 3 files costs 3 fetches, not 30.
 *
 * Keyed by the PR head SHA too, so a new push never serves stale code. A
 * failed request is evicted so the next caller retries. Small LRU: file
 * contents can be large.
 */
import { prKey } from '../../../shared/scm'
import type { FileContent, FileContentSide, RepoRef } from '../../../shared/scm'

export interface FileContentKey {
  repo: RepoRef
  number: number
  /** PR head SHA ('' when unknown): part of the key so a push invalidates. */
  headSha: string
  path: string
  side: FileContentSide
  /** With `side: 'head'`: this PR commit instead of the head (a thread's origin). */
  commit?: string
}

const MAX_ENTRIES = 40
const cache = new Map<string, Promise<FileContent>>()

/** Identity of a file read: PR, head, side, path and commit (when reading at one). */
export function fileContentKeyId(key: FileContentKey): string {
  return [prKey(key.repo, key.number), key.headSha, key.side, key.path, key.commit ?? ''].join(
    '\u0000',
  )
}

export function loadFileContent(key: FileContentKey): Promise<FileContent> {
  const id = fileContentKeyId(key)
  const hit = cache.get(id)
  if (hit) {
    // Refresh LRU position.
    cache.delete(id)
    cache.set(id, hit)
    return hit
  }
  const request = window.minerva.scm.getFileContent({
    repo: key.repo,
    number: key.number,
    path: key.path,
    side: key.side,
    ...(key.commit ? { commit: key.commit } : {}),
  })
  cache.set(id, request)
  request.catch(() => {
    if (cache.get(id) === request) cache.delete(id)
  })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return request
}
