import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityItem } from '../../../shared/activity'
import { activityTarget } from '../lib/activity'
import { findPullRequest } from '../lib/dashboard'
import { errorText } from '../lib/error-text'
import { useActivityInboxStore } from '../stores/activity-inbox-store'
import { useAppStore } from '../stores/app-store'
import { useDashboard } from './use-dashboard'

/** The inbox state, subscribing the window to main's pushes on first use. */
export function useActivity() {
  const state = useActivityInboxStore((s) => s.state)
  const error = useActivityInboxStore((s) => s.error)
  const start = useActivityInboxStore((s) => s.start)
  const markRead = useActivityInboxStore((s) => s.markRead)
  useEffect(() => start(), [start])
  return { state, error, markRead }
}

/** Unread items, for the tab and rail badges. */
export function useUnreadActivityCount(): number {
  const start = useActivityInboxStore((s) => s.start)
  useEffect(() => start(), [start])
  return useActivityInboxStore((s) => s.state?.unreadCount ?? 0)
}

interface UseOpenActivityItemResult {
  /** Opens the item's PR at its thread and marks the item read. */
  open: (item: ActivityItem) => void
  /** `prKey` of the PR being fetched (not in the dashboard's answer yet). */
  pendingKey: string | null
  error: string | null
}

/**
 * Opening an inbox item: the PR summary comes from the dashboard's answer
 * when it is there, else from `scm:getPullRequestDetail`. A slow fetch is
 * dropped when another item was opened meanwhile or the view unmounted.
 */
export function useOpenActivityItem(): UseOpenActivityItemResult {
  const { t } = useTranslation()
  const { pullRequests, markSeen } = useDashboard()
  const openPrAt = useAppStore((s) => s.openPrAt)
  const markRead = useActivityInboxStore((s) => s.markRead)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by every open; `-1` = unmounted. */
  const sequence = useRef(0)

  useEffect(() => {
    sequence.current = 0
    return () => {
      sequence.current = -1
    }
  }, [])

  const open = useCallback(
    (item: ActivityItem) => {
      if (sequence.current < 0) return
      const ticket = ++sequence.current
      setError(null)
      if (!item.read) void markRead({ ids: [item.id] })
      const listed = pullRequests ? findPullRequest(pullRequests, item.prKey) : undefined
      if (listed) {
        setPendingKey(null)
        openPrAt(listed, activityTarget(item))
        markSeen(listed)
        return
      }
      setPendingKey(item.prKey)
      window.minerva.scm
        .getPullRequestDetail({ repo: item.repo, number: item.number })
        .then((detail) => {
          if (sequence.current === ticket) openPrAt(detail, activityTarget(item))
        })
        .catch((err: unknown) => {
          if (sequence.current === ticket) {
            setError(t('errors.openPrFailed', { number: item.number, error: errorText(err) }))
          }
        })
        .finally(() => {
          if (sequence.current === ticket) setPendingKey(null)
        })
    },
    [pullRequests, openPrAt, markSeen, markRead, t],
  )

  return { open, pendingKey, error }
}
