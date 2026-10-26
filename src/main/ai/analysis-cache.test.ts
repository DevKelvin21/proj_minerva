import { describe, expect, it } from 'vitest'
import { AnalysisCache } from './analysis-cache'
import type { AnalysisStoreEntry, AnalysisStoreLike } from './analysis-store'
import type { RepoRef } from '../../shared/scm'
import type { DidacticAnalysis } from '../../shared/types'

/**
 * Fake en memoria de `AnalysisStoreLike` (T40): evita I/O real a disco en
 * estos tests. `entries` es pública para poder inspeccionar/mutar el estado
 * "persistido" directamente desde las aserciones (p. ej. simular un
 * reinicio con un `AnalysisCache` nuevo apuntando al mismo fake).
 */
class FakeAnalysisStore implements AnalysisStoreLike {
  entries: AnalysisStoreEntry[] = []

  loadEntries(): AnalysisStoreEntry[] {
    return this.entries
  }

  saveEntries(entries: AnalysisStoreEntry[]): void {
    this.entries = entries
  }
}

function repo(name: string): RepoRef {
  return { provider: 'github', owner: 'shopwave', name, fullName: 'shopwave/' + name }
}

function analysis(prId: string): DidacticAnalysis {
  return {
    prId,
    sections: [{ kind: 'summary', markdown: prId }],
    generatedAt: '2026-07-06T00:00:00.000Z',
    headSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    generatedWith: { provider: 'opencode', model: 'opencode/big-pickle', options: {} },
  }
}

