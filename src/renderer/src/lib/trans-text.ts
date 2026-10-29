import { createElement, type ReactElement } from 'react'

/**
 * Untrusted text (branch names, logins, PR titles) for a `<Trans>` string.
 *
 * Trans parses markup inside interpolated `values`: `{{branch}}` with a branch
 * named `<strong>x</strong>` (or `<0>…</0>`) renders a real element, which lets
 * PR data spoof the UI. Put a self-closing tag in the string instead
 * (`'targets <branch/>'`) and map it to this element: React renders the text
 * as text. `values` stays for local data only (numbers, CLI commands).
 */
export function transText(text: string, className?: string): ReactElement {
  return createElement('span', { className }, text)
}
