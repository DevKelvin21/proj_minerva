import { Fragment, useMemo } from 'react'
import type { CommentThread } from '../../../../shared/types'
import { buildSplitRows, type SplitCell, type SplitRow } from '../../lib/diff-parser'
import type { DiffThreadsModel } from '../../lib/diff-threads'
import type { HighlightToken } from '../../lib/highlighter'
import { lineThreadKey, resolveNewThreadPosition, type LineSide } from '../../lib/line-threads'
import { DiffLineContent } from './DiffLineContent'
import { DiffExpander } from './DiffExpander'
import { DiffGutterActions, type GutterChat } from './DiffGutterActions'
import { DiffInsertRow } from './DiffInsertRow'
import { InlineThreadCard } from './InlineThreadCard'
import { LineCommentComposer } from './LineCommentComposer'
import { LineChatInput } from './LineChatInput'
import {
  asHunk,
  KIND_BG,
  LAYER_ROW_CLASS,
  onRow,
  rangeClasses,
  samePosition,
  type DiffBodyProps,
  type LinePosition,
} from './diff-body'

const SIDES = ['left', 'right'] as const
const WRAP_CONTENT = 'whitespace-pre-wrap break-words'
const NOWRAP_CONTENT = 'whitespace-pre'

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
  /** Where a new comment (or a chat note) on each side goes; absent = none there. */
  leftPosition?: LinePosition
  rightPosition?: LinePosition
}

/** `insert` = under a row (thread, composer, chat input): drawn in `DiffInsertRow`. */
type Item =
  | { type: 'full'; key: string; node: React.ReactNode; insert?: boolean }
  | { type: 'row'; meta: RowMeta }

