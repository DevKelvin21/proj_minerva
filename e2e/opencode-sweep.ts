/**
 * Sweep of ORPHANED `opencode serve` servers left behind by the suite.
 *
 * Why it exists: every app launch spawns one (the didactic panel asks for
 * `ai:getProviderStatus` on mount, and that starts the local server even with
 * `MINERVA_MOCK_AI=1` — that flag cuts in before the AI, not before the CLI
 * probe) and each one weighs ~300 MB. The REAL cleanup lives in the main process
 * (`stopOpencodeServer()` on `before-quit`); this is the net for the paths where
 * main never gets to run it: a test dying on timeout, Playwright SIGKILLing the
 * worker, an Electron crash.
 *
 * Selection rule, deliberately narrow — a server is killed only if:
 * 1. it has `PLAYWRIGHT_TEST=1` in its environment (set by `./fixtures.ts` when
 *    launching the app), so the user's own `opencode` session — or Minerva's in
 *    dev — never enters the sweep; and
 * 2. it is an orphan (`ppid === 1`), so a still-living app never loses its server.
 * The whole GROUP is killed (negative pid) because the server is spawned
 * `detached: true` and leads its own process group.
 *
 * How the environment is read:
 * - Linux: `/proc/<pid>/{environ,stat}`.
 * - macOS: `ps -E -ww -o pid=,ppid=,command= -p <pid>`, which prints the
 *   environment after the command on one line (no `/proc` there).
 * - Other platforms: returns `[]`, and the caller says so instead of pretending
 *   it swept.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

export interface SweptServer {
  pid: number
  /** Test it belonged to, derived from `MINERVA_USER_DATA_DIR` (`outputPath` carries the test name). */
  test: string
}

/** What the selection rule needs to know about one process. */
export interface ProcessInfo {
  pid: number
  ppid: number
  /** Environment as `K=V` pairs. */
  environ: string[]
}

export const SWEEP_SUPPORTED = process.platform === 'linux' || process.platform === 'darwin'

/** Selection rule: a suite-owned (`PLAYWRIGHT_TEST=1`) process whose app already died (`ppid === 1`). */
export function isSweepable(info: ProcessInfo): boolean {
  return info.environ.includes('PLAYWRIGHT_TEST=1') && info.ppid === 1
}

/**
 * Parses one line of `ps -E -ww -o pid=,ppid=,command= -p <pid>` (macOS).
 * With `-E` the environment follows the command on the same line, separated by
 * single spaces. An env value can itself contain spaces, so the tail is split only
 * where a space precedes something shaped like `NAME=`; the command and its args
 * land glued to the first pair, which is harmless for the lookups done here.
 */
export function parsePsEnvLine(line: string): ProcessInfo | null {
  const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
  if (match === null) return null
  return {
    pid: Number.parseInt(match[1], 10),
    ppid: Number.parseInt(match[2], 10),
    environ: match[3].split(/\s+(?=[A-Za-z_][A-Za-z0-9_]*=)/),
  }
}

/** Test name from the `MINERVA_USER_DATA_DIR` entry (`.../test-results/<test-slug>/user-data`). */
export function describeTest(environ: string[]): string {
  const entry = environ.find((pair) => pair.startsWith('MINERVA_USER_DATA_DIR='))
  if (entry === undefined) return '(unknown)'
  return basename(entry.slice('MINERVA_USER_DATA_DIR='.length).replace(/\/user-data$/, ''))
}

function listOpencodePids(): number[] {
  try {
    return execFileSync('pgrep', ['-x', 'opencode'], { encoding: 'utf-8' })
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    // `pgrep` exits 1 when nothing matches: not an error.
    return []
  }
}

/** Linux: `/proc/<pid>/stat` + `/proc/<pid>/environ`. `null` if it died or access is denied. */
function inspectLinux(pid: number): ProcessInfo | null {
  try {
    // In `/proc/<pid>/stat` the ppid is the 4th field, but the 2nd (comm) can hold
    // spaces inside parentheses, so cut from the LAST ')' to keep indexes aligned.
    const stat = readFileSync('/proc/' + String(pid) + '/stat', 'utf-8')
    const ppid = Number.parseInt(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1], 10)
    const environ = readFileSync('/proc/' + String(pid) + '/environ', 'utf-8').split('\0')
    return { pid, ppid, environ }
  } catch {
    return null
  }
}

/** macOS: one `ps` call gives pid, ppid and environment. `null` if it died or access is denied. */
function inspectDarwin(pid: number): ProcessInfo | null {
  try {
    const out = execFileSync(
      'ps',
      ['-E', '-ww', '-o', 'pid=,ppid=,command=', '-p', String(pid)],
      { encoding: 'utf-8' },
    )
    return parsePsEnvLine(out.split('\n')[0] ?? '')
  } catch {
    // `ps -p` exits 1 when the process is gone.
    return null
  }
}

function inspectProcess(pid: number): ProcessInfo | null {
  return process.platform === 'darwin' ? inspectDarwin(pid) : inspectLinux(pid)
}

/**
 * Kills the suite's orphaned servers and returns which ones they were. An empty
 * list means there was nothing to sweep (the expected case when main's cleanup works).
 */
export function sweepOrphanedOpencodeServers(): SweptServer[] {
  if (!SWEEP_SUPPORTED) return []

  const swept: SweptServer[] = []
  for (const pid of listOpencodePids()) {
    const info = inspectProcess(pid)
    if (info === null || !isSweepable(info)) continue

    swept.push({ pid, test: describeTest(info.environ) })
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already dead: nothing to clean.
      }
    }
  }
  return swept
}

/** Shared log: loud on purpose — if it prints, a cleanup path is being skipped and the net is covering for it. */
export function reportSwept(where: string, swept: SweptServer[]): void {
  if (swept.length === 0) return
  console.log(
    '[' +
      where +
      '] ' +
      String(swept.length) +
      ' orphaned opencode server(s) killed: ' +
      swept.map((s) => s.test + ' (pid ' + String(s.pid) + ')').join(', '),
  )
}
