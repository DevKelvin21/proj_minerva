import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrWatcher, type WatcherListResult } from './pr-watcher'
import { prKey, type ScmErrorCode, type ScmProviderId } from '../../shared/scm'
import type { PullRequestSummary } from '../../shared/types'

const REPO = {
  provider: 'github' as const,
  owner: 'shopwave',
  name: 'api',
  fullName: 'shopwave/api',
}

/** A successful fan-out listing from GitHub only. */
function ok(items: PullRequestSummary[]): WatcherListResult {
  return { items, errors: [], okProviders: ['github'] }
}

/** A fan-out listing where `provider` failed with `code`. */
function fail(
  code: ScmErrorCode,
  provider: ScmProviderId = 'github',
  items: PullRequestSummary[] = [],
  okProviders: ScmProviderId[] = [],
): WatcherListResult {
  return { items, errors: [{ provider, code, message: code }], okProviders }
}

function key(pr: PullRequestSummary): string {
  return prKey(pr.repo, pr.number)
}

function makeSummary(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    id: 'shopwave/api#1',
    number: 1,
    title: 'PR de prueba',
    author: { login: 'mgarcia' },
    repo: REPO,
    state: 'open',
    isDraft: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    headRef: 'feature/x',
    baseRef: 'main',
    headSha: 'a1',
    webUrl: 'https://github.com/shopwave/api/pull/1',
    commentCount: 0,
    reviewDecision: null,
    ciStatus: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    ...overrides,
  }
}

