import { describe, expect, it } from 'vitest'
import { followUpQuestion } from './ask-ai'

const format = (question: string, answer: string, followUp: string): string =>
  'Q: ' + question + '\nA: ' + answer + '\nF: ' + followUp

describe('followUpQuestion', () => {
  it('quotes everything when it fits', () => {
    expect(followUpQuestion(format, { question: 'why?', answer: 'because' }, 'and then?', 200)).toBe(
      'Q: why?\nA: because\nF: and then?',
    )
  })

  it('never cuts the new question: it shortens the quoted answer instead', () => {
    const text = followUpQuestion(
      format,
      { question: 'why?', answer: 'x'.repeat(5000) },
      'the follow-up',
      300,
    )
    expect(text.length).toBeLessThanOrEqual(300)
    expect(text.endsWith('\nF: the follow-up')).toBe(true)
    expect(text).toContain('…')
  })

  it('a follow-up longer than the limit is the only thing sent, cut to the limit', () => {
    expect(followUpQuestion(format, { question: 'a', answer: 'b' }, 'y'.repeat(50), 20)).toBe(
      'y'.repeat(20),
    )
  })
})
