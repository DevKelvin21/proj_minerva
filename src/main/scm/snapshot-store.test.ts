import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AzureRepoRef, GithubRepoRef } from '../../shared/scm'
import type { SnapshotWriter } from './snapshot-store'

/**
 * `snapshot-store.ts` usa `app.getPath('userData')` (Electron), igual que
 * `../settings/store.test.ts`/`../ai/analysis-store.test.ts`: se mockea con
 * un directorio temporal real (no memfs) para poder verificar de punta a
 * punta la escritura atómica y el barrido LRU en disco.
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

const { ensureSnapshot, createSnapshotCleaner, MAX_SNAPSHOTS, MAX_TOTAL_BYTES } =
  await import('./snapshot-store')

function snapshotsRoot(): string {
  return join(userDataDir, 'snapshots')
}

function repo(overrides: Partial<GithubRepoRef> = {}): GithubRepoRef {
  return {
    provider: 'github',
    owner: 'shopwave',
    name: 'api',
    fullName: 'shopwave/api',
    ...overrides,
  }
}

function azureRepo(overrides: Partial<AzureRepoRef> = {}): AzureRepoRef {
  return {
    provider: 'azure',
    organization: 'contoso',
    project: 'Studio v2',
    name: 'cms-api',
    repositoryId: '3f2c1a9e-0000-4000-8000-000000000001',
    fullName: 'contoso/Studio v2/cms-api',
    ...overrides,
  }
}

/** Only what `ensureSnapshot` needs from a provider. */
function fakeGithubService(writeSnapshot: SnapshotWriter['writeSnapshot']): SnapshotWriter {
  return { writeSnapshot }
}

/** `<provider>-<name>-<hash10>-<sha7>` */
const DIR_NAME_RE = (prefix: string, sha7: string): RegExp =>
  new RegExp('^' + prefix + '-[0-9a-f]{10}-' + sha7 + '$')

