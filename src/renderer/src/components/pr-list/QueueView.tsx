import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { prKey } from '../../../../shared/scm'
import { useDashboard, useViewerIdentity } from '../../hooks/use-dashboard'
import { useHomeOpenPr } from '../../hooks/use-home-open-pr'
import {
  buildReviewQueue,
  QUEUE_SECTIONS,
  type QueueSection,
  type QueueStatus,
} from '../../lib/review-queue'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import { useAppStore } from '../../stores/app-store'
import { PrListItem } from './PrListItem'

const STATUS_TONE: Record<Exclude<QueueStatus, null>, string> = {
  optional: 'bg-border/60 text-muted',
  newComments: 'bg-accent/15 text-accent',
  newCommits: 'bg-accent/15 text-accent',
  draft: 'bg-border/60 text-muted',
  ciFailing: 'bg-danger/15 text-danger',
  changesRequested: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  waiting: 'bg-border/60 text-muted',
}

const FOLDED_KEY = 'minerva.queueFolded'

/** Folded sections, remembered per machine. Unreadable storage = nothing folded. */
function readFolded(): Set<QueueSection> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]')
    if (!Array.isArray(raw)) return new Set()
    return new Set(raw.filter((s): s is QueueSection => QUEUE_SECTIONS.includes(s as QueueSection)))
  } catch {
    return new Set()
  }
}

function writeFolded(folded: Set<QueueSection>): void {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]))
  } catch {
    // Storage full or blocked: folding still works for this session.
  }
}

/**
 * The sidebar's default view: open PRs sorted by what they need from you
 * (`lib/review-queue.ts`). Same rows as the Repos view, plus their repo and
 * one status. Every section folds; nothing is folded until you do it, so no
 * PR is ever hidden by default. The search field above filters it locally.
 */
export function QueueView(): React.JSX.Element {
  const { t } = useTranslation()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const { pullRequests, providerErrors, loading, error } = useDashboard()
  const identity = useViewerIdentity()
  const { open } = useHomeOpenPr()
  const [folded, setFolded] = useState(readFolded)

  const queue = useMemo(
    () => buildReviewQueue(pullRequests ?? [], identity, searchQuery),
    [pullRequests, identity, searchQuery],
  )
  const total = QUEUE_SECTIONS.reduce((sum, section) => sum + queue[section].length, 0)

  function toggle(section: QueueSection): void {
    setFolded((current) => {
      const nextFolded = new Set(current)
      if (nextFolded.has(section)) nextFolded.delete(section)
      else nextFolded.add(section)
      writeFolded(nextFolded)
      return nextFolded
    })
  }

  if (error) {
    return <p className="p-4 text-sm text-danger">{t('layout.queue.loadFailed', { error })}</p>
  }
  if (pullRequests === null) {
    return (
      <p className="p-4 text-sm text-muted">
        {loading ? t('layout.sidebar.loading') : t('layout.queue.empty')}
      </p>
    )
  }

  return (
    <div data-testid="review-queue" className="flex min-h-0 flex-col pb-2">
      {providerErrors.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-border p-3">
          {providerErrors.map((providerError) => (
            <p
              key={providerError.provider}
              data-error-code={providerError.code}
              className="text-xs text-danger"
            >
              {SCM_PROVIDER_LABEL[providerError.provider]}: {providerError.message}
            </p>
          ))}
        </div>
      )}
      {total === 0 && (
        <p className="p-4 text-sm text-muted">
          {searchQuery.trim()
            ? t('layout.sidebar.noMatches', { query: searchQuery })
            : t('layout.queue.empty')}
        </p>
      )}
      {QUEUE_SECTIONS.map((section) => {
        const entries = queue[section]
        if (entries.length === 0) return null
        const isFolded = folded.has(section)
        return (
          <section key={section} data-testid="queue-section" data-section={section}>
            <button
              type="button"
              onClick={() => toggle(section)}
              aria-expanded={!isFolded}
              className="flex w-full items-center gap-1.5 px-3 pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted transition-colors duration-150 hover:text-text"
            >
              {isFolded ? (
                <ChevronRight size={13} aria-hidden />
              ) : (
                <ChevronDown size={13} aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{t(`layout.queue.section.${section}`)}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  section === 'needsReview' ? 'bg-accent text-accent-fg' : 'bg-border/60 text-muted'
                }`}
              >
                {entries.length}
              </span>
            </button>
            {!isFolded && (
              <ul>
                {entries.map(({ pr, status }) => (
                  <li key={prKey(pr.repo, pr.number)}>
                    <PrListItem
                      pr={pr}
                      onSelect={(picked) => open(picked)}
                      showRepo
                      badge={
                        status ? (
                          <span
                            data-queue-status={status}
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${STATUS_TONE[status]}`}
                          >
                            {t(`layout.queue.status.${status}`)}
                          </span>
                        ) : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
