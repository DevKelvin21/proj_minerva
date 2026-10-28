import { Fragment, useMemo } from 'react'
import type { CommentThread } from '../../../../shared/types'
import { buildInlineRows, type DiffLineKind, type InlineRow } from '../../lib/diff-parser'
import { linePositions } from '../../lib/diff-threads'
import { lineThreadKey, resolveNewThreadPosition } from '../../lib/line-threads'
import { DiffLineContent } from './DiffLineContent'
import { DiffExpander } from './DiffExpander'
import { DiffGutterActions } from './DiffGutterActions'
import { DiffInsertRow } from './DiffInsertRow'
import { InlineThreadCard } from './InlineThreadCard'
import { LineCommentComposer } from './LineCommentComposer'
import { LineChatInput } from './LineChatInput'
import {
  asHunk,
  KIND_BG,
  LAYER_ROW_CLASS,
  rangeClasses,
  samePosition,
  type DiffBodyProps,
} from './diff-body'

const KIND_MARKER: Record<DiffLineKind, string> = {
  context: ' ',
  add: '+',
  del: '-',
}

/**
 * Inline view (one column, old/new gutters) of a file's diff sections in a
 * single CSS grid, so gutter columns share their width across hunks (T18).
 * A context row can host threads on both sides (LEFT on its old number,
 * RIGHT on its new one); they all render under it.
 */
export function InlineDiff({
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
        s.type === 'gap' ? [] : buildInlineRows([s.type === 'hunk' ? s.hunk : asHunk(s.lines)]),
      ),
    [sections],
  )
  const contentClass = wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'

  function renderRow(rowKey: string, row: InlineRow): React.ReactNode {
    const bg = KIND_BG[row.kind] ?? ''
    const keys = linePositions(row)
    const lineThreads: Array<[string, CommentThread[]]> = keys
      .map((key) => [key, model.byPosition.get(key) ?? []] as [string, CommentThread[]])
      .filter(([, list]) => list.length > 0)
    const inRange = keys.some((key) => model.rangeKeys.has(key))
    const focused = keys.some((key) => model.focusedKeys.has(key))
    const inLayer = keys.some((key) => layerKeys.has(key))
    // A thread mark wins over the layer mark on the same gutter (both are inset shadows).
    const marks = rangeClasses(inRange, focused) || (inLayer ? LAYER_ROW_CLASS : '')

    // A comment on a deletion uses the old line (LEFT); on context or an
    // addition, the new line (RIGHT).
    const position = resolveNewThreadPosition(row.kind === 'del', row.oldNumber, row.newNumber)
    const indicatorKey = lineThreads[0]?.[0]
    const commentCount = lineThreads.reduce(
      (sum, [, list]) => sum + list.reduce((n, t) => n + t.comments.length, 0),
      0,
    )
    const composerHere = samePosition(composer.target, position) ? composer.target : null
    // The composer wins the row: the note input never stacks on it.
    const noteHere =
      chat && !composerHere && samePosition(chat.noteTarget, position) ? position : undefined
    const pending = position
      ? Boolean(chat?.pendingLines.has(lineThreadKey(position.line, position.side)))
      : false

    return (
      <Fragment key={rowKey}>
        <div className="group/row contents">
          <span className={`select-none px-2 text-right text-muted/70 ${bg} ${marks}`}>
            {row.oldNumber ?? ''}
          </span>
          <span className={`flex items-center gap-1 px-2 text-muted/70 ${bg}`}>
            <DiffGutterActions
              line={position?.line}
              indicator={
                indicatorKey
                  ? {
                      hidden: lineThreads.every(([key]) => model.hiddenKeys.has(key)),
                      count: commentCount,
                      onClick: () => {
                        for (const [key] of lineThreads) model.toggleHidden(key)
                      },
                    }
                  : undefined
              }
              onComment={
                position
                  ? () => {
                      if (chat && samePosition(chat.noteTarget, position)) chat.closeNote()
                      composer.open(position.side, position.line)
                    }
                  : undefined
              }
              chat={
                chat && position
                  ? {
                      pending,
                      open: Boolean(noteHere),
                      focusKey: lineThreadKey(position.line, position.side),
                      onToggle: () => {
                        if (noteHere) {
                          chat.closeNote()
                          return
                        }
                        if (composerHere) composer.close()
                        chat.openNote(position.side, position.line)
                      },
                    }
                  : undefined
              }
              chatSlot={chat !== undefined}
            />
            <span className="select-none">{row.newNumber ?? ''}</span>
          </span>
          <span
            className={`select-none px-1.5 text-center ${bg} ${
              row.kind === 'add'
                ? 'text-success'
                : row.kind === 'del'
                  ? 'text-danger'
                  : 'text-muted'
            }`}
          >
            {KIND_MARKER[row.kind]}
          </span>
          <span
            data-old-line={row.kind !== 'add' ? row.oldNumber : undefined}
            data-new-line={row.kind !== 'del' ? row.newNumber : undefined}
            data-focused={focused || undefined}
            data-layer-line={inLayer || undefined}
            className={`px-2 ${contentClass} ${bg} ${focused ? 'bg-accent/20' : ''} text-text`}
          >
            <DiffLineContent content={row.content} tokens={getTokens(row.content)} />
          </span>
        </div>

        {lineThreads.map(([key, list]) =>
          model.hiddenKeys.has(key)
            ? null
            : list.map((thread) => (
                <DiffInsertRow key={`thread-${thread.id}`}>
                  <InlineThreadCard
                    thread={thread}
                    highlighted={thread.id === model.focusedThreadId}
                    onHide={() => model.toggleHidden(key)}
                  />
                </DiffInsertRow>
              )),
        )}
        {noteHere && chat && (
          <DiffInsertRow>
            <LineChatInput
              line={noteHere.line}
              side={noteHere.side}
              initialNote={chat.noteFor(noteHere.side, noteHere.line)}
              onAdd={(note) => chat.addLine(noteHere.side, noteHere.line, row.content, note)}
              onClose={chat.closeNote}
            />
          </DiffInsertRow>
        )}
        {composerHere && (
          <DiffInsertRow>
            <LineCommentComposer
              key={composerHere.token}
              line={composerHere.line}
              side={composerHere.side}
              lineContent={row.content}
              initialValue={composerHere.draft}
              onCancel={composer.close}
              onSubmit={async (bodyMarkdown) => {
                await onCreateThread(composerHere.line, composerHere.side, bodyMarkdown)
                composer.close()
              }}
            />
          </DiffInsertRow>
        )}
      </Fragment>
    )
  }

  return (
    <div
      className="grid font-mono text-xs leading-5"
      style={{
        gridTemplateColumns: wordWrap
          ? 'max-content max-content max-content minmax(0, 1fr)'
          : 'max-content max-content max-content minmax(max-content, 1fr)',
      }}
    >
      {sections.map((section, s) => (
        <Fragment key={section.key}>
          {section.type === 'gap' ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <DiffExpander
                gap={section.gap}
                hunkCount={hunkCount}
                loading={expander.loading}
                error={expander.error}
                onExpand={(direction) => expander.onExpand(section.gap, direction)}
              />
            </div>
          ) : (
            <>
              {section.type === 'hunk' && (
                <div
                  style={{ gridColumn: '1 / -1' }}
                  className="border-y border-border bg-panel px-3 py-1 font-mono text-[11px] text-muted"
                >
                  {section.hunk.header}
                </div>
              )}
              {rowsBySection[s].map((row, i) => renderRow(`${section.key}:${i}`, row))}
            </>
          )}
        </Fragment>
      ))}
    </div>
  )
}
