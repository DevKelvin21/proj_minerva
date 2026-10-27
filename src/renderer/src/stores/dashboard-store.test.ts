import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardResult } from '../../../shared/types'

/**
 * `dashboard-store.ts` keeps request bookkeeping at module level, so every
 * test imports a fresh copy (`vi.resetModules`) against a stubbed `window`.
 */

interface Deferred {
  promise: Promise<DashboardResult>
  resolve: (value: DashboardResult) => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: Deferred['resolve']
  let reject!: Deferred['reject']
  const promise = new Promise<DashboardResult>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function answer(tag: string): DashboardResult {
  return { pullRequests: [], errors: [], fetchedAt: tag }
}

const getDashboard = vi.fn<(opts?: { refresh?: boolean }) => Promise<DashboardResult>>()
const storage = new Map<string, string>()

async function loadStore() {
  vi.resetModules()
  const mod = await import('./dashboard-store')
  return mod
}

/** Lets the chained `.then` callbacks inside the store run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  getDashboard.mockReset()
  storage.clear()
  vi.stubGlobal('window', {
    minerva: { scm: { getDashboard } },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('dashboard-store load', () => {
  it('a plain read joins the request in flight for the same auth signature', async () => {
    const { useDashboardStore } = await loadStore()
    const first = deferred()
    getDashboard.mockReturnValueOnce(first.promise)
    const a = useDashboardStore.getState().load({ authKey: 'acc1' })
    await flush()
    const b = useDashboardStore.getState().load({ authKey: 'acc1' })
    expect(b).toBe(a)
    first.resolve(answer('one'))
    await a
    expect(getDashboard).toHaveBeenCalledTimes(1)
    expect(useDashboardStore.getState().result?.fetchedAt).toBe('one')
    expect(useDashboardStore.getState().authKey).toBe('acc1')
  })

  it('account switch: does not join, discards the old answer, stores the new one under the new key', async () => {
    const { useDashboardStore } = await loadStore()
    const first = deferred()
    const second = deferred()
    getDashboard.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const a = useDashboardStore.getState().load({ authKey: 'acc1' })
    await flush()
    const b = useDashboardStore.getState().load({ authKey: 'acc2' })
    expect(b).not.toBe(a)

    // The old account's answer arrives first: never shown.
    first.resolve(answer('old-account'))
    await a
    expect(useDashboardStore.getState().result).toBeNull()
    expect(useDashboardStore.getState().authKey).toBeNull()

    await flush()
    expect(getDashboard).toHaveBeenCalledTimes(2)
    second.resolve(answer('new-account'))
    await b
    expect(useDashboardStore.getState().result?.fetchedAt).toBe('new-account')
    expect(useDashboardStore.getState().authKey).toBe('acc2')
    expect(useDashboardStore.getState().loading).toBe(false)
  })

  it('a failure of the superseded request does not surface as an error', async () => {
    const { useDashboardStore } = await loadStore()
    const first = deferred()
    getDashboard.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer('fresh'))
    const a = useDashboardStore.getState().load({ authKey: 'acc1' })
    await flush()
    const b = useDashboardStore.getState().load({ authKey: 'acc2' })
    first.reject(new Error('boom'))
    await a
    expect(useDashboardStore.getState().error).toBeNull()
    await b
    expect(useDashboardStore.getState().result?.fetchedAt).toBe('fresh')
  })

  it('a newer dataVersion (retarget) does not join and wins over the older answer', async () => {
    const { useDashboardStore } = await loadStore()
    const first = deferred()
    const second = deferred()
    getDashboard.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const a = useDashboardStore.getState().load({ authKey: 'acc1', dataVersion: 0 })
    await flush()
    const b = useDashboardStore.getState().load({ authKey: 'acc1', dataVersion: 1 })
    expect(b).not.toBe(a)
    first.resolve(answer('before-retarget'))
    await a
    expect(useDashboardStore.getState().result).toBeNull()
    await flush()
    second.resolve(answer('after-retarget'))
    await b
    expect(useDashboardStore.getState().result?.fetchedAt).toBe('after-retarget')
    expect(useDashboardStore.getState().dataVersion).toBe(1)

    // An older version asked later still joins nothing stale: it is simply a plain read.
    getDashboard.mockResolvedValueOnce(answer('plain'))
    await useDashboardStore.getState().load({ authKey: 'acc1', dataVersion: 0 })
    expect(useDashboardStore.getState().result?.fetchedAt).toBe('after-retarget')
  })

  it('forced refresh skips the cache once, then is throttled to a plain read', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { useDashboardStore, DASHBOARD_FORCED_REFRESH_MIN_MS } = await loadStore()
    getDashboard.mockResolvedValue(answer('x'))

    await useDashboardStore.getState().load({ authKey: 'acc1', refresh: true })
    expect(getDashboard).toHaveBeenLastCalledWith({ refresh: true })

    await useDashboardStore.getState().load({ authKey: 'acc1', refresh: true })
    expect(getDashboard).toHaveBeenLastCalledWith(undefined)

    vi.setSystemTime(new Date(Date.now() + DASHBOARD_FORCED_REFRESH_MIN_MS + 1))
    await useDashboardStore.getState().load({ authKey: 'acc1', refresh: true })
    expect(getDashboard).toHaveBeenLastCalledWith({ refresh: true })
    expect(getDashboard).toHaveBeenCalledTimes(3)
  })

  it('a forced refresh never joins the request in flight', async () => {
    const { useDashboardStore } = await loadStore()
    const first = deferred()
    getDashboard.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer('forced'))
    const a = useDashboardStore.getState().load({ authKey: 'acc1' })
    await flush()
    const b = useDashboardStore.getState().load({ authKey: 'acc1', refresh: true })
    expect(b).not.toBe(a)
    first.resolve(answer('plain'))
    await b
    expect(getDashboard).toHaveBeenCalledTimes(2)
    expect(getDashboard).toHaveBeenLastCalledWith({ refresh: true })
    expect(useDashboardStore.getState().result?.fetchedAt).toBe('forced')
  })

  it('surfaces an IPC failure as `error` and keeps the previous result', async () => {
    const { useDashboardStore } = await loadStore()
    getDashboard.mockResolvedValueOnce(answer('ok')).mockRejectedValueOnce(new Error('Error: nope'))
    await useDashboardStore.getState().load({ authKey: 'acc1' })
    await useDashboardStore.getState().load({ authKey: 'acc1', refresh: true })
    const state = useDashboardStore.getState()
    expect(state.result?.fetchedAt).toBe('ok')
    expect(state.error).toContain('nope')
    expect(state.loading).toBe(false)
  })
})

describe('dashboard-store feature names and hidden groups', () => {
  it('reads validated names/hidden keys from storage and persists changes', async () => {
    storage.set('minerva.featureNames', JSON.stringify({ 'azure:contoso:bug': 'Bugs', __proto__: { x: 1 }, junk: 1 }))
    storage.set('minerva.hiddenFeatures', JSON.stringify(['azure:contoso:bug', 'nope']))
    const { useDashboardStore } = await loadStore()
    expect({ ...useDashboardStore.getState().featureNames }).toEqual({ 'azure:contoso:bug': 'Bugs' })
    expect(useDashboardStore.getState().hiddenFeatures).toEqual(['azure:contoso:bug'])

    useDashboardStore.getState().setFeatureName('azure:contoso:checkout-v2', '  Checkout  rewrite ')
    expect(JSON.parse(storage.get('minerva.featureNames')!)).toEqual({
      'azure:contoso:bug': 'Bugs',
      'azure:contoso:checkout-v2': 'Checkout rewrite',
    })
    useDashboardStore.getState().setFeatureName('azure:contoso:bug', null)
    expect(JSON.parse(storage.get('minerva.featureNames')!)).toEqual({
      'azure:contoso:checkout-v2': 'Checkout rewrite',
    })

    useDashboardStore.getState().setFeatureHidden('azure:contoso:bug', false)
    useDashboardStore.getState().setFeatureHidden('github:shopwave:endpoint', true)
    expect(JSON.parse(storage.get('minerva.hiddenFeatures')!)).toEqual(['github:shopwave:endpoint'])
  })

  it('ignores invalid keys (prototype names, unscoped tags)', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setFeatureName('__proto__', 'x')
    useDashboardStore.getState().setFeatureName('constructor', 'x')
    useDashboardStore.getState().setFeatureName('bug', 'x')
    useDashboardStore.getState().setFeatureHidden('__proto__', true)
    expect({ ...useDashboardStore.getState().featureNames }).toEqual({})
    expect(useDashboardStore.getState().hiddenFeatures).toEqual([])
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(storage.size).toBe(0)
  })

  it('a custom name for a group named like a prototype member stays plain data', async () => {
    const { useDashboardStore } = await loadStore()
    useDashboardStore.getState().setFeatureName('azure:contoso:constructor', 'Ctor work')
    const names = useDashboardStore.getState().featureNames
    expect(Object.getPrototypeOf(names)).toBeNull()
    expect(names['azure:contoso:constructor']).toBe('Ctor work')
  })
})