describe('AnalysisCache', () => {
  it('devuelve null en un miss', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    expect(cache.get(repo('api'), 1)).toBeNull()
  })

  it('devuelve lo guardado en un hit (misma repo/number, no por identidad de objeto)', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    const value = analysis('shopwave/api#1')
    cache.set(repo('api'), 1, value)

    expect(
      cache.get(
        { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' },
        1,
      ),
    ).toBe(value)
  })

  it('distingue por repo y por number: no hay colisión entre PRs distintos', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    cache.set(repo('api'), 1, analysis('a'))
    cache.set(repo('api'), 2, analysis('b'))
    cache.set(repo('web'), 1, analysis('c'))

    expect(cache.get(repo('api'), 1)?.prId).toBe('a')
    expect(cache.get(repo('api'), 2)?.prId).toBe('b')
    expect(cache.get(repo('web'), 1)?.prId).toBe('c')
  })

  it('invalidate borra solo la entrada de ese PR', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    cache.set(repo('api'), 1, analysis('a'))
    cache.set(repo('api'), 2, analysis('b'))

    cache.invalidate(repo('api'), 1)

    expect(cache.get(repo('api'), 1)).toBeNull()
    expect(cache.get(repo('api'), 2)?.prId).toBe('b')
  })

  it('invalidate en un PR sin entrada no lanza y no afecta al resto', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    cache.set(repo('api'), 1, analysis('a'))

    expect(() => cache.invalidate(repo('api'), 999)).not.toThrow()
    expect(cache.get(repo('api'), 1)?.prId).toBe('a')
  })

  it('set sobre una clave existente reemplaza el valor', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    cache.set(repo('api'), 1, analysis('old'))
    cache.set(repo('api'), 1, analysis('new'))

    expect(cache.size).toBe(1)
    expect(cache.get(repo('api'), 1)?.prId).toBe('new')
  })

  it('LRU: evict de la entrada menos recientemente usada al pasar de MAX_ENTRIES (20)', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    for (let i = 1; i <= 20; i++) {
      cache.set(repo('api'), i, analysis('pr' + i))
    }
    expect(cache.size).toBe(20)

    // Una entrada más: debe evictar la #1 (la más antigua, nunca releída).
    cache.set(repo('api'), 21, analysis('pr21'))

    expect(cache.size).toBe(20)
    expect(cache.get(repo('api'), 1)).toBeNull()
    expect(cache.get(repo('api'), 21)?.prId).toBe('pr21')
  })

  it('LRU: un get reciente protege esa entrada de ser evictada', () => {
    const cache = new AnalysisCache(new FakeAnalysisStore())
    for (let i = 1; i <= 20; i++) {
      cache.set(repo('api'), i, analysis('pr' + i))
    }

    // Releer #1 la vuelve "la más reciente"; #2 pasa a ser la más antigua.
    cache.get(repo('api'), 1)

    cache.set(repo('api'), 21, analysis('pr21'))

    expect(cache.get(repo('api'), 1)?.prId).toBe('pr1')
    expect(cache.get(repo('api'), 2)).toBeNull()
  })

  describe('persistencia (T40): hidratación + write-through vía store inyectado', () => {
    it('con el store vacío, get/set/invalidate/size no explotan (hidratación de un store sin entries)', () => {
      const cache = new AnalysisCache(new FakeAnalysisStore())
      expect(cache.get(repo('api'), 1)).toBeNull()
      expect(cache.size).toBe(0)
      expect(() => cache.invalidate(repo('api'), 1)).not.toThrow()
    })

    it('hidrata del store en el PRIMER acceso: entries ya persistidas aparecen sin haber llamado set()', () => {
      const store = new FakeAnalysisStore()
      store.entries = [
        { key: 'github:shopwave/api#1', analysis: analysis('a') },
        { key: 'github:shopwave/api#2', analysis: analysis('b') },
      ]

      const cache = new AnalysisCache(store)
      expect(cache.get(repo('api'), 1)?.prId).toBe('a')
      expect(cache.get(repo('api'), 2)?.prId).toBe('b')
      expect(cache.size).toBe(2)
    })

    it('hidrata preservando el orden LRU persistido (la primera del array es la menos reciente)', () => {
      const store = new FakeAnalysisStore()
      store.entries = [
        { key: 'github:shopwave/api#1', analysis: analysis('a') },
        { key: 'github:shopwave/api#2', analysis: analysis('b') },
      ]

      const cache = new AnalysisCache(store)
      // Sin releer nada: un set nuevo que empuje a MAX_ENTRIES+1 debe evictar
      // #1 (la más vieja según el orden persistido), no #2.
      for (let i = 3; i <= 21; i++) {
        cache.set(repo('api'), i, analysis('pr' + i))
      }
      expect(cache.size).toBe(20)
      expect(cache.get(repo('api'), 1)).toBeNull()
      expect(cache.get(repo('api'), 2)?.prId).toBe('b')
    })

    it('set hace write-through: el store queda con la misma entry recién guardada', () => {
      const store = new FakeAnalysisStore()
      const cache = new AnalysisCache(store)

      cache.set(repo('api'), 1, analysis('a'))

      expect(store.entries).toEqual([{ key: 'github:shopwave/api#1', analysis: analysis('a') }])
    })

    it('set hace write-through de TODAS las entries en orden LRU, no solo de la nueva', () => {
      const store = new FakeAnalysisStore()
      const cache = new AnalysisCache(store)

      cache.set(repo('api'), 1, analysis('a'))
      cache.set(repo('api'), 2, analysis('b'))

      expect(store.entries.map((e) => e.key)).toEqual([
        'github:shopwave/api#1',
        'github:shopwave/api#2',
      ])

      // Un get sobre #1 la refresca como más reciente; el próximo write-through
      // (disparado por otro set) debe reflejar el nuevo orden.
      cache.get(repo('api'), 1)
      cache.set(repo('api'), 3, analysis('c'))

      expect(store.entries.map((e) => e.key)).toEqual([
        'github:shopwave/api#2',
        'github:shopwave/api#1',
        'github:shopwave/api#3',
      ])
    })

    it('invalidate hace write-through: el store deja de tener la entry borrada', () => {
      const store = new FakeAnalysisStore()
      const cache = new AnalysisCache(store)
      cache.set(repo('api'), 1, analysis('a'))
      cache.set(repo('api'), 2, analysis('b'))

      cache.invalidate(repo('api'), 1)

      expect(store.entries.map((e) => e.key)).toEqual(['github:shopwave/api#2'])
    })

    it('el evict de LRU se refleja en el store: tras pasar de MAX_ENTRIES, la más vieja desaparece de disco', () => {
      const store = new FakeAnalysisStore()
      const cache = new AnalysisCache(store)
      for (let i = 1; i <= 20; i++) {
        cache.set(repo('api'), i, analysis('pr' + i))
      }
      expect(store.entries).toHaveLength(20)

      cache.set(repo('api'), 21, analysis('pr21'))

      expect(store.entries).toHaveLength(20)
      expect(store.entries.map((e) => e.key)).not.toContain('github:shopwave/api#1')
      expect(store.entries.map((e) => e.key)).toContain('github:shopwave/api#21')
    })

    it('"reinicio": una instancia nueva de AnalysisCache sobre el mismo store lee lo persistido por la anterior', () => {
      const store = new FakeAnalysisStore()
      const first = new AnalysisCache(store)
      first.set(repo('api'), 1, analysis('a'))
      first.invalidate(repo('api'), 999) // no-op, no debería afectar

      const restarted = new AnalysisCache(store)
      expect(restarted.get(repo('api'), 1)?.prId).toBe('a')
    })
  })
})
