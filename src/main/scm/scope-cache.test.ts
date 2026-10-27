import { describe, expect, it, vi } from 'vitest'
import type { ScopePullRequest } from './provider'
import { createScopeCache, type ScopeSource } from './scope-cache'

function source(id: 'github' | 'azure' = 'github', items: ScopePullRequest[] = []) {
  const listScopePullRequests = vi.fn(async () => items)
  const provider: ScopeSource = { id, listScopePullRequests }
  return { provider, listScopePullRequests }
}

describe('createScopeCache', () => {
  it('serves within the TTL, refetches after it', async () => {
    let clock = 0
    const cache = createScopeCache({ ttlMs: 60_000, now: () => clock })
    const { provider, listScopePullRequests } = source()
    await cache.get(provider)
    await cache.get(provider)
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)
    clock += 60_000
    await cache.get(provider)
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
  })

  it('refresh refetches only past minRefreshMs', async () => {
    let clock = 0
    const cache = createScopeCache({ minRefreshMs: 10_000, now: () => clock })
    const { provider, listScopePullRequests } = source()
    await cache.get(provider)
    clock += 9_999
    await cache.get(provider, { refresh: true })
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)
    clock += 1
    await cache.get(provider, { refresh: true })
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
  })

  it('is single-flight per provider, and keyed by provider id', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const listScopePullRequests = vi.fn(async () => {
      await gate
      return [] as ScopePullRequest[]
    })
    const github: ScopeSource = { id: 'github', listScopePullRequests }
    const azure = source('azure')
    const cache = createScopeCache()
    const calls = [cache.get(github), cache.get(github, { refresh: true }), cache.get(github)]
    await cache.get(azure.provider)
    release()
    const [a, b, c] = await Promise.all(calls)
    expect(listScopePullRequests).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(azure.listScopePullRequests).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures', async () => {
    const listScopePullRequests = vi
      .fn<() => Promise<ScopePullRequest[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
    const provider: ScopeSource = { id: 'github', listScopePullRequests }
    const cache = createScopeCache()
    await expect(cache.get(provider)).rejects.toThrow('boom')
    await expect(cache.get(provider)).resolves.toEqual([])
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
  })

  it('invalidate() drops results, and a fetch in flight is not stored', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let calls = 0
    const listScopePullRequests = vi.fn(async () => {
      calls++
      if (calls === 1) await gate
      return [] as ScopePullRequest[]
    })
    const provider: ScopeSource = { id: 'github', listScopePullRequests }
    const cache = createScopeCache()
    const stale = cache.get(provider)
    cache.invalidate()
    release()
    await stale
    // The pre-invalidate result was not cached: this one fetches again...
    await cache.get(provider)
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
    // ...and is cached.
    await cache.get(provider)
    expect(listScopePullRequests).toHaveBeenCalledTimes(2)
  })
})
