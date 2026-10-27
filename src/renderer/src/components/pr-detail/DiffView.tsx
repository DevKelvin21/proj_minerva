import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquareWarning } from 'lucide-react'
import type { CommentThread, DiffFile, RepoRef } from '../../../../shared/types'
import type { DiffViewMode } from '../../stores/app-store'
import { useAppStore } from '../../stores/app-store'
import { parsePatch } from '../../lib/diff-parser'
import { indexLineThreads, threadSide, type LineSide } from '../../lib/line-threads'
import {
  autoRevealRanges,
  buildDiffSections,
  classifyAnchor,
  expandRange,
  type HiddenGap,
  type LineRange,
} from '../../lib/expand-context'
import {
  linePositions,
  threadRangeKeys,
  unplacedThreads,
  type DiffThreadsModel,
} from '../../lib/diff-threads'
import { useElementWidth } from '../../hooks/use-element-width'
import { useFileLines } from '../../hooks/use-file-content'
import { useThreadActions } from '../../hooks/thread-actions'
import { SPLIT_DIFF_MIN_WIDTH } from '../../lib/layout'
import { noPatchMessage } from '../../lib/scm-labels'
import { useLineHighlights } from '../../hooks/use-line-highlights'
import type { LayerFocus } from '../../lib/walkthrough'
import { DiffToolbar } from './DiffToolbar'
import { SplitDiff } from './SplitDiff'
import { InlineDiff } from './InlineDiff'
import { ThreadCard } from './ThreadCard'

const EMPTY_KEYS: ReadonlySet<string> = new Set()

interface DiffViewProps {
  file: DiffFile
  mode: DiffViewMode
  onModeChange: (mode: DiffViewMode) => void
  wordWrap: boolean
  onToggleWordWrap: () => void
  repo: RepoRef
  number: number
  /** Every thread of the PR; filtered here to this file's. */
  threads: CommentThread[]
  reloadThreads: () => Promise<CommentThread[]>
  /** Only when the file tree is a drawer (F16/T85): "N files" button in the toolbar. */
  fileTreeToggle?: { open: boolean; count: number; onToggle: () => void }
  /**
   * Active walkthrough layer in THIS file (Files tab in layers mode): its
   * lines get a marker and the diff scrolls to the first one. `token` bumps
   * every time the reviewer picks a layer or file again, so re-picking the
   * same layer scrolls again.
   */
  layerFocus?: LayerFocus & { token: number }
  /** Rendered between the toolbar and the diff (the layer context bar). */
  banner?: React.ReactNode
}

/**
 * Main panel: toolbar + diff (split or inline) of the selected file, with its
 * comment threads always next to the code they talk about.
 *
 * Expand context: hidden lines (before, between and after hunks) come from
 * the head file (`scm:getFileContent`), fetched on the first expand click, or
 * right away when a thread sits on a hidden line: those lines are revealed
 * automatically (`autoRevealRanges`) so the thread shows in place. Threads no
 * row can host (file-level, past the end of the file, or the file could not
 * be fetched) render above the diff with a code excerpt.
 *
 * F16/T86 — `effectiveMode`: under `SPLIT_DIFF_MIN_WIDTH` (560px of REAL panel)
 * split is unreadable, so inline renders even if split is the saved
 * preference. The preference is not overwritten in the store.
 *
 * Mounted with `key={file.path}`: expanded ranges and hidden threads reset per file.
 */
