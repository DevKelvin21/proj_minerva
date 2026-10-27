import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

/**
 * `SeenStore` usa `app.getPath('userData')` (Electron), igual que
 * `../settings/store.ts` — mismo mock con un directorio temporal real por
 * test (no memfs), ver `../settings/store.test.ts`.
 */
let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error('getPath inesperado: ' + name)
      return userDataDir
    },
  },
}))

const { SeenStore } = await import('./seen-store')
const { prKey } = await import('../../shared/scm')

function seenFilePath(): string {
  return join(userDataDir, 'pr-seen.json')
}

function summary(
  overrides: Partial<{ id: string; updatedAt: string; commentCount: number | null }>,
) {
  return {
    id: 'PR_kwDOshopwave482',
    number: 482,
    title: 'Add POST /carts/:id/apply-coupon endpoint',
    author: { login: 'mgarcia' },
    repo: { provider: 'github' as const, owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
    state: 'open' as const,
    isDraft: false,
    createdAt: '2026-07-02T14:20:00.000Z',
    updatedAt: '2026-07-04T09:12:00.000Z',
    headRef: 'feature/coupon-endpoint',
    baseRef: 'main',
    headSha: 'a482f001',
    webUrl: 'https://github.com/shopwave/api/pull/482',
    commentCount: 2 as number | null,
    reviewDecision: null,
    ciStatus: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    ...overrides,
  }
}

function key(pr: ReturnType<typeof summary>): string {
  return prKey(pr.repo, pr.number)
}

describe('SeenStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'minerva-seen-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('computeUnread', () => {
    it('isNew=true cuando no hay entrada sellada todavía (primer arranque, honesto)', () => {
      const store = new SeenStore()
      expect(store.computeUnread(summary({}))).toEqual({
        isNew: true,
        hasUpdates: false,
        hasNewComments: false,
      })
    })

    it('sin cambios tras markSeen: todo false', () => {
      const store = new SeenStore()
      const pr = summary({})
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      expect(store.computeUnread(pr)).toEqual({
        isNew: false,
        hasUpdates: false,
        hasNewComments: false,
      })
    })

    it('hasUpdates=true cuando updatedAt avanzó desde que se selló', () => {
      const store = new SeenStore()
      const pr = summary({})
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      const later = summary({ updatedAt: '2026-07-05T00:00:00.000Z' })
      expect(store.computeUnread(later)).toEqual({
        isNew: false,
        hasUpdates: true,
        hasNewComments: false,
      })
    })

    it('hasUpdates=false si updatedAt es distinto pero MÁS VIEJO que el sellado (no debería pasar, pero no es "unread")', () => {
      const store = new SeenStore()
      const pr = summary({ updatedAt: '2026-07-05T00:00:00.000Z' })
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      const older = summary({ updatedAt: '2026-07-01T00:00:00.000Z' })
      expect(store.computeUnread(older).hasUpdates).toBe(false)
    })

    it('hasNewComments=true cuando commentCount subió desde que se selló', () => {
      const store = new SeenStore()
      const pr = summary({ commentCount: 2 })
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      const withMoreComments = summary({ commentCount: 3 })
      expect(store.computeUnread(withMoreComments)).toEqual({
        isNew: false,
        hasUpdates: false,
        hasNewComments: true,
      })
    })

    it('hasNewComments=false si commentCount bajó o quedó igual', () => {
      const store = new SeenStore()
      const pr = summary({ commentCount: 3 })
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      expect(store.computeUnread(summary({ commentCount: 3 })).hasNewComments).toBe(false)
      expect(store.computeUnread(summary({ commentCount: 1 })).hasNewComments).toBe(false)
    })

    it('markSeen posterior vuelve a sellar y limpia el unread', () => {
      const store = new SeenStore()
      const pr = summary({})
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      const updated = summary({ updatedAt: '2026-07-06T00:00:00.000Z', commentCount: 5 })
      expect(store.computeUnread(updated).hasUpdates).toBe(true)

      store.markSeen(key(updated), {
        updatedAt: updated.updatedAt,
        commentCount: updated.commentCount,
      })
      expect(store.computeUnread(updated)).toEqual({
        isNew: false,
        hasUpdates: false,
        hasNewComments: false,
      })
    })
  })

  describe('persistencia', () => {
    it('devuelve isNew=true si no hay pr-seen.json (defaults, sin crashear)', () => {
      const store = new SeenStore()
      expect(store.computeUnread(summary({})).isNew).toBe(true)
    })

    it('trata un JSON corrupto como estado vacío, sin crashear', () => {
      writeFileSync(seenFilePath(), '{ esto no es json', 'utf-8')
      const store = new SeenStore()
      expect(store.computeUnread(summary({})).isNew).toBe(true)
    })

    it('trata una forma inválida (sin version/entries) como estado vacío', () => {
      writeFileSync(seenFilePath(), JSON.stringify({ foo: 'bar' }), 'utf-8')
      const store = new SeenStore()
      expect(store.computeUnread(summary({})).isNew).toBe(true)
    })

    it('escribe pr-seen.json atómico (sin dejar .tmp) con la forma esperada', () => {
      const store = new SeenStore()
      const pr = summary({})
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      const raw = JSON.parse(readFileSync(seenFilePath(), 'utf-8'))
      expect(raw.version).toBe(2)
      expect(raw.entries['github:shopwave/api#482']).toMatchObject({
        updatedAt: pr.updatedAt,
        commentCount: pr.commentCount,
      })
      expect(typeof raw.entries['github:shopwave/api#482'].seenAt).toBe('string')
      expect(existsSync(seenFilePath() + '.tmp')).toBe(false)
    })

    it('drops a version 1 file (old GitHub node-id keys) without crashing', () => {
      const pr = summary({})
      writeFileSync(
        seenFilePath(),
        JSON.stringify({
          version: 1,
          entries: { [pr.id]: { updatedAt: pr.updatedAt, commentCount: 2, seenAt: pr.updatedAt } },
        }),
        'utf-8',
      )
      const store = new SeenStore()
      expect(store.computeUnread(pr).isNew).toBe(true)
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })
      const raw = JSON.parse(readFileSync(seenFilePath(), 'utf-8'))
      expect(raw.version).toBe(2)
      expect(Object.keys(raw.entries)).toEqual(['github:shopwave/api#482'])
    })

    it('never flags new comments when the provider reports no comment count', () => {
      const store = new SeenStore()
      const pr = summary({ commentCount: null })
      store.markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: null })
      expect(store.computeUnread(summary({ commentCount: 9 })).hasNewComments).toBe(false)
      expect(store.computeUnread(summary({ commentCount: null })).hasNewComments).toBe(false)
    })

    it('roundtrip tras "reinicio": una instancia nueva lee lo persistido en disco', () => {
      const pr = summary({})
      new SeenStore().markSeen(key(pr), { updatedAt: pr.updatedAt, commentCount: pr.commentCount })

      const restarted = new SeenStore()
      expect(restarted.computeUnread(pr)).toEqual({
        isNew: false,
        hasUpdates: false,
        hasNewComments: false,
      })
    })

    it('cap de 1000 entradas: al superarlo, poda las de seenAt más viejo', () => {
      // Sella 1000 PRs con seenAt creciente (simulado con markSeen secuencial:
      // cada llamada usa `new Date().toISOString()`, que dentro de un mismo
      // test puede colisionar en el mismo milisegundo — se fuerza un orden
      // determinístico escribiendo el archivo directamente para este caso).
      const entries: Record<string, { updatedAt: string; commentCount: number; seenAt: string }> =
        {}
      for (let i = 0; i < 1000; i++) {
        entries['pr-' + i] = {
          updatedAt: '2026-01-01T00:00:00.000Z',
          commentCount: 0,
          seenAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        }
      }
      writeFileSync(seenFilePath(), JSON.stringify({ version: 2, entries }), 'utf-8')

      const fresh = new SeenStore()
      // markSeen de un PR nuevo debería empujar el total a 1001 y podar 1 (el
      // de seenAt más viejo: 'pr-0').
      fresh.markSeen('pr-new', { updatedAt: '2026-01-02T00:00:00.000Z', commentCount: 0 })

      const raw = JSON.parse(readFileSync(seenFilePath(), 'utf-8'))
      expect(Object.keys(raw.entries)).toHaveLength(1000)
      expect(raw.entries['pr-0']).toBeUndefined()
      expect(raw.entries['pr-new']).toBeDefined()
      expect(raw.entries['pr-999']).toBeDefined()
    })
  })
})
