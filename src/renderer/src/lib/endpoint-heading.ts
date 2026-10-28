/**
 * Endpoint cards are titled by their route: the first Markdown heading of the
 * section (`### \`POST /api/v1/carts/:id/apply-coupon\``). That heading then
 * leaves the body so the card does not say its route twice.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/

/** Heading text without inline Markdown: code ticks, bold markers, link targets. */
function plainHeading(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/\*\*|__/g, '')
    .trim()
}

export interface EndpointHeading {
  /** The route, or `null` when the markdown has no usable heading (the card falls back to "Endpoint"). */
  title: string | null
  /** The markdown without that heading line. */
  body: string
}

/**
 * Pure: finds the first ATX heading outside a code fence. While the section
 * streams the heading may still be growing; it is used as soon as it has text.
 */
export function splitEndpointHeading(markdown: string): EndpointHeading {
  const lines = markdown.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const match = HEADING.exec(line)
    if (!match) continue
    const title = plainHeading(match[1])
    if (title.length === 0) return { title: null, body: markdown }
    const rest = lines.slice(0, i).concat(lines.slice(i + 1))
    return { title, body: rest.join('\n').replace(/^\s*\n/, '') }
  }
  return { title: null, body: markdown }
}
