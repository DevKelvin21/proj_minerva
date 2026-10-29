import { useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import type { CommentThread, ThreadOrigin } from '../../../../shared/types'
import { useThreadFileLines } from '../../hooks/thread-actions'
import type { FileLinesState } from '../../hooks/use-file-content'
import { useRovingTabs } from '../../hooks/use-roving-tabs'
import { excerptWindow, threadLineRange, threadSide } from '../../lib/line-threads'
import {
  hasCommentedVersion,
  removedInPush,
  shortCommit,
  versionLineRange,
  type FileAtHead,
  type ThreadCodeVersion,
} from '../../lib/thread-origin'
import { transText } from '../../lib/trans-text'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'

interface CodeExcerptProps {
  lines: readonly string[]
  from: number
  to: number
  highlight: { start: number; end: number }
}

/** A few numbered lines of a file with the commented range highlighted. Plain text (untrusted). */
export function CodeExcerpt({ lines, from, to, highlight }: CodeExcerptProps): React.JSX.Element {
  const rows: React.ReactNode[] = []
  for (let n = from; n <= to; n++) {
    const marked = n >= highlight.start && n <= highlight.end
    rows.push(
      <div
        key={n}
        data-excerpt-line={n}
        data-highlighted={marked || undefined}
        className={`grid grid-cols-[max-content_minmax(0,1fr)] ${
          marked ? 'bg-accent/15 shadow-[inset_2px_0_0_var(--color-accent)]' : ''
        }`}
      >
        <span className="select-none px-2 text-right text-muted/70">{n}</span>
        <span className="whitespace-pre-wrap break-words px-2 text-text">
          {lines[n - 1] === '' ? ' ' : lines[n - 1]}
        </span>
      </div>,
    )
  }
  return (
    <div
      data-testid="code-excerpt"
      className="overflow-x-auto rounded border border-border bg-code-bg py-1 font-mono text-xs leading-5"
    >
      {rows}
    </div>
  )
}

interface ThreadCodeExcerptProps {
  thread: CommentThread
}

/**
 * The code a line thread points at, so a comment is never shown without its
 * code: in the Comments view, for outdated threads, and for threads the diff
 * can't place. An outdated thread whose provider said where it was written
 * opens on the code as commented, with the latest version one click away;
 * any other reads the PR (head for RIGHT, base for LEFT).
 */
export function ThreadCodeExcerpt({ thread }: ThreadCodeExcerptProps): React.JSX.Element | null {
  if (hasCommentedVersion(thread)) return <VersionedExcerpt thread={thread} />
  return <CurrentExcerpt thread={thread} />
}

/** Lines of `state` around `range`, or why there are none (one line, Retry when it can help). */
function ExcerptBody({
  state,
  range,
  pastEnd,
  missing,
  failed,
}: {
  state: FileLinesState
  range: { start: number; end: number }
  pastEnd: string
  /** Shown for `NOT_FOUND`: the file does not exist at that version. */
  missing: string
  /** Shown for any other failure, with Retry. */
  failed: string
}): React.JSX.Element {
  const { t } = useTranslation()
  if (state.status === 'loading' || state.status === 'idle') {
    return <p className="text-xs text-muted">{t('comments.excerpt.loading')}</p>
  }
  if (state.status === 'error') {
    if (state.code === 'NOT_FOUND') {
      return (
        <p className="text-xs text-muted" data-testid="excerpt-missing">
          {missing}
        </p>
      )
    }
    return (
      <Callout
        tone="danger"
        role="alert"
        data-testid="excerpt-error"
        title={state.error}
        action={
          <Button size="xs" onClick={state.retry}>
            {t('common.retry')}
          </Button>
        }
      >
        {failed}
      </Callout>
    )
  }
  if (state.status === 'unavailable') {
    return <p className="text-xs text-muted">{t(`prDetail.fileContent.${state.reason}`)}</p>
  }
  const win = excerptWindow(range.start, range.end, state.lines.length)
  return win ? (
    <CodeExcerpt lines={state.lines} from={win.from} to={win.to} highlight={range} />
  ) : (
    <p className="text-xs text-muted">{pastEnd}</p>
  )
}

/** Where the thread sits now (head for RIGHT, base for LEFT); outdated ones say it may have moved. */
function CurrentExcerpt({ thread }: ThreadCodeExcerptProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const range = threadLineRange(thread)
  const state = useThreadFileLines(thread, Boolean(thread.path && range))
  if (!thread.path || !range) return null
  const left = threadSide(thread) === 'LEFT'
  return (
    <div
      className="flex flex-col gap-1.5"
      aria-label={t('comments.excerpt.label', { path: thread.path, line: range.start })}
    >
      {thread.isOutdated && (
        <p className="text-xs text-warning" data-testid="outdated-note">
          {t('comments.excerpt.outdatedNote', { line: range.start })}
        </p>
      )}
      <ExcerptBody
        state={state}
        range={range}
        pastEnd={
          left
            ? t('comments.excerpt.pastEndBase', { line: range.start })
            : t('comments.excerpt.pastEndLatest', { line: range.start })
        }
        missing={t('comments.excerpt.missingLatest')}
        failed={t('comments.excerpt.loadError')}
      />
    </div>
  )
}

/** "push 2 of 4" (Azure DevOps) or "commit abc1234" (GitHub), bold, for the strip's sentence. */
function OriginAt({ origin }: { origin: ThreadOrigin }): React.JSX.Element {
  const { t } = useTranslation()
  return origin.push ? (
    <strong className="font-semibold text-text">
      {t('comments.excerpt.pushOf', { index: origin.push.index, total: origin.push.total })}
    </strong>
  ) : (
    <strong className="font-semibold text-text">
      <Trans
        i18nKey="comments.excerpt.commitAt"
        components={{ commit: transText(shortCommit(origin.commit), 'font-mono') }}
      />
    </strong>
  )
}

const COMMENTED: ThreadCodeVersion = 'commented'
const LATEST: ThreadCodeVersion = 'latest'
const VERSIONS: readonly ThreadCodeVersion[] = [COMMENTED, LATEST]
const COMMENTED_ONLY: readonly ThreadCodeVersion[] = [COMMENTED]

/**
 * An outdated thread with an origin: "As commented" (default) reads the file
 * at the origin commit and highlights the origin's lines; "Latest" keeps the
 * head's "around line N" view, and is disabled (reason in its tooltip) when
 * the file no longer exists at head.
 */
function VersionedExcerpt({
  thread,
}: {
  thread: CommentThread & { origin: ThreadOrigin; path: string }
}): React.JSX.Element {
  const { t } = useTranslation()
  const baseId = useId()
  const [chosen, setChosen] = useState<ThreadCodeVersion>('commented')
  const head = useThreadFileLines(thread, true)
  const atHead: FileAtHead =
    head.status === 'error'
      ? head.code === 'NOT_FOUND'
        ? 'missing'
        : 'unknown'
      : head.status === 'ready' || head.status === 'unavailable'
        ? 'present'
        : 'unknown'
  const latestDisabled = atHead === 'missing'
  const version: ThreadCodeVersion = latestDisabled ? 'commented' : chosen
  const commented = useThreadFileLines(thread, version === 'commented', 'origin')
  const { origin } = thread
  const removedIn = removedInPush(origin)

  const tabs = useRovingTabs<ThreadCodeVersion>({
    keys: latestDisabled ? COMMENTED_ONLY : VERSIONS,
    value: version,
    onChange: setChosen,
    tabId: (key) => `${baseId}-${key}`,
    panelId: () => `${baseId}-panel`,
  })
  const tabClass = (selected: boolean, disabled = false): string =>
    `rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
      selected
        ? 'bg-panel text-text shadow-sm'
        : disabled
          ? 'cursor-not-allowed text-muted/50'
          : 'text-muted hover:text-text'
    }`
  const latestReason = latestDisabled
    ? removedIn !== null
      ? t('comments.excerpt.latestGoneInPush', { push: removedIn })
      : t('comments.excerpt.latestGone')
    : undefined

  const at = <OriginAt origin={origin} />
  const latestRange = threadLineRange(thread)
  const range = versionLineRange(thread, version) ?? { start: origin.line, end: origin.line }
  const sentence =
    version === 'latest' ? (
      <Trans
        i18nKey="comments.excerpt.latestAround"
        values={{ line: latestRange?.start ?? origin.line }}
        components={{ at }}
      />
    ) : !latestDisabled ? (
      <Trans i18nKey="comments.excerpt.commentedAt" components={{ at }} />
    ) : removedIn !== null ? (
      <Trans
        i18nKey="comments.excerpt.commentedAtRemovedInPush"
        values={{ push: removedIn }}
        components={{ at }}
      />
    ) : (
      <Trans i18nKey="comments.excerpt.commentedAtRemoved" components={{ at }} />
    )

  const short = shortCommit(origin.commit)
  const body =
    version === 'commented' ? (
      <ExcerptBody
        state={commented}
        range={range}
        pastEnd={t('comments.excerpt.pastEndCommented', { line: range.start })}
        missing={
          origin.push
            ? t('comments.excerpt.missingAtPush', { index: origin.push.index })
            : t('comments.excerpt.missingAtCommit', { commit: short })
        }
        failed={
          origin.push
            ? t('comments.excerpt.loadPushError', { index: origin.push.index })
            : t('comments.excerpt.loadCommitError', { commit: short })
        }
      />
    ) : (
      <ExcerptBody
        state={head}
        range={range}
        pastEnd={t('comments.excerpt.pastEndLatest', { line: range.start })}
        missing={t('comments.excerpt.missingLatest')}
        failed={t('comments.excerpt.loadError')}
      />
    )

  return (
    <div
      className="flex flex-col gap-2"
      data-excerpt-version={version}
      aria-label={t('comments.excerpt.label', { path: thread.path, line: range.start })}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <History size={14} className="shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 basis-56 text-xs text-muted" data-testid="outdated-note">
          {sentence}
        </p>
        <div
          role="tablist"
          aria-label={t('comments.excerpt.versions')}
          className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md bg-bg p-0.5"
        >
          <button
            type="button"
            {...tabs.tabProps(COMMENTED)}
            className={tabClass(version === 'commented')}
          >
            {t('comments.excerpt.asCommented')}
          </button>
          {latestDisabled ? (
            <button
              type="button"
              role="tab"
              id={`${baseId}-latest`}
              aria-selected={false}
              aria-disabled
              tabIndex={-1}
              title={latestReason}
              className={tabClass(false, true)}
            >
              {t('comments.excerpt.latest')}
            </button>
          ) : (
            <button
              type="button"
              {...tabs.tabProps(LATEST)}
              className={tabClass(version === 'latest')}
            >
              {t('comments.excerpt.latest')}
            </button>
          )}
        </div>
      </div>
      <div {...tabs.panelProps(version)}>{body}</div>
    </div>
  )
}
