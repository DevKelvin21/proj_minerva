/**
 * Builds the document of an AI-written HTML diagram (`HtmlDiagram.tsx`).
 *
 * The source is untrusted: the model wrote it after reading a hostile PR, so
 * a prompt injection can put anything in it. Three layers keep it inert:
 *
 * 1. The iframe is `sandbox="allow-same-origin"` WITHOUT `allow-scripts`: no
 *    script, `on*` handler or `javascript:` URL ever runs, and it cannot
 *    navigate the app, open windows or submit forms. Same origin (without
 *    scripts that is safe) only lets the parent measure the content height.
 * 2. The document's own CSP (`DIAGRAM_CSP`) blocks every fetch: no remote
 *    image, font, stylesheet or beacon can leak what the model saw. It adds
 *    to the app CSP the srcdoc document inherits.
 * 3. `sanitizeDiagramHtml` drops active and embedding elements and every URL
 *    attribute except `#fragment` references (defense in depth, and links
 *    that would only navigate the frame to nothing). It also refuses markup
 *    that changes when parsed again (mutation-XSS shapes) and diagrams too
 *    heavy to lay out (element cap, no `<use>` expansion, no SVG filters).
 *
 * Main adds a fourth: subframes may only load `about:srcdoc`
 * (`main/windows/external-link-guard.ts`).
 *
 * Colors: the document gets the window's theme properties (`--theme-*`,
 * `themeCssVariables`) and the diagram kit (`shared/diagram-kit.ts`) derives
 * the short names the model uses.
 */
import { DIAGRAM_KIT_CSS } from '../../../shared/diagram-kit'
import type { ThemeAppearance } from '../../../shared/theme/themes'

/** No network at all: inline styles and data: images/fonts only. */
export const DIAGRAM_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
  "form-action 'none'; base-uri 'none'"

/**
 * Elements removed with their content: scripts, frames, embeds, forms,
 * document-level tags (`meta` refresh, `base`, `link`), SVG animation
 * elements (they can rewrite `href`) and the SVG pieces that cost the
 * renderer far more than their size (`use` fan-out, filters; `fe*` below).
 */
export const BLOCKED_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'link',
  'meta',
  'base',
  'title',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'audio',
  'video',
  'source',
  'track',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'discard',
  'use',
  'filter',
])

/** A real diagram has a few dozen elements; thousands only slow the app down. */
export const MAX_DIAGRAM_ELEMENTS = 1500

function isBlockedElement(localName: string): boolean {
  const name = localName.toLowerCase()
  return BLOCKED_ELEMENTS.has(name) || /^fe[a-z]/.test(name)
}

const URL_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'src',
  'srcset',
  'srcdoc',
  'action',
  'formaction',
  'poster',
  'background',
  'ping',
  'data',
  'codebase',
  'manifest',
  'http-equiv',
])

const DATA_IMAGE_RE = /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=\s]+$/i

/**
 * Whether an attribute survives sanitizing. Event handlers never do; URL
 * attributes only as an in-document `#id` reference (SVG `<use>`, markers)
 * or, for `src`, an inline raster image.
 */
export function isAllowedAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return false
  if (!URL_ATTRIBUTES.has(lower)) return true
  const trimmed = value.trim()
  if (lower === 'href' || lower === 'xlink:href') return /^#[\w-]+$/.test(trimmed)
  if (lower === 'src') return DATA_IMAGE_RE.test(trimmed)
  return false
}

/** One sanitizing pass; `null` when the markup has too many elements. */
function sanitizeOnce(source: string): string | null {
  const doc = new DOMParser().parseFromString(
    '<!doctype html><html><head></head><body>' + source + '</body></html>',
    'text/html',
  )
  const elements = Array.from(doc.body.querySelectorAll('*'))
  if (elements.length > MAX_DIAGRAM_ELEMENTS) return null
  for (const element of elements) {
    if (isBlockedElement(element.localName)) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      if (!isAllowedAttribute(attribute.name, attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return doc.body.innerHTML
}

/**
 * Sanitized body markup of a diagram source (needs a DOM: renderer only), or
 * `null` when it must not be shown. The frame parses the serialized markup
 * again, so markup whose second pass differs from the first (the mark of a
 * mutation-XSS shape, where re-parsing builds a different tree than the one
 * that was checked) is refused instead of shown.
 */
export function sanitizeDiagramHtml(source: string): string | null {
  const once = sanitizeOnce(source)
  if (once === null) return null
  return sanitizeOnce(once) === once ? once : null
}

/**
 * A theme property as CSS, or nothing when the value is not a plain color or
 * percentage (`oklch(0.2 0.01 264 / 0.5)`, `#aabbcc`, `100%`): no quotes,
 * escapes, comments or braces can reach the rule.
 */
function cssDeclaration(name: string, value: string): string {
  if (!/^--[a-z][a-z0-9-]*$/.test(name) || !/^[a-z0-9#%.,()/\s-]+$/i.test(value)) return ''
  if (value.includes('/*') || value.includes('*/')) return ''
  return name + ': ' + value + ';'
}

/** The full srcdoc of a diagram: CSP, theme properties, kit, then the sanitized body. */
export function buildDiagramDocument(
  body: string,
  themeVariables: Record<string, string>,
  appearance: ThemeAppearance,
): string {
  const declarations = Object.entries(themeVariables)
    .map(([name, value]) => cssDeclaration(name, value))
    .join('')
  return (
    '<!doctype html><html data-appearance="' +
    (appearance === 'light' ? 'light' : 'dark') +
    '"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' +
    DIAGRAM_CSP +
    '"><style>:root{' +
    declarations +
    '}' +
    DIAGRAM_KIT_CSS +
    '</style></head><body>' +
    body +
    '</body></html>'
  )
}