describe('ensureSnapshot', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'minerva-snapshot-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('crea el snapshot escribiendo en un dir temporal y renombrando al path final', async () => {
    const calls: { destDir: string; existedDuringWrite: boolean }[] = []
    const github = fakeGithubService(async (req, destDir) => {
      calls.push({ destDir, existedDuringWrite: existsSync(destDir) })
      writeFileSync(join(destDir, 'package.json'), JSON.stringify({ name: req.repo.name }))
    })

    const result = await ensureSnapshot(github, repo(), 'abcdef1234567890')

    expect(dirname(result)).toBe(snapshotsRoot())
    expect(basename(result)).toMatch(DIR_NAME_RE('github-api', 'abcdef1'))
    expect(existsSync(result)).toBe(true)
    expect(existsSync(join(result, 'package.json'))).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].existedDuringWrite).toBe(true) // el dir temporal ya existe cuando se llama a writeSnapshot
    // El temporal no debe sobrevivir al rename.
    expect(readdirSync(snapshotsRoot())).toEqual([basename(result)])
  })

  it('reusa un snapshot existente sin volver a llamar a writeSnapshot, y toca el mtime', async () => {
    let writeCount = 0
    const github = fakeGithubService(async (_req, destDir) => {
      writeCount += 1
      writeFileSync(join(destDir, 'file.txt'), 'x')
    })

    const first = await ensureSnapshot(github, repo(), 'abcdef1234567890')
    const oldTime = new Date(Date.now() - 60_000)
    utimesSync(first, oldTime, oldTime)

    const second = await ensureSnapshot(github, repo(), 'abcdef1234567890')

    expect(second).toBe(first)
    expect(writeCount).toBe(1)
    const { mtimeMs } = statSync(first)
    expect(mtimeMs).toBeGreaterThan(oldTime.getTime())
  })

  it('dedupea llamadas concurrentes para el mismo repo+sha (una sola descarga en vuelo)', async () => {
    let writeCount = 0
    // Box en vez de `let` suelto: evita que TS narrowe la variable a `null`
    // fuera del closure del executor de la promesa (la reasignación real
    // ocurre async, invisible al control-flow analysis lineal de TS).
    const resolveWriteBox: { current: (() => void) | null } = { current: null }
    const github = fakeGithubService(async (_req, destDir) => {
      writeCount += 1
      await new Promise<void>((resolve) => {
        resolveWriteBox.current = resolve
      })
      writeFileSync(join(destDir, 'file.txt'), 'x')
    })

    const p1 = ensureSnapshot(github, repo(), 'abcdef1234567890')
    const p2 = ensureSnapshot(github, repo(), 'abcdef1234567890')

    // Deja que ambas llamadas lleguen a `writeSnapshot` antes de liberar.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(writeCount).toBe(1)
    resolveWriteBox.current?.()

    const [result1, result2] = await Promise.all([p1, p2])
    expect(result1).toBe(result2)
    expect(writeCount).toBe(1)
  })

  it('no dedupea repos o shas distintos (cada combinación dispara su propia descarga)', async () => {
    let writeCount = 0
    const github = fakeGithubService(async (_req, destDir) => {
      writeCount += 1
      writeFileSync(join(destDir, 'file.txt'), 'x')
    })

    await ensureSnapshot(github, repo(), 'abcdef1234567890')
    await ensureSnapshot(
      github,
      repo({ name: 'web', fullName: 'shopwave/web' }),
      'abcdef1234567890',
    )
    await ensureSnapshot(github, repo(), '1111111234567890')

    expect(writeCount).toBe(3)
  })

  it('names Azure DevOps snapshots safely and never collides across repo shapes', async () => {
    const github = fakeGithubService(async (_req, destDir) => {
      writeFileSync(join(destDir, 'file.txt'), 'x')
    })

    const azure = await ensureSnapshot(github, azureRepo(), 'abcdef1234567890')
    const otherProject = await ensureSnapshot(
      github,
      azureRepo({ project: 'Other', repositoryId: 'ffff', fullName: 'contoso/Other/cms-api' }),
      'abcdef1234567890',
    )
    // Same sanitized name as `a/b-c`: the repoKey hash tells them apart.
    const ghA = await ensureSnapshot(github, repo({ owner: 'a-b', name: 'c' }), 'abcdef1234567890')
    const ghB = await ensureSnapshot(github, repo({ owner: 'a', name: 'b-c' }), 'abcdef1234567890')

    expect(basename(azure)).toMatch(DIR_NAME_RE('azure-cms-api', 'abcdef1'))
    expect(new Set([azure, otherProject, ghA, ghB]).size).toBe(4)
    for (const dir of [azure, otherProject, ghA, ghB]) expect(dirname(dir)).toBe(snapshotsRoot())
  })

  it('sanitiza owner/name/sha maliciosos (path traversal) a un único segmento dentro de snapshots/', async () => {
    const github = fakeGithubService(async (_req, destDir) => {
      writeFileSync(join(destDir, 'file.txt'), 'x')
    })

    const evilRepo = repo({ owner: '../../evil', name: '../../../etc' })
    const result = await ensureSnapshot(github, evilRepo, '../../passwd')

    // El resultado sigue viviendo DENTRO de snapshots/, como un único
    // directorio hijo directo (nunca escaló niveles vía `..`). Aserción con
    // dirname/basename, NO con `+ '/'`: en Windows `join` separa con `\` y
    // la comparación por string rompía el build de CI (bug de test, no de app).
    expect(dirname(result)).toBe(snapshotsRoot())
    const relative = basename(result)
    expect(relative).not.toBe('..')
    expect(existsSync(result)).toBe(true)
    // Nada se escribió fuera de userDataDir (la traversal no funcionó).
    expect(existsSync(join(userDataDir, '..', 'evil'))).toBe(false)
  })

  it('escritura atómica: si writeSnapshot lanza, no queda dir final ni temporal huérfano', async () => {
    const github = fakeGithubService(async () => {
      throw new Error('falla simulada de red a mitad de la descarga')
    })

    await expect(ensureSnapshot(github, repo(), 'abcdef1234567890')).rejects.toThrow(
      'falla simulada',
    )

    expect(existsSync(snapshotsRoot())).toBe(true)
    expect(readdirSync(snapshotsRoot())).toEqual([]) // ni el final ni el .tmp-* quedaron
  })
})

