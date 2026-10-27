/**
 * Suggested changes in comment bodies: a fenced code block whose info string is
 * `suggestion` (GitHub's syntax, which Azure DevOps also renders). Pure, so the
 * composer (insert a block) and the renderer (show a mini-diff instead of raw
 * text) agree on the format.
 */

export type CommentBodyPart =
  { kind: 'markdown'; text: string } | { kind: 'suggestion'; lines: string[] }

/** One row of a suggestion's mini-diff. */
export interface SuggestionDiffRow {
  kind: 'context' | 'del' | 'add'
  text: string
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})\s*suggestion\s*$/

/**
 * Splits a comment body into Markdown and suggestion blocks, in order. An
 * unclosed suggestion fence runs to the end of the body (what GitHub does).
 * Fences of other languages stay inside the Markdown parts untouched.
 */
export function splitSuggestionBlocks(body: string): CommentBodyPart[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const parts: CommentBodyPart[] = []
  let markdown: string[] = []
  let i = 0

  function flushMarkdown(): void {
    const text = markdown.join('\n')
    if (text.trim()) parts.push({ kind: 'markdown', text })
    markdown = []
  }

  // Tracks other fenced blocks so a "```suggestion" line inside, say, a
  // ```markdown example is not treated as a real suggestion.
  let otherFence: string | null = null

  while (i < lines.length) {
    const line = lines[i]
    if (otherFence) {
      markdown.push(line)
      if (isClosingFence(line, otherFence)) otherFence = null
      i++
      continue
    }
    const open = FENCE_OPEN_RE.exec(line)
    if (open) {
      const fence = open[1]
      const suggested: string[] = []
      i++
      while (i < lines.length && !isClosingFence(lines[i], fence)) {
        suggested.push(lines[i])
        i++
      }
      i++ // closing fence (or past the end)
      flushMarkdown()
      parts.push({ kind: 'suggestion', lines: suggested })
      continue
    }
    const other = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (other) otherFence = other[1]
    markdown.push(line)
    i++
  }
  flushMarkdown()
  return parts
}

function isClosingFence(line: string, fence: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.length >= fence.length &&
    trimmed[0] === fence[0] &&
    [...trimmed].every((ch) => ch === fence[0])
  )
}

/** True when the body has at least one suggestion block. */
export function hasSuggestion(body: string): boolean {
  return splitSuggestionBlocks(body).some((part) => part.kind === 'suggestion')
}

/**
 * A suggestion block prefilled with `lines`. The fence is one backtick longer
 * than any backtick run in the code, so code that itself contains ``` stays
 * inside the block.
 */
export function buildSuggestionBlock(lines: readonly string[]): string {
  let longest = 0
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  }
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return fence + 'suggestion\n' + lines.join('\n') + (lines.length ? '\n' : '') + fence
}

/**
 * Inserts `block` into `draft` at the caret (`selectionStart..selectionEnd`),
 * on its own lines. Answers the new text and where to put the caret: on the
 * first suggested line, so the user can edit it right away.
 */
export function insertSuggestion(
  draft: string,
  block: string,
  selectionStart: number,
  selectionEnd: number,
): { text: string; caret: number } {
  const before = draft.slice(0, selectionStart)
  const after = draft.slice(selectionEnd)
  const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n'
  const trail = after.length === 0 || after.startsWith('\n') ? '\n' : '\n\n'
  const text = before + lead + block + trail + after.replace(/^\n/, '')
  const caret = before.length + lead.length + block.indexOf('\n') + 1
  return { text, caret: Math.min(caret, text.length) }
}

/**
 * Line diff between the original lines and the suggested ones (LCS), for the
 * mini-diff. Small inputs only (a suggestion covers a handful of lines), so the
 * O(n·m) table is fine; above `maxCells` it falls back to "all removed, all
 * added", which is still correct, just less precise.
 */
export function diffSuggestion(
  original: readonly string[],
  suggested: readonly string[],
  maxCells = 250_000,
): SuggestionDiffRow[] {
  const n = original.length
  const m = suggested.length
  if (n * m > maxCells) {
    return [
      ...original.map((text) => ({ kind: 'del' as const, text })),
      ...suggested.map((text) => ({ kind: 'add' as const, text })),
    ]
  }
  // lcs[i][j] = LCS length of original[i..] and suggested[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        original[i] === suggested[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const rows: SuggestionDiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (original[i] === suggested[j]) {
      rows.push({ kind: 'context', text: original[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: 'del', text: original[i++] })
    } else {
      rows.push({ kind: 'add', text: suggested[j++] })
    }
  }
  while (i < n) rows.push({ kind: 'del', text: original[i++] })
  while (j < m) rows.push({ kind: 'add', text: suggested[j++] })
  return rows
}
