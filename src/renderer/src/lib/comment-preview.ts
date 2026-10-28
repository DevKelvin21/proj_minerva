/**
 * One-line plain-text preview of a Markdown comment (a folded thread's
 * header): the words a reviewer reads, without the raw `**`, backticks,
 * fences, link targets or list/heading markers. Pure; the result is still
 * untrusted text and is rendered as text, never as HTML.
 */

const DEFAULT_MAX = 120

export function commentPreview(markdown: string, max = DEFAULT_MAX): string {
  const text = markdown
    // Fence lines (```suggestion, ```ts, ```): the code inside stays.
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm, ' ')
    // HTML comments and tags (templates, <details>…).
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    // Images and links keep their text.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Headings, quotes and list markers at the start of a line.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    // Emphasis markers and inline code ticks (single `_` stays: snake_case).
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/(^|[\s(])\*(\S[^*\n]*?)\*(?=[\s).,;:!?]|$)/gm, '$1$2')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}