interface SideCellsProps {
  cell?: SplitCell
  side: LineSide
  positionKey?: string
  bg: string
  contentClass: string
  threadList: CommentThread[]
  model: DiffThreadsModel
  inLayer: boolean
  /** Where a new comment (or chat note) on this side goes; absent = no actions here. */
  position?: LinePosition
  onAdd?: () => void
  /** "Add to chat" on this side; absent = no sparkle (feature off or no position). */
  chat?: GutterChat
  /** Reserve the sparkle's slot even without a button here, so gutters line up. */
  chatSlot: boolean
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
  inLayer,
  position,
  onAdd,
  chat,
  chatSlot,
  getTokens,
}: SideCellsProps): React.JSX.Element {
  const inRange = positionKey ? model.rangeKeys.has(positionKey) : false
  const focused = positionKey ? model.focusedKeys.has(positionKey) : false
  // A thread mark wins over the layer mark on the same gutter (both are inset shadows).
  const marks = rangeClasses(inRange, focused) || (inLayer ? LAYER_ROW_CLASS : '')
  const commentCount = threadList.reduce((sum, t) => sum + t.comments.length, 0)
  return (
    <>
      <span className={`flex items-center justify-end gap-1 px-2 text-muted/70 ${bg} ${marks}`}>
        <DiffGutterActions
          line={position?.line}
          indicator={
            threadList.length > 0 && positionKey
              ? {
                  hidden: model.hiddenKeys.has(positionKey),
                  count: commentCount,
                  onClick: () => model.toggleHidden(positionKey),
                }
              : undefined
          }
          onComment={onAdd}
          chat={chat}
          chatSlot={chatSlot}
        />
        <span className="select-none">{cell?.number ?? ''}</span>
      </span>
      <span
        data-old-line={side === 'LEFT' && cell ? cell.number : undefined}
        data-new-line={side === 'RIGHT' && cell ? cell.number : undefined}
        data-focused={focused || undefined}
        data-layer-line={inLayer || undefined}
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
  layerKeys,
  expander,
  onCreateThread,
  composer,
  chat,
}: DiffBodyProps): React.JSX.Element {

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
      leftPosition,
      rightPosition,
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
          insert: true,
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
    const sides = [
      { position: meta.leftPosition, content: meta.row.left?.content ?? '' },
      { position: meta.rightPosition, content: meta.row.right?.content ?? '' },
    ]
    // The composer wins the row: the note input never stacks on it.
    const composerOnRow = onRow(composer.target, [meta.leftPosition, meta.rightPosition])
    for (const { position, content } of sides) {
      if (!position) continue
      if (chat && !composerOnRow && samePosition(chat.noteTarget, position)) {
        items.push({
          type: 'full',
          insert: true,
          key: `chat-${meta.rowKey}-${position.side}`,
          node: (
            <LineChatInput
              line={position.line}
              side={position.side}
              initialNote={chat.noteFor(position.side, position.line)}
              onAdd={(note) => chat.addLine(position.side, position.line, content, note)}
              onClose={chat.closeNote}
            />
          ),
        })
      }
      const target = composer.target
      if (target && samePosition(target, position)) {
        items.push({
          type: 'full',
          insert: true,
          key: `composer-${meta.rowKey}-${position.side}`,
          node: (
            <LineCommentComposer
              key={target.token}
              line={target.line}
              side={target.side}
              lineContent={content}
              initialValue={target.draft}
              onCancel={composer.close}
              onSubmit={async (bodyMarkdown) => {
                await onCreateThread(target.line, target.side, bodyMarkdown)
                composer.close()
              }}
            />
          ),
        })
      }
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
    const position = side === 'left' ? meta.leftPosition : meta.rightPosition
    const rowPositions = [meta.leftPosition, meta.rightPosition]
    const composerOnRow = onRow(composer.target, rowPositions)
    return (
      <SideCells
        cell={side === 'left' ? meta.row.left : meta.row.right}
        side={side === 'left' ? 'LEFT' : 'RIGHT'}
        positionKey={side === 'left' ? meta.leftKey : meta.rightKey}
        bg={side === 'left' ? meta.leftBg : meta.rightBg}
        contentClass={contentClass}
        threadList={side === 'left' ? meta.leftThreads : meta.rightThreads}
        model={model}
        inLayer={
          side === 'left'
            ? meta.leftKey !== undefined && layerKeys.has(meta.leftKey)
            : meta.rightKey !== undefined && layerKeys.has(meta.rightKey)
        }
        position={position}
        onAdd={
          position && (side === 'left' ? meta.leftThreads : meta.rightThreads).length === 0
            ? () => {
                if (chat && onRow(chat.noteTarget, rowPositions)) chat.closeNote()
                composer.open(position.side, position.line)
              }
            : undefined
        }
        chat={
          chat && position
            ? {
                pending: chat.pendingLines.has(lineThreadKey(position.line, position.side)),
                open: !composerOnRow && samePosition(chat.noteTarget, position),
                focusKey: lineThreadKey(position.line, position.side),
                onToggle: () => {
                  if (!composerOnRow && samePosition(chat.noteTarget, position)) {
                    chat.closeNote()
                    return
                  }
                  if (composerOnRow) composer.close()
                  chat.openNote(position.side, position.line)
                },
              }
            : undefined
        }
        chatSlot={chat !== undefined}
        getTokens={getTokens}
      />
    )
  }

  function wrapRow(meta: RowMeta): React.JSX.Element {
    const left = cells(meta, 'left', WRAP_CONTENT)
    const right = cells(meta, 'right', WRAP_CONTENT)
    // `contents` takes the wrapper out of the grid layout (its children
    // become grid items) but keeps it in the DOM for `group-hover`.
    return (
      <div key={meta.rowKey} className="group/row contents">
        {left}
        {right}
      </div>
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
            item.insert ? (
              <DiffInsertRow key={item.key}>{item.node}</DiffInsertRow>
            ) : (
              <div key={item.key} style={{ gridColumn: '1 / -1' }} className="min-w-0">
                {item.node}
              </div>
            )
          ) : (
            wrapRow(item.meta)
          ),
        )}
      </div>
    )
  }

  // Without wrap: runs of rows go in two panels; full-width items cut the run.
  // Digits + padding + the actions group (its 1px border each side, the "+"
  // slot, plus the chat sparkle slot when it is on).
  const gutterWidth = `calc(${gutterDigits}ch + ${chat ? '3.375rem' : '2.25rem'} + 2px)`
  const segments: Array<
    { key: string; rows: RowMeta[] } | { key: string; node: React.ReactNode; insert?: boolean }
  > = []
  let run: RowMeta[] = []
  for (const item of items) {
    if (item.type === 'row') {
      run.push(item.meta)
      continue
    }
    if (run.length) segments.push({ key: `run-${run[0].rowKey}`, rows: run })
    run = []
    segments.push({ key: item.key, node: item.node, insert: item.insert })
  }
  if (run.length) segments.push({ key: `run-${run[0].rowKey}`, rows: run })

  return (
    <div className="font-mono text-xs leading-5">
      {segments.map((segment) =>
        'node' in segment ? (
          segment.insert ? (
            <DiffInsertRow key={segment.key}>{segment.node}</DiffInsertRow>
          ) : (
            <Fragment key={segment.key}>{segment.node}</Fragment>
          )
        ) : (
          <div key={segment.key} className="grid grid-cols-2">
            {SIDES.map((side) => (
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
                      {cells(meta, side, NOWRAP_CONTENT)}
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
