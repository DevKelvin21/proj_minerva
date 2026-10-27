import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { CommentThread } from '../../../../shared/types'
import { buildInlineRows, type DiffLineKind, type InlineRow } from '../../lib/diff-parser'
import { linePositions } from '../../lib/diff-threads'
import { resolveNewThreadPosition } from '../../lib/line-threads'
import { DiffLineContent } from './DiffLineContent'
import { DiffExpander } from './DiffExpander'
import { LineThreadIndicator } from './LineThreadIndicator'
import { InlineThreadCard } from './InlineThreadCard'
import { LineCommentComposer } from './LineCommentComposer'
import {
  asHunk,
  KIND_BG,
  LAYER_ROW_CLASS,
  rangeClasses,
  type DiffBodyProps,
  type OpenComposer,
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
}: DiffBodyProps): React.JSX.Element {
  const { t } = useTranslation()
  const [openComposer, setOpenComposer] = useState<OpenComposer | null>(null)

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
    const composerHere = openComposer?.key === rowKey ? openComposer : null

    return (
      <Fragment key={rowKey}>
        <div className="group/row contents">
          <span className={`select-none px-2 text-right text-muted/70 ${bg} ${marks}`}>
            {row.oldNumber ?? ''}
          </span>
          <span className={`flex items-center gap-1 px-2 text-muted/70 ${bg}`}>
            {indicatorKey ? (
              <LineThreadIndicator
                hidden={lineThreads.every(([key]) => model.hiddenKeys.has(key))}
                count={commentCount}
                onClick={() => {
                  for (const [key] of lineThreads) model.toggleHidden(key)
                }}
              />
            ) : position ? (
              <button
                type="button"
                onClick={() => setOpenComposer({ key: rowKey, content: row.content, ...position })}
                aria-label={t('comments.line.addComment')}
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-accent focus:opacity-100 group-hover/row:opacity-100"
              >
                <Plus size={12} />
              </button>
            ) : (
              <span className="inline-block h-4 w-4 shrink-0" />
            )}
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
                <div
                  key={`thread-${thread.id}`}
                  style={{ gridColumn: '1 / -1' }}
                  className="min-w-0"
                >
                  <InlineThreadCard
                    thread={thread}
                    highlighted={thread.id === model.focusedThreadId}
                    onHide={() => model.toggleHidden(key)}
                  />
                </div>
              )),
        )}
        {composerHere && (
          <div style={{ gridColumn: '1 / -1' }} className="min-w-0">
            <LineCommentComposer
              line={composerHere.line}
              side={composerHere.side}
              lineContent={composerHere.content}
              onCancel={() => setOpenComposer(null)}
              onSubmit={async (bodyMarkdown) => {
                await onCreateThread(composerHere.line, composerHere.side, bodyMarkdown)
                setOpenComposer(null)
              }}
            />
          </div>
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