describe('createPrWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('el primer tick exitoso solo fija el baseline, SIN broadcast', async () => {
    const list = vi.fn().mockResolvedValue(ok([makeSummary()]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(list).toHaveBeenCalledTimes(1)
    expect(broadcast).not.toHaveBeenCalled()

    watcher.stop()
  })

  it('detecta un PR nuevo (new_pr)', async () => {
    const prA = makeSummary({ id: 'shopwave/api#1', number: 1 })
    const prB = makeSummary({ id: 'shopwave/api#2', number: 2, title: 'PR nuevo' })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([prA]))
      .mockResolvedValueOnce(ok([prA, prB]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0) // baseline
    await vi.advanceTimersByTimeAsync(1000) // segundo tick

    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        { type: 'new_pr', prKey: key(prB), number: prB.number, title: prB.title, repo: prB.repo },
      ],
    })

    watcher.stop()
  })

  it('calls onChanges right before broadcast, only when something changed', async () => {
    const prA = makeSummary({ id: 'shopwave/api#1', number: 1 })
    const prB = makeSummary({ id: 'shopwave/api#2', number: 2, title: 'PR nuevo' })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([prA]))
      .mockResolvedValueOnce(ok([prA]))
      .mockResolvedValueOnce(ok([prA, prB]))
    const order: string[] = []
    const onChanges = vi.fn(() => order.push('invalidate'))
    const broadcast = vi.fn(() => order.push('broadcast'))
    const watcher = createPrWatcher({ list, broadcast, onChanges, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0) // baseline: nothing
    await vi.advanceTimersByTimeAsync(1000) // no change: nothing
    expect(onChanges).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000) // new PR
    expect(order).toEqual(['invalidate', 'broadcast'])
    const event = {
      changes: [
        { type: 'new_pr', prKey: key(prB), number: prB.number, title: prB.title, repo: prB.repo },
      ],
    }
    expect(onChanges).toHaveBeenCalledWith(event)
    expect(broadcast).toHaveBeenCalledWith(event)

    watcher.stop()
  })

  it('a failing onChanges never blocks the broadcast', async () => {
    const prA = makeSummary({ id: 'shopwave/api#1', number: 1 })
    const prB = makeSummary({ id: 'shopwave/api#2', number: 2 })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([prA]))
      .mockResolvedValueOnce(ok([prA, prB]))
    const broadcast = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onChanges = vi.fn(() => {
      throw new Error('boom')
    })
    const watcher = createPrWatcher({ list, broadcast, onChanges, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(broadcast).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    watcher.stop()
  })

  it('detecta cierre (open -> closed): pr_closed', async () => {
    const open = makeSummary({ state: 'open' })
    const closed = makeSummary({ state: 'closed' })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([open]))
      .mockResolvedValueOnce(ok([closed]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'pr_closed',
          prKey: key(closed),
          number: closed.number,
          title: closed.title,
          repo: closed.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('detecta merge (open -> merged): pr_merged', async () => {
    const open = makeSummary({ state: 'open' })
    const merged = makeSummary({ state: 'merged' })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([open]))
      .mockResolvedValueOnce(ok([merged]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'pr_merged',
          prKey: key(merged),
          number: merged.number,
          title: merged.title,
          repo: merged.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('detecta comentarios nuevos (mismo estado, commentCount subió): new_comments', async () => {
    const before = makeSummary({ commentCount: 1 })
    const after = makeSummary({ commentCount: 2 })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([before]))
      .mockResolvedValueOnce(ok([after]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'new_comments',
          prKey: key(after),
          number: after.number,
          title: after.title,
          repo: after.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('detecta cualquier otro cambio de updatedAt como "updated"', async () => {
    const before = makeSummary({ updatedAt: '2026-07-01T00:00:00.000Z' })
    const after = makeSummary({ updatedAt: '2026-07-02T00:00:00.000Z' })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([before]))
      .mockResolvedValueOnce(ok([after]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).toHaveBeenCalledWith({
      changes: [
        {
          type: 'updated',
          prKey: key(after),
          number: after.number,
          title: after.title,
          repo: after.repo,
        },
      ],
    })

    watcher.stop()
  })

  it('prioridad: un cierre con comentarios nuevos reporta SOLO pr_closed, no new_comments', async () => {
    const before = makeSummary({ state: 'open', commentCount: 1 })
    const after = makeSummary({ state: 'closed', commentCount: 5 })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([before]))
      .mockResolvedValueOnce(ok([after]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    const event = broadcast.mock.calls[0][0]
    expect(event.changes).toHaveLength(1)
    expect(event.changes[0].type).toBe('pr_closed')

    watcher.stop()
  })

  it('prioridad: comentarios nuevos con updatedAt distinto reporta SOLO new_comments, no updated', async () => {
    const before = makeSummary({ commentCount: 1, updatedAt: '2026-07-01T00:00:00.000Z' })
    const after = makeSummary({ commentCount: 2, updatedAt: '2026-07-02T00:00:00.000Z' })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([before]))
      .mockResolvedValueOnce(ok([after]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    const event = broadcast.mock.calls[0][0]
    expect(event.changes).toHaveLength(1)
    expect(event.changes[0].type).toBe('new_comments')

    watcher.stop()
  })

  it('un PR que desaparece del listado NO genera change', async () => {
    const prA = makeSummary({ id: 'shopwave/api#1', number: 1 })
    const prB = makeSummary({ id: 'shopwave/api#2', number: 2 })
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok([prA, prB]))
      .mockResolvedValueOnce(ok([prA]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(broadcast).not.toHaveBeenCalled()

    watcher.stop()
  })

  it('sin cambios entre ticks: no hace broadcast', async () => {
    const pr = makeSummary()
    const list = vi.fn().mockResolvedValue(ok([pr]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    expect(list).toHaveBeenCalledTimes(3)
    expect(broadcast).not.toHaveBeenCalled()

    watcher.stop()
  })

  describe('multiple providers', () => {
    it('a failing provider keeps its PRs and never floods new_pr when it recovers', async () => {
      const gh = makeSummary({ id: 'gh1', number: 1 })
      const az = makeSummary({
        id: 'az7',
        number: 7,
        repo: {
          provider: 'azure',
          organization: 'contoso',
          project: 'p',
          name: 'r',
          repositoryId: 'rid',
          fullName: 'contoso/p/r',
        },
      })
      const both: WatcherListResult = {
        items: [gh, az],
        errors: [],
        okProviders: ['github', 'azure'],
      }
      const list = vi
        .fn()
        .mockResolvedValueOnce(both) // baseline for both
        .mockResolvedValueOnce(fail('NETWORK', 'azure', [gh], ['github'])) // azure down
        .mockResolvedValueOnce(both) // azure back: same PRs, nothing new
      const broadcast = vi.fn()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)

      expect(list).toHaveBeenCalledTimes(3)
      expect(broadcast).not.toHaveBeenCalled()
      watcher.stop()
    })

    it('a provider that failed the first tick gets its own silent baseline later', async () => {
      const gh = makeSummary({ id: 'gh1', number: 1 })
      const az = makeSummary({
        id: 'az7',
        number: 7,
        repo: {
          provider: 'azure',
          organization: 'contoso',
          project: 'p',
          name: 'r',
          repositoryId: 'rid',
          fullName: 'contoso/p/r',
        },
      })
      const list = vi
        .fn()
        .mockResolvedValueOnce(fail('UNAUTHENTICATED', 'azure', [gh], ['github']))
        .mockResolvedValueOnce({ items: [gh, az], errors: [], okProviders: ['github', 'azure'] })
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)

      expect(broadcast).not.toHaveBeenCalled()
      watcher.stop()
    })
  })

  describe('manejo de errores', () => {
    it('UNAUTHENTICATED hace skip silencioso y reintenta al intervalo nominal', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce(ok([makeSummary()]))
        .mockResolvedValueOnce(fail('UNAUTHENTICATED'))
        .mockResolvedValueOnce(ok([makeSummary({ updatedAt: '2026-07-09T00:00:00.000Z' })]))
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0) // baseline
      await vi.advanceTimersByTimeAsync(1000) // falla: no autenticado
      expect(list).toHaveBeenCalledTimes(2)

      // Reintenta al intervalo NOMINAL (sin backoff) tras un error de auth.
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(3)
      expect(broadcast).toHaveBeenCalledTimes(1) // el updatedAt distinto del 3er tick

      watcher.stop()
    })

    it('rate limit duplica el intervalo efectivo (backoff x2) y resetea al próximo éxito', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce(ok([makeSummary()])) // baseline
        .mockResolvedValueOnce(fail('RATE_LIMITED'))
        .mockResolvedValueOnce(fail('RATE_LIMITED'))
        .mockResolvedValue(ok([makeSummary()])) // éxito: resetea el backoff (y sigue como default)
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0) // baseline, tick #1
      expect(list).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000) // tick #2: rate limit -> backoff a 2000ms
      expect(list).toHaveBeenCalledTimes(2)

      // Con el intervalo nominal (1000ms) todavía NO debería haber un tick #3
      // (el backoff duplicó el intervalo efectivo a 2000ms).
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(2)

      // A los 2000ms desde el tick #2, sí llega el tick #3 (otro rate limit -> backoff a 4000ms).
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(3)

      // Backoff duplicado de nuevo: el próximo tick tarda 4000ms, no 2000ms.
      await vi.advanceTimersByTimeAsync(2000)
      expect(list).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(2000)
      expect(list).toHaveBeenCalledTimes(4) // tick #4: éxito, resetea backoff a 1000ms

      // Tras el reset, el próximo tick vuelve a tardar el intervalo NOMINAL (1000ms).
      await vi.advanceTimersByTimeAsync(1000)
      expect(list).toHaveBeenCalledTimes(5)

      watcher.stop()
    })

    it('el backoff nunca supera el tope de 15 minutos', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce(ok([makeSummary()]))
        .mockResolvedValue(fail('RATE_LIMITED'))
      const broadcast = vi.fn()
      // intervalMs alto para que unos pocos dobles ya superen el tope de 15min.
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 600_000 }) // 10 min

      watcher.start()
      await vi.advanceTimersByTimeAsync(0) // baseline
      await vi.advanceTimersByTimeAsync(600_000) // tick #2: rate limit -> backoff a 1_200_000 (20min), tope 900_000
      expect(list).toHaveBeenCalledTimes(2)

      // Con el tope de 15min (900_000ms), el próximo tick debería llegar ahí, no a los 1_200_000.
      await vi.advanceTimersByTimeAsync(900_000)
      expect(list).toHaveBeenCalledTimes(3)

      watcher.stop()
    })

    it('cualquier otro error se loguea y el timer sigue re-armándose', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const list = vi
        .fn()
        .mockResolvedValueOnce(ok([makeSummary()]))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(ok([makeSummary({ updatedAt: '2026-07-09T00:00:00.000Z' })]))
      const broadcast = vi.fn()
      const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

      watcher.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000) // error genérico
      expect(consoleErrorSpy).toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000) // el timer sigue vivo
      expect(list).toHaveBeenCalledTimes(3)
      expect(broadcast).toHaveBeenCalledTimes(1)

      consoleErrorSpy.mockRestore()
      watcher.stop()
    })
  })

  it('stop() detiene el timer: no hay más ticks después', async () => {
    const list = vi.fn().mockResolvedValue(ok([makeSummary()]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)

    watcher.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('start() es idempotente: llamarlo dos veces no duplica el timer', async () => {
    const list = vi.fn().mockResolvedValue(ok([makeSummary()]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast, intervalMs: 1000 })

    watcher.start()
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(list).toHaveBeenCalledTimes(1)

    watcher.stop()
  })

  it('sin intervalMs explícito, usa el default de 60000ms', async () => {
    const list = vi.fn().mockResolvedValue(ok([makeSummary()]))
    const broadcast = vi.fn()
    const watcher = createPrWatcher({ list, broadcast })

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(59_999)
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(list).toHaveBeenCalledTimes(2)

    watcher.stop()
  })
})
