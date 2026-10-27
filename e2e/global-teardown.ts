/**
 * Final sweep of orphaned `opencode serve` servers (~300 MB each).
 *
 * `closeMinerva` (`./fixtures.ts`) already sweeps after every test, so only what
 * a test left that never reached its teardown (timeout, worker SIGKILL) can
 * remain here. Rule and motivation: see `./opencode-sweep.ts`.
 */
import { reportSwept, sweepOrphanedOpencodeServers, SWEEP_SUPPORTED } from './opencode-sweep'

export default function globalTeardown(): void {
  if (!SWEEP_SUPPORTED) {
    console.log('[teardown] opencode sweep skipped: only supported on Linux (/proc) and macOS (ps).')
    return
  }
  reportSwept('teardown', sweepOrphanedOpencodeServers())
}
