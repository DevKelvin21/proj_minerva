import { describe, expect, it } from 'vitest'
import {
  MAX_ACTIVITY_ITEMS,
  createActivityTracker,
  deriveActivityLabel,
  sanitizeDetail,
  type ActivityTracker,
} from './activity-tracker'

/** Tracker + contador de edges, el arnés mínimo de estos tests. */
function makeTracker(basePath?: string): { tracker: ActivityTracker; edges: () => number } {
  let edges = 0
  const tracker = createActivityTracker({
    basePath,
    onEdge: () => {
      edges += 1
    },
  })
  return { tracker, edges: () => edges }
}

describe('sanitizeDetail', () => {
  it('quita caracteres de control y colapsa whitespace', () => {
    expect(sanitizeDetail('src/\u0000api\u001f/routes\u007f.ts')).toBe('src/ api /routes .ts')
    expect(sanitizeDetail('un\npatrón\tcon   saltos')).toBe('un patrón con saltos')
    expect(sanitizeDetail('  bordes  ')).toBe('bordes')
  })

  it('trunca a 64 caracteres con elipsis', () => {
    const largo = 'a'.repeat(100)
    const result = sanitizeDetail(largo)
    expect(result.length).toBe(64)
    expect(result.endsWith('…')).toBe(true)
  })

  it('relativiza rutas contra basePath (con y sin slash final)', () => {
    expect(sanitizeDetail('/snap/abc/src/api/routes.ts', '/snap/abc')).toBe('src/api/routes.ts')
    expect(sanitizeDetail('/snap/abc/src/api/routes.ts', '/snap/abc/')).toBe('src/api/routes.ts')
    expect(sanitizeDetail('src/relativa.ts', '/snap/abc')).toBe('src/relativa.ts')
  })
})

describe('deriveActivityLabel', () => {
  it('cubre la tabla de verbos por kind/status', () => {
    expect(deriveActivityLabel('read', 'running', 'src/a.ts')).toBe('Reading src/a.ts')
    expect(deriveActivityLabel('read', 'running')).toBe('Reading a file…')
    expect(deriveActivityLabel('read', 'done', 'src/a.ts')).toBe('Read src/a.ts')
    expect(deriveActivityLabel('read', 'done')).toBe('Read a file')
    expect(deriveActivityLabel('read', 'error', 'src/a.ts')).toBe('Failed to read src/a.ts')
    expect(deriveActivityLabel('search', 'running', 'router')).toBe('Searching "router"')
    expect(deriveActivityLabel('search', 'done', 'router')).toBe('Searched "router"')
    expect(deriveActivityLabel('search', 'done')).toBe('Searched the repo')
    expect(deriveActivityLabel('search', 'error')).toBe('A search failed')
    expect(deriveActivityLabel('list', 'running')).toBe('Listing the structure…')
    expect(deriveActivityLabel('list', 'done', 'src/')).toBe('Listed src/')
    expect(deriveActivityLabel('list', 'done')).toBe('Listed the structure')
    expect(deriveActivityLabel('thinking', 'running')).toBe('Thinking…')
    expect(deriveActivityLabel('thinking', 'done')).toBe('Thought')
    expect(deriveActivityLabel('tool', 'running', 'webfetch')).toBe('Using webfetch')
    expect(deriveActivityLabel('tool', 'running')).toBe('Exploring the repository…')
    expect(deriveActivityLabel('tool', 'done', 'webfetch')).toBe('Used webfetch')
  })
})

