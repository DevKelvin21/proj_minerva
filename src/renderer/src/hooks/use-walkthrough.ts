import { useMemo } from 'react'
import type { RepoRef, WalkthroughCohort } from '../../../shared/types'
import { useDidacticAnalysis } from './use-didactic-analysis'
import { findWalkthrough } from '../lib/walkthrough'

export type WalkthroughStatus =
  /** Still asking main whether an analysis exists. */
  | 'checking'
  /** No analysis for this PR yet: offer to run one. */
  | 'idle'
  /** An analysis is running and the walkthrough section has not opened yet. */
  | 'analyzing'
  /** Layers are arriving (the list may still grow). */
  | 'streaming'
  /** Final result with a walkthrough. */
  | 'ready'
  /** Final result WITHOUT a walkthrough (older analysis, or the model skipped it). */
  | 'missing'
  | 'error'

export interface UseWalkthroughResult {
  cohorts: WalkthroughCohort[] | null
  status: WalkthroughStatus
  error: string | null
  /** Runs (or re-runs) the didactic analysis; main dedupes an in-flight one per PR. */
  analyze: () => void
}

/**
 * The guided walkthrough of a PR for the Files tab, derived from the same
 * didactic analysis the right panel shows (one LLM call serves both). Piggybacks
 * on `useDidacticAnalysis`: it auto-attaches to a cached or in-flight analysis
 * and only starts one when the user asks (`analyze`).
 */
export function useWalkthrough(repo: RepoRef, number: number): UseWalkthroughResult {
  const { analysis, streamingSections, checkingCache, loading, error, analyze, reanalyze } =
    useDidacticAnalysis({ repo, number })

  const section = useMemo(
    () => findWalkthrough(analysis?.sections ?? streamingSections ?? []),
    [analysis, streamingSections],
  )

  let status: WalkthroughStatus
  if (error) status = 'error'
  else if (analysis) status = section ? 'ready' : 'missing'
  else if (section) status = 'streaming'
  else if (loading || streamingSections !== null) status = 'analyzing'
  else if (checkingCache) status = 'checking'
  else status = 'idle'

  return {
    cohorts: section?.cohorts ?? null,
    status,
    error,
    // A final analysis without walkthrough needs a fresh run (cache drop);
    // anything else is a plain analyze (cache miss or in-flight join).
    analyze: status === 'missing' ? reanalyze : analyze,
  }
}
