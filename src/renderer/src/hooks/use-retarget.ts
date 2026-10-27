import { useCallback, useState } from 'react'
import { prKey, repoKey, type RepoRef } from '../../../shared/scm'
import { describeRetargetError, type RetargetFailure } from '../lib/retarget'
import { useAppStore } from '../stores/app-store'
import { useStacksStore } from '../stores/stacks-store'

export type RetargetState =
  | { phase: 'idle' }
  /** Waiting for main: its native confirmation dialog, then the write. */
  | { phase: 'pending'; newBase: string }
  /** A failure that does not make the screen stale (shown in place). */
  | { phase: 'failed'; newBase: string; failure: RetargetFailure }

export type RetargetOutcome = 'retargeted' | 'cancelled' | 'conflict' | 'failed'

interface UseRetargetResult {
  state: RetargetState
  /** Resolves when main answered; never throws (failures land in `state` or the note). */
  retarget: (expectedCurrentBase: string, newBase: string) => Promise<RetargetOutcome>
  reset: () => void
}

/**
 * Change one PR's target branch through `scm:retarget`. Main re-validates and
 * asks the user to confirm with a native dialog before writing.
 *
 * - `retargeted` and `CONFLICT` both make the screen stale: they are recorded
 *   as the retarget note in `stacks-store` (it outlives this hook's caller,
 *   which the refresh usually unmounts: a fixed orphan is no longer listed),
 *   the selected summary is swapped, and `scmDataVersion` is bumped so the PR
 *   list, the open detail and the stacks refetch.
 * - `cancelled` (the user said no in the dialog): back to idle, quietly.
 * - other errors: shown in place by the caller (`state.phase === 'failed'`).
 *
 * One instance per PR: callers remount it with `key` when the PR changes.
 */
export function useRetarget(repo: RepoRef, number: number): UseRetargetResult {
  const repoIdentity = repoKey(repo)
  const [state, setState] = useState<RetargetState>({ phase: 'idle' })
  const bumpScmData = useAppStore((s) => s.bumpScmData)
  const replaceSelectedPr = useAppStore((s) => s.replaceSelectedPr)

  const retarget = useCallback(
    async (expectedCurrentBase: string, newBase: string): Promise<RetargetOutcome> => {
      const { noteRetarget } = useStacksStore.getState()
      setState({ phase: 'pending', newBase })
      try {
        const result = await window.minerva.scm.retarget({
          repo,
          number,
          expectedCurrentBase,
          newBase,
        })
        setState({ phase: 'idle' })
        if (result.outcome === 'cancelled') return 'cancelled'
        noteRetarget({ kind: 'retargeted', pr: result.pr, oldBase: expectedCurrentBase })
        replaceSelectedPr(result.pr)
        bumpScmData()
        return 'retargeted'
      } catch (error: unknown) {
        const failure = describeRetargetError(error, newBase)
        if (failure.shouldRefresh) {
          setState({ phase: 'idle' })
          noteRetarget({ kind: 'conflict', prKey: prKey(repo, number), number, failure })
          bumpScmData()
          return 'conflict'
        }
        setState({ phase: 'failed', newBase, failure })
        return 'failed'
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on `repo`'s identity key, not its object identity.
    [repoIdentity, number, bumpScmData, replaceSelectedPr],
  )

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, retarget, reset }
}