export function DiffView({
  file,
  mode,
  onModeChange,
  wordWrap,
  onToggleWordWrap,
  repo,
  number,
  threads,
  reloadThreads,
  fileTreeToggle,
  layerFocus,
  banner,
}: DiffViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const actions = useThreadActions()
  const { ref, width } = useElementWidth<HTMLElement>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const splitTooNarrow = width !== null && width < SPLIT_DIFF_MIN_WIDTH
  const effectiveMode: DiffViewMode = mode === 'split' && splitTooNarrow ? 'inline' : mode
  const hunks = useMemo(() => parsePatch(file.patch ?? ''), [file.patch])
  const { getTokens } = useLineHighlights(file.path, file.patch)

  const [userRanges, setUserRanges] = useState<LineRange[]>([])
  const [wantContent, setWantContent] = useState(false)
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(() => new Set())

  const expandedThreadId = useAppStore((s) => s.expandedThreadId)
  const setExpandedThreadId = useAppStore((s) => s.setExpandedThreadId)
  const pendingThreadFocus = useAppStore((s) => s.pendingThreadFocus)
  const clearPendingThreadFocus = useAppStore((s) => s.clearPendingThreadFocus)

  const fileThreads = useMemo(
    () => threads.filter((t) => t.path === file.path),
    [threads, file.path],
  )
  const lineThreads = useMemo(() => fileThreads.filter((t) => t.line !== undefined), [fileThreads])
  const byPosition = useMemo(() => indexLineThreads(threads, file.path), [threads, file.path])

  const hasDiff = !file.isBinary && Boolean(file.patch) && hunks.length > 0
  const canExpand = hasDiff && file.status !== 'removed'
  const threadsInHiddenLines = useMemo(
    () =>
      lineThreads.some(
        (t) => classifyAnchor(hunks, t.line!, threadSide(t), null).placement === 'gap',
      ),
    [lineThreads, hunks],
  )
  const head = useFileLines(
    canExpand && (wantContent || threadsInHiddenLines)
      ? { repo, number, headSha: actions.headSha, path: file.path, side: 'head' }
      : null,
  )
  const headLines = head.status === 'ready' ? head.lines : null

  const sections = useMemo(() => {
    const auto = headLines
      ? autoRevealRanges(
          hunks,
          lineThreads.map((t) => ({ line: t.line!, lineEnd: t.lineEnd, side: threadSide(t) })),
          headLines.length,
        )
      : []
    return buildDiffSections(hunks, headLines, [...userRanges, ...auto])
  }, [hunks, headLines, lineThreads, userRanges])

  const visibleKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const section of sections) {
      const lines =
        section.type === 'hunk'
          ? section.hunk.lines
          : section.type === 'context'
            ? section.lines
            : []
      for (const line of lines) for (const key of linePositions(line)) keys.add(key)
    }
    return keys
  }, [sections])

  const unplaced = useMemo(
    () => unplacedThreads(fileThreads, visibleKeys),
    [fileThreads, visibleKeys],
  )
  const placingThreads = head.status === 'loading'

  const toggleHidden = useCallback((key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const model: DiffThreadsModel = useMemo(() => {
    const focused = lineThreads.find((t) => t.id === expandedThreadId)
    return {
      byPosition,
      hiddenKeys,
      toggleHidden,
      focusedThreadId: expandedThreadId,
      rangeKeys: threadRangeKeys(lineThreads),
      focusedKeys: focused ? threadRangeKeys([focused]) : new Set<string>(),
    }
  }, [byPosition, hiddenKeys, toggleHidden, expandedThreadId, lineThreads])

  // Arriving from the Comments view or a `path:line` chip: scroll to the
  // thread once its row exists. While the file is still being fetched to
  // reveal hidden lines, wait (the effect re-runs when it lands).
  useEffect(() => {
    if (!pendingThreadFocus || pendingThreadFocus.path !== file.path) return
    const el = document.getElementById(`thread-${pendingThreadFocus.threadId}`)
    if (!el && head.status === 'loading') return
    el?.scrollIntoView({ block: 'center' })
    clearPendingThreadFocus()
  }, [pendingThreadFocus, file.path, head.status, sections, clearPendingThreadFocus])

  // Scroll to the first line of the active layer's range in this file (its
  // row carries `data-new-line`/`data-old-line`). A line hidden in a collapsed
  // gap has no row yet: nothing to scroll to, the marker shows once expanded.
  const layerFirst = layerFocus?.first ?? null
  const layerToken = layerFocus?.token ?? 0
  useEffect(() => {
    if (!layerFirst || !scrollRef.current) return
    const attr = layerFirst.side === 'LEFT' ? 'data-old-line' : 'data-new-line'
    const el = scrollRef.current.querySelector(`[${attr}="${layerFirst.line}"]`)
    el?.scrollIntoView({ block: 'center' })
    // `layerToken` is the "scroll again" signal, not a value this effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerFirst?.side, layerFirst?.line, layerToken, sections])

  function handleExpand(gap: HiddenGap, direction: 'up' | 'down' | 'all'): void {
    setUserRanges((prev) => [...prev, expandRange(gap, direction)])
    setWantContent(true)
  }

  async function handleCreateThread(
    line: number,
    side: LineSide,
    bodyMarkdown: string,
  ): Promise<void> {
    const comment = await window.minerva.scm.postComment({
      repo,
      number,
      bodyMarkdown,
      path: file.path,
      line,
      side,
    })
    const refreshed = await reloadThreads()
    const created = refreshed.find(
      (t) =>
        t.isLineThread &&
        t.path === file.path &&
        t.line === line &&
        t.comments.some((c) => c.id === comment.id),
    )
    if (created) setExpandedThreadId(created.id)
  }

  const unplacedBlock =
    unplaced.length > 0 ? (
      <div
        data-testid="unplaced-threads"
        className="flex flex-col gap-2 border-b border-border bg-panel/40 p-2"
      >
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <MessageSquareWarning size={13} className="shrink-0" />
          {placingThreads
            ? t('prDetail.diff.loadingUnplaced', { count: unplaced.length })
            : head.status === 'error'
              ? t('prDetail.diff.unplacedLoadError', { error: head.error })
              : t('prDetail.diff.unplaced', { count: unplaced.length })}
        </p>
        {!placingThreads &&
          unplaced.map((thread) => (
            <div key={thread.id} id={`thread-${thread.id}`}>
              <ThreadCard
                thread={thread}
                showPath={false}
                showExcerpt
                highlighted={thread.id === expandedThreadId}
              />
            </div>
          ))}
      </div>
    ) : null

  const bodyProps = {
    sections,
    hunkCount: hunks.length,
    wordWrap,
    getTokens,
    threads: model,
    layerKeys: layerFocus?.keys ?? EMPTY_KEYS,
    expander: {
      loading: head.status === 'loading',
      error:
        head.status === 'error'
          ? head.error
          : head.status === 'unavailable'
            ? t(`prDetail.fileContent.${head.reason}`)
            : null,
      onExpand: handleExpand,
    },
    onCreateThread: handleCreateThread,
    // "Ask AI" on a line: the old side asks about the file as it was (its
    // previous path when renamed), the new side about the PR head.
    askAi: (line: number, side: LineSide, question: string) =>
      window.minerva.ai.askAboutLines({
        repo,
        number,
        path: side === 'LEFT' ? (file.previousPath ?? file.path) : file.path,
        side: side === 'LEFT' ? 'old' : 'new',
        startLine: line,
        endLine: line,
        question,
      }),
  }

  return (
    <section ref={ref} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <DiffToolbar
        file={file}
        mode={effectiveMode}
        onModeChange={onModeChange}
        wordWrap={wordWrap}
        onToggleWordWrap={onToggleWordWrap}
        splitTooNarrow={splitTooNarrow}
        fileTreeToggle={fileTreeToggle}
        compact={width !== null && width < 520}
      />
      {banner}

      <div ref={scrollRef} className="flex-1 overflow-auto" data-testid="diff-scroll">
        {!hasDiff ? (
          <>
            <p className="p-4 text-sm text-muted" data-patch-omitted={file.patchOmitted}>
              {file.isBinary ? t('prDetail.diff.noPreview') : noPatchMessage(file.patchOmitted, t)}
            </p>
            {unplacedBlock}
          </>
        ) : (
          <>
            {unplacedBlock}
            {effectiveMode === 'split' ? (
              <SplitDiff {...bodyProps} />
            ) : (
              <InlineDiff {...bodyProps} />
            )}
          </>
        )}
      </div>
    </section>
  )
}
