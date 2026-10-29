import { describe, expect, it } from 'vitest'
import { commentPreview } from './comment-preview'

describe('commentPreview', () => {
  it('drops bold, italics, strikethrough and inline code ticks', () => {
    expect(commentPreview('**Nit:** use `const` here, *please* ~~now~~')).toBe(
      'Nit: use const here, please now',
    )
  })

  it('keeps the code of a fence but not its markers', () => {
    expect(commentPreview('Reword it:\n```suggestion\n  return cents / 100\n```\n')).toBe(
      'Reword it: return cents / 100',
    )
  })

  it('keeps link and image text, drops their targets', () => {
    expect(commentPreview('See [the docs](https://x.test/a) ![chart](https://x.test/c.png)')).toBe(
      'See the docs chart',
    )
  })

  it('drops heading, quote and list markers', () => {
    expect(commentPreview('## Title\n> quoted\n- one\n1. two\n- [x] done')).toBe(
      'Title quoted one two done',
    )
  })

  it('drops HTML tags and comments', () => {
    expect(commentPreview('<!-- template -->\n<details><summary>More</summary>x</details>')).toBe(
      'More x',
    )
  })

  it('leaves snake_case and lone asterisks alone', () => {
    expect(commentPreview('order_lines.amount_cents * 2')).toBe('order_lines.amount_cents * 2')
  })

  it('truncates with an ellipsis', () => {
    const preview = commentPreview('word '.repeat(50), 20)
    expect(preview.length).toBeLessThanOrEqual(20)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('returns an empty string for markup only', () => {
    expect(commentPreview('```\n```')).toBe('')
  })
})