describe('createActivityTracker', () => {
  it('begin agrega una fila running y dispara un edge', () => {
    const { tracker, edges } = makeTracker()
    tracker.begin('t1', 'read', 'src/a.ts')
    expect(edges()).toBe(1)
    expect(tracker.buffer()).toEqual([
      { id: 't1', kind: 'read', label: 'Reading src/a.ts', status: 'running' },
    ])
  })

  it('colapsa por identidad: complete actualiza la misma fila, nunca duplica', () => {
    const { tracker, edges } = makeTracker()
    tracker.begin('t1', 'read')
    tracker.complete('t1', 'src/a.ts')
    expect(edges()).toBe(2)
    expect(tracker.buffer()).toEqual([
      { id: 't1', kind: 'read', label: 'Read src/a.ts', status: 'done' },
    ])
  })

  it('begin repetido con el mismo id no duplica la fila', () => {
    const { tracker } = makeTracker()
    tracker.begin('t1', 'read', 'src/a.ts')
    tracker.begin('t1', 'read', 'src/a.ts')
    expect(tracker.buffer()).toHaveLength(1)
  })

  it('fail marca error en la misma fila', () => {
    const { tracker } = makeTracker()
    tracker.begin('t1', 'search', 'router')
    tracker.fail('t1')
    expect(tracker.buffer()).toEqual([
      { id: 't1', kind: 'search', label: 'A search failed', status: 'error' },
    ])
  })

  it('evicta la fila más vieja al superar el cap y complete de una evictada es no-op', () => {
    const { tracker, edges } = makeTracker()
    for (let i = 0; i < MAX_ACTIVITY_ITEMS + 1; i++) {
      tracker.begin('t' + i, 'read', 'src/f' + i + '.ts')
    }
    const buffer = tracker.buffer()
    expect(buffer).toHaveLength(MAX_ACTIVITY_ITEMS)
    expect(buffer[0].id).toBe('t1')
    expect(buffer[buffer.length - 1].id).toBe('t' + MAX_ACTIVITY_ITEMS)

    const before = edges()
    tracker.complete('t0', 'src/f0.ts')
    expect(edges()).toBe(before)
    expect(tracker.buffer().some((e) => e.id === 't0')).toBe(false)
  })

  it('thinking es edge solo la primera vez por id', () => {
    const { tracker, edges } = makeTracker()
    tracker.thinking('think-1')
    tracker.thinking('think-1')
    tracker.thinking('think-1')
    expect(edges()).toBe(1)
    expect(tracker.buffer()).toEqual([
      { id: 'think-1', kind: 'thinking', label: 'Thinking…', status: 'running' },
    ])
  })

  it('un bloque de thinking nuevo reutiliza la fila "Pensando…" viva sin edge extra', () => {
    const { tracker, edges } = makeTracker()
    tracker.thinking('think-1')
    tracker.thinking('think-2')
    expect(edges()).toBe(1)
    expect(tracker.buffer()).toHaveLength(1)
    // El id adoptado es el nuevo; deltas posteriores de think-2 son no-op.
    tracker.thinking('think-2')
    expect(edges()).toBe(1)
  })

  it('begin de una tool cierra el "Pensando…" abierto', () => {
    const { tracker } = makeTracker()
    tracker.thinking('think-1')
    tracker.begin('t1', 'read', 'src/a.ts')
    const buffer = tracker.buffer()
    expect(buffer[0]).toEqual({ id: 'think-1', kind: 'thinking', label: 'Thought', status: 'done' })
    expect(buffer[1].status).toBe('running')
  })

  it('settleThinking cierra el "Pensando…" sin disparar edge', () => {
    const { tracker, edges } = makeTracker()
    tracker.thinking('think-1')
    const before = edges()
    tracker.settleThinking()
    expect(edges()).toBe(before)
    expect(tracker.buffer()[0].label).toBe('Thought')
  })

  it('sanea el detalle: relativiza contra basePath y trunca hostiles', () => {
    const { tracker } = makeTracker('/snap/x')
    tracker.begin('t1', 'read', '/snap/x/src/api/routes.ts')
    tracker.begin('t2', 'search', 'patrón\ncon\u0000control' + 'z'.repeat(100))
    const buffer = tracker.buffer()
    expect(buffer[0].label).toBe('Reading src/api/routes.ts')
    // eslint-disable-next-line no-control-regex -- verificar que NO quedan control chars es el punto
    expect(buffer[1].label).not.toMatch(/[\u0000-\u001f]/)
    expect(buffer[1].label.length).toBeLessThan(80)
  })

  it('buffer devuelve copias: mutar el resultado no afecta al tracker', () => {
    const { tracker } = makeTracker()
    tracker.begin('t1', 'read', 'src/a.ts')
    const buffer = tracker.buffer()
    buffer[0].label = 'mutado'
    buffer.pop()
    expect(tracker.buffer()).toEqual([
      { id: 't1', kind: 'read', label: 'Reading src/a.ts', status: 'running' },
    ])
  })
})

describe('activity labels follow the analysis language', () => {
  it('derives Spanish labels for an es analysis and English ones by default', () => {
    expect(deriveActivityLabel('read', 'done', 'src/a.ts', 'es')).toBe('Leyó src/a.ts')
    expect(deriveActivityLabel('thinking', 'running', undefined, 'es')).toBe('Pensando…')
    expect(deriveActivityLabel('search', 'running', 'x')).toBe('Searching "x"')
    const tracker = createActivityTracker({ language: 'es', onEdge: () => {} })
    tracker.begin('t1', 'list')
    expect(tracker.buffer()[0].label).toBe('Listando la estructura…')
  })

  it('never re-expands placeholders that come from the hostile detail', () => {
    expect(deriveActivityLabel('read', 'running', '{{detail}}')).toBe('Reading {{detail}}')
  })
})
