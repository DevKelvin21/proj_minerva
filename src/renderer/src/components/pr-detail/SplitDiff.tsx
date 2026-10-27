import { Fragment, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { buildSplitRows, type SplitCell, type SplitRow } from '../../lib/diff-parser'
import type { DiffThreadsModel } from '../../lib/diff-threads'
import type { HighlightToken } from '../../lib/highlighter'
import { lineThreadKey, resolveNewThreadPosition, type LineSide } from '../../lib/line-threads'
import { DiffLineContent } from './DiffLineContent'
import { DiffExpander } from './DiffExpander'
import { LineThreadIndicator } from './LineThreadIndicator'
import { InlineThreadCard } from './InlineThreadCard'
import { LineCommentComposer } from './LineCommentComposer'
import { asHunk, KIND_BG, rangeClasses, type DiffBodyProps, type OpenComposer } from './diff-body'

/** Everything a split row needs in both layouts (wrap and no-wrap). */
interface RowMeta {
  rowKey: string
  row: SplitRow
  leftBg: string
  rightBg: string
  leftKey?: string
  rightKey?: string
  leftThreads: CommentThread[]
  rightThreads: CommentThread[]
  onAddLeft?: () => void
  onAddRight?: () => void
}

type Item = { type: 'full'; key: string; node: React.ReactNode } | { type: 'row'; meta: RowMeta }

interface SideCellsProps {
  cell?: SplitCell
  side: LineSide
  positionKey?: string
  bg: string
  contentClass: string
  threadList: CommentThread[]
  model: DiffThreadsModel
  onAdd?: () => void
  getTokens: (content: string) => HighlightToken[] | undefined
}

/**
 * Gutter + content of one side (old or new) of a split row. Returns a
 * fragment: both children become sibling cells of the grid around it.
 */
function SideCells({
  cell,
  side,
  positionKey,
  bg,
  contentClass,
  threadList,
  model,
  onAdd,
  getTokens,
}: SideCellsProps): React.JSX.Element {
  const inRange = positionKey ? model.rangeKeys.has(positionKey) : false
  const focused = positionKey ? model.focusedKeys.has(positionKey) : false
  const marks = rangeClasses(inRange, focused)
  const commentCount = threadList.reduce((sum, t) => sum + t.comments.length, 0)
  return (
    <>
      <span className={`flex items-center justify-end gap-1 px-2 text-muted/70 ${bg} ${marks}`}>
        {threadList.length > 0 && positionKey ? (
          <LineThreadIndicator
            hidden={model.hiddenKeys.has(positionKey)}
            count={commentCount}
            onClick={() => model.toggleHidden(positionKey)}
          />
        ) : onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a comment on this line"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent focus:opacity-100 group-hover/row:opacity-100"
          >
            <Plus size={12} />
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        <span className="select-none">{cell?.number ?? ''}</span>
      </span>
      <span
        data-old-line={side === 'LEFT' && cell ? cell.number : undefined}
        data-new-line={side === 'RIGHT' && cell ? cell.number : undefined}
        data-focused={focused || undefined}
        className={`px-2 ${contentClass} ${bg} ${focused ? 'bg-accent/20' : ''} text-text`}
      >
        {cell && <DiffLineContent content={cell.content} tokens={getTokens(cell.content)} />}
      </span>
    </>
  )
}

/**
 * Split view (old | new) of a file's diff sections: hunks, revealed context
 * and expanders for hidden lines. Threads render under their row, full width.
 *
 * With word wrap: one 4-column CSS grid, so gutters share their width across
 * hunks (T18) and the grid never exceeds its container (`minmax(0, 1fr)`).
 *
 * Without wrap: two 50/50 panels per run of rows, each with ITS OWN horizontal
 * scroll (VS Code style). A single grid made each content column grow to its
 * longest line and pushed the new side out of view (T49). Rows line up for
 * free: without wrap every row is exactly one line tall (`leading-5`). The
 * gutter width is fixed by digit count so it matches across panels.
 */
export function SplitDiff({
  sections,
  hunkCount,
  wordWrap,
  getTokens,
  threads: model,
  expander,
  onCreateThread,
}: DiffBodyProps): React.JSX.Element {
  const [openComposer, setOpenComposer] = useState<OpenComposer | null>(null)

  const rowsBySection = useMemo(
    () =>
      sections.map((s) =>
        s.type === 'gap' ? [] : buildSplitRows([s.type === 'hunk' ? s.hunk : asHunk(s.lines)]),
      ),
    [sections],
  )

  const gutterDigits = useMemo(() => {
    let max = 1
    for (const rows of rowsBySection) {
      for (const row of rows) {
        if (row.left) max = Math.max(max, String(row.left.number).length)
        if (row.right) max = Math.max(max, String(row.right.number).length)
      }
    }
    return max
  }, [rowsBySection])

  function rowMeta(rowKey: string, row: SplitRow): RowMeta {
    const leftKey = row.left ? lineThreadKey(row.left.number, 'LEFT') : undefined
    const rightKey = row.right ? lineThreadKey(row.right.number, 'RIGHT') : undefined
    const leftThreads = (leftKey && model.byPosition.get(leftKey)) || []
    const rightThreads = (rightKey && model.byPosition.get(rightKey)) || []
    // A comment on a deletion uses the old line (LEFT); on context or an
    // addition, the new line (RIGHT). A context row's left cell offers no "+"
    // (its right cell already does, same logical line).
    const leftPosition =
      row.left?.kind === 'del'
        ? resolveNewThreadPosition(true, row.left.number, undefined)
        : undefined
    const rightPosition = row.right
      ? resolveNewThreadPosition(false, undefined, row.right.number)
      : undefined
    return {
      rowKey,
      row,
      leftBg: row.left ? (KIND_BG[row.left.kind] ?? '') : '',
      rightBg: row.right ? (KIND_BG[row.right.kind] ?? '') : '',
      leftKey,
      rightKey,
      leftThreads,
      rightThreads,
      onAddLeft:
        leftPosition && row.left
          ? () => setOpenComposer({ key: rowKey, content: row.left!.content, ...leftPosition })
          : undefined,
      onAddRight:
        rightPosition && row.right
          ? () => setOpenComposer({ key: rowKey, content: row.right!.content, ...rightPosition })
          : undefined,
    }
  }

  /** Thread cards and/or the composer that go full width after a row. */
  function blocksAfter(meta: RowMeta): Item[] {
    const items: Item[] = []
    const groups: Array<[string | undefined, CommentThread[]]> = [
      [meta.leftKey, meta.leftThreads],
      [meta.rightKey, meta.rightThreads],
    ]
    for (const [key, list] of groups) {
      if (!key || model.hiddenKeys.has(key)) continue
      for (const thread of list) {
        items.push({
          type: 'full',
          key: `thread-${thread.id}`,
          node: (
            <InlineThreadCard
              thread={thread}
              highlighted={thread.id === model.focusedThreadId}
              onHide={() => model.toggleHidden(key)}
            />
          ),
        })
      }
    }
    if (openComposer?.key === meta.rowKey) {
      const composer = openComposer
      items.push({
        type: 'full',
        key: `composer-${meta.rowKey}`,
        node: (
          <LineCommentComposer
            line={composer.line}
            side={composer.side}
            lineContent={composer.content}
            onCancel={() => setOpenComposer(null)}
            onSubmit={async (bodyMarkdown) => {
              await onCreateThread(composer.line, composer.side, bodyMarkdown)
              setOpenComposer(null)
            }}
          />
        ),
      })
    }
    return items
  }

  const items: Item[] = []
  sections.forEach((section, s) => {
    if (section.type === 'gap') {
      items.push({
        type: 'full',
        key: section.key,
        node: (
          <DiffExpander
            gap={section.gap}
            hunkCount={hunkCount}
            loading={expander.loading}
            error={expander.error}
            onExpand={(direction) => expander.onExpand(section.gap, direction)}
          />
        ),
      })
      return
    }
    if (section.type === 'hunk') {
      items.push({
        type: 'full',
        key: section.key,
        node: (
          <div className="border-y border-border bg-panel px-3 py-1 font-mono text-[11px] text-muted">
            {section.hunk.header}
          </div>
        ),
      })
    }
    rowsBySection[s].forEach((row, i) => {
      const meta = rowMeta(`${section.key}:${i}`, row)
      items.push({ type: 'row', meta })
      items.push(...blocksAfter(meta))
    })
  })

  function cells(meta: RowMeta, side: 'left' | 'right', contentClass: string): React.JSX.Element {
    return (
      <SideCells
        cell={side === 'left' ? meta.row.left : meta.row.right}
        side={side === 'left' ? 'LEFT' : 'RIGHT'}
        positionKey={side === 'left' ? meta.leftKey : meta.rightKey}
        bg={side === 'left' ? meta.leftBg : meta.rightBg}
        contentClass={contentClass}
        threadList={side === 'left' ? meta.leftThreads : meta.rightThreads}
        model={model}
        onAdd={
          side === 'left'
            ? meta.leftThreads.length === 0
              ? meta.onAddLeft
              : undefined
            : meta.rightThreads.length === 0
              ? meta.onAddRight
              : undefined
        }
        getTokens={getTokens}
      />
    )
  }

  if (wordWrap) {
    return (
      <div
        className="grid font-mono text-xs leading-5"
        style={{ gridTemplateColumns: 'max-content minmax(0, 1fr) max-content minmax(0, 1fr)' }}
      >
        {items.map((item) =>
          item.type === 'full' ? (
            <div key={item.key} style={{ gridColumn: '1 / -1' }} className="min-w-0">
              {item.node}
            </div>
          ) : (
            // `contents` takes the wrapper out of the grid layout (its children
            // become grid items) but keeps it in the DOM for `group-hover`.
            <div key={item.meta.rowKey} className="group/row contents">
              {cells(item.meta, 'left', 'whitespace-pre-wrap break-words')}
              {cells(item.meta, 'right', 'whitespace-pre-wrap break-words')}
            </div>
          ),
        )}
      </div>
    )
  }

  // Without wrap: runs of rows go in two panels; full-width items cut the run.
  const gutterWidth = `calc(${gutterDigits}ch + 2.25rem)`
  const segments: Array<{ key: string; rows: RowMeta[] } | { key: string; node: React.ReactNode }> =
    []
  let run: RowMeta[] = []
  for (const item of items) {
    if (item.type === 'row') {
      run.push(item.meta)
      continue
    }
    if (run.length) segments.push({ key: `run-${run[0].rowKey}`, rows: run })
    run = []
    segments.push({ key: item.key, node: item.node })
  }
  if (run.length) segments.push({ key: `run-${run[0].rowKey}`, rows: run })

  return (
    <div className="font-mono text-xs leading-5">
      {segments.map((segment) =>
        'node' in segment ? (
          <Fragment key={segment.key}>{segment.node}</Fragment>
        ) : (
          <div key={segment.key} className="grid grid-cols-2">
            {(['left', 'right'] as const).map((side) => (
              <div
                key={side}
                className={`overflow-x-auto ${side === 'right' ? 'border-l border-border' : ''}`}
              >
                <div
                  className="grid w-max min-w-full"
                  style={{ gridTemplateColumns: `${gutterWidth} minmax(max-content, 1fr)` }}
                >
                  {segment.rows.map((meta) => (
                    <div key={meta.rowKey} className="group/row contents">
                      {cells(meta, side, 'whitespace-pre')}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  )
}