describe('createSnapshotCleaner / sweep', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'minerva-snapshot-cleaner-test-'))
    mkdirSync(snapshotsRoot(), { recursive: true })
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  function makeSnapshotDir(name: string, ageMs: number, fileBytes: number): void {
    const dir = join(snapshotsRoot(), name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'file.bin'), Buffer.alloc(fileBytes, 1))
    const mtime = new Date(Date.now() - ageMs)
    utimesSync(dir, mtime, mtime)
  }

  it('no toca nada si no hay dir snapshots/ todavía', async () => {
    rmSync(snapshotsRoot(), { recursive: true, force: true })
    const cleaner = createSnapshotCleaner()
    await expect(cleaner.sweep()).resolves.toBeUndefined()
  })

  it('borra los directorios .tmp-* huérfanos, sin contarlos para los topes', async () => {
    mkdirSync(join(snapshotsRoot(), '.tmp-abc1234-9999-1'), { recursive: true })
    makeSnapshotDir('shopwave-api-abc1234', 1_000, 10)

    const cleaner = createSnapshotCleaner()
    await cleaner.sweep()

    const remaining = readdirSync(snapshotsRoot())
    expect(remaining).toEqual(['shopwave-api-abc1234'])
  })

  it('expulsa por count (LRU): con maxSnapshots=2, borra los más viejos primero', async () => {
    makeSnapshotDir('oldest', 30_000, 10)
    makeSnapshotDir('middle', 20_000, 10)
    makeSnapshotDir('newest', 10_000, 10)

    const cleaner = createSnapshotCleaner({ maxSnapshots: 2, maxTotalBytes: MAX_TOTAL_BYTES })
    await cleaner.sweep()

    const remaining = readdirSync(snapshotsRoot()).sort()
    expect(remaining).toEqual(['middle', 'newest'])
  })

  it('expulsa por bytes (LRU): con maxTotalBytes bajo, borra los más viejos hasta bajar del tope', async () => {
    makeSnapshotDir('oldest', 30_000, 100)
    makeSnapshotDir('middle', 20_000, 100)
    makeSnapshotDir('newest', 10_000, 100)

    const cleaner = createSnapshotCleaner({ maxSnapshots: MAX_SNAPSHOTS, maxTotalBytes: 150 })
    await cleaner.sweep()

    const remaining = readdirSync(snapshotsRoot()).sort()
    // Con tope de 150 bytes y 100 bytes por snapshot, solo entra 1: el más nuevo.
    expect(remaining).toEqual(['newest'])
  })

  it('es tolerante a un directorio de análisis que falla (no tumba el resto del sweep)', async () => {
    makeSnapshotDir('a', 20_000, 10)
    makeSnapshotDir('b', 10_000, 10)
    // Directorio "vacío raro" (sin archivos) igual debe sobrevivir el cálculo de tamaño.
    mkdirSync(join(snapshotsRoot(), 'empty-dir'))

    const cleaner = createSnapshotCleaner({ maxSnapshots: 100, maxTotalBytes: MAX_TOTAL_BYTES })
    await expect(cleaner.sweep()).resolves.toBeUndefined()
    expect(readdirSync(snapshotsRoot()).sort()).toEqual(['a', 'b', 'empty-dir'])
  })

  it('start() dispara un sweep inmediato y stop() detiene el timer periódico', async () => {
    vi.useFakeTimers()
    try {
      const cleaner = createSnapshotCleaner({ intervalMs: 1000 })
      const sweepSpy = vi.spyOn(cleaner, 'sweep').mockResolvedValue(undefined)

      cleaner.start()
      expect(sweepSpy).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)
      expect(sweepSpy).toHaveBeenCalledTimes(2)

      cleaner.stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(sweepSpy).toHaveBeenCalledTimes(2) // no more calls after stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
