import { describe, expect, it } from 'vitest'
import { splitEndpointHeading } from './endpoint-heading'

describe('splitEndpointHeading', () => {
  it('takes the first heading as the title and drops it from the body', () => {
    const md = '### `POST /api/v1/carts/:id/apply-coupon`\n\n| a | b |\n|---|---|\n'
    expect(splitEndpointHeading(md)).toEqual({
      title: 'POST /api/v1/carts/:id/apply-coupon',
      body: '| a | b |\n|---|---|\n',
    })
  })

  it('keeps underscores and strips bold and links', () => {
    expect(splitEndpointHeading('## **GET** [/users/:user_id](http://x)\nBody').title).toBe(
      'GET /users/:user_id',
    )
  })

  it('finds a heading after an intro paragraph', () => {
    const result = splitEndpointHeading('Intro.\n\n#### DELETE /carts/:id\nMore')
    expect(result.title).toBe('DELETE /carts/:id')
    expect(result.body).toBe('Intro.\n\nMore')
  })

  it('ignores headings inside code fences', () => {
    const md = '```sh\n# not a heading\n```\n\n### PUT /x'
    expect(splitEndpointHeading(md).title).toBe('PUT /x')
  })

  it('falls back when there is no heading or it is empty', () => {
    expect(splitEndpointHeading('Just text')).toEqual({ title: null, body: 'Just text' })
    expect(splitEndpointHeading('### ')).toEqual({ title: null, body: '### ' })
    expect(splitEndpointHeading('')).toEqual({ title: null, body: '' })
  })

  it('uses a heading that is still streaming', () => {
    expect(splitEndpointHeading('### `POST /api/v1/ca').title).toBe('POST /api/v1/ca')
  })
})
