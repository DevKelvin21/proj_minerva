import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { prKey, type PrStack, type StackNode } from '../../../shared/scm'
import type { PullRequestSummary } from '../../../shared/types'
import { findPullRequest, stackOrder } from '../lib/dashboard'
import { errorText } from '../lib/error-text'
import { useAppStore, type StackNavContext } from '../stores/app-store'
import { useDashboard } from './use-dashboard'

interface UseHomeOpenPrResult {
  /** Opens a PR the dashboard listed; `stack` arms the review view's stack navigator. */
  open: (pr: PullRequestSummary, stack?: PrStack | null) => void
  /**
   * Opens a stack node: from the dashboard's answer when listed there, else
   * after fetching its detail (stacks and the dashboard share the same scope,
   * so this is the rare case of a PR that appeared between the two reads).
   */
  openNode: (node: StackNode, stack: PrStack) => void
  /** Opens the stack's root with the navigator armed ("Review stack"). */
  reviewStack: (stack: PrStack) => void
  /** `prKey` of the PR being fetched, for a spinner on that card. */
  pendingKey: string | null
  error: string | null
}

/**
 * Where the user is: a fallback fetch only applies while this is unchanged,
 * so opening another PR from the sidebar, going Home or changing page (paths
 * that do not go through this hook) also cancels it.
 */
function navigationSignature(): string {
  const { mainView, selectedPr, homeRoute } = useAppStore.getState()
  const selected = selectedPr ? prKey(selectedPr.repo, selectedPr.number) : ''
  return mainView + '\n' + selected + '\n' + JSON.stringify(homeRoute)
}

/** Navigator context of a stack: its PRs root-first, depth-first. */
export function stackNavOf(stack: PrStack): StackNavContext {
  return { rootKey: stack.root.prKey, keys: stackOrder(stack) }
}

/**
 * How the dashboard opens a PR: arms (or clears) the stack navigation,
 * selects the PR (which switches the main view to the review) and seals it
 * seen both in the cached dashboard answer and in main's seen-store.
 *
 * A fallback fetch (`openNode` for a PR the dashboard did not list) is
 * sequenced: its answer is ignored when a newer open happened in between,
 * when the user navigated anywhere else (`navigationSignature`), or when the
 * page that asked was left (unmount), so a slow fetch can never
 * select a PR the user is no longer heading to.
 */
export function useHomeOpenPr(): UseHomeOpenPrResult {
  const { t } = useTranslation()
  const { pullRequests, markSeen } = useDashboard()
  const selectPr = useAppStore((s) => s.selectPr)
  const setStackNav = useAppStore((s) => s.setStackNav)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by every open; a fetch only applies when it is still the latest. `-1` = unmounted. */
  const sequence = useRef(0)

  useEffect(() => {
    sequence.current = 0
    return () => {
      sequence.current = -1
    }
  }, [])

  const open = useCallback(
    (pr: PullRequestSummary, stack: PrStack | null = null) => {
      if (sequence.current >= 0) sequence.current += 1
      setError(null)
      setStackNav(stack ? stackNavOf(stack) : null)
      selectPr(pr)
      markSeen(pr)
    },
    [setStackNav, selectPr, markSeen],
  )

  const openNode = useCallback(
    (node: StackNode, stack: PrStack) => {
      const listed = pullRequests ? findPullRequest(pullRequests, node.prKey) : undefined
      if (listed) {
        open(listed, stack)
        return
      }
      if (sequence.current < 0) return
      const ticket = ++sequence.current
      const startedAt = navigationSignature()
      const current = (): boolean =>
        sequence.current === ticket && navigationSignature() === startedAt
      setError(null)
      setPendingKey(node.prKey)
      window.minerva.scm
        .getPullRequestDetail({ repo: node.repo, number: node.number })
        .then((detail) => {
          if (current()) open(detail, stack)
        })
        .catch((err: unknown) => {
          if (current()) {
            setError(t('errors.openPrFailed', { number: node.number, error: errorText(err) }))
          }
        })
        .finally(() => {
          if (sequence.current >= 0) {
            setPendingKey((pending) => (pending === node.prKey ? null : pending))
          }
        })
    },
    [pullRequests, open, t],
  )

  const reviewStack = useCallback(
    (stack: PrStack) => openNode(stack.root, stack),
    [openNode],
  )

  return { open, openNode, reviewStack, pendingKey, error }
}
