import { describe, expect, it } from 'vitest'
import {
  buildSuggestionBlock,
  diffSuggestion,
  hasSuggestion,
  insertSuggestion,
  splitSuggestionBlocks,
} from './suggestions'

describe('splitSuggestionBlocks', () => {
  it('splits Markdown and suggestion blocks in order', () => {
    const body = 'Use a constant:\n\n```suggestion\nconst RATE = 100\n```\n\nThanks!'
    expect(splitSuggestionBlocks(body)).toEqual([
      { kind: 'markdown', text: 'Use a constant:\n' },
      { kind: 'suggestion', lines: ['const RATE = 100'] },
      { kind: 'markdown', text: '\nThanks!' },
    ])
  })

  it('keeps an empty suggestion (a "delete these lines" suggestion)', () => {
    expect(splitSuggestionBlocks('```suggestion\n```')).toEqual([{ kind: 'suggestion', lines: [] }])
  })

  it('handles longer fences, tildes, CRLF and an unclosed fence', () => {
    expect(splitSuggestionBlocks('````suggestion\na ``` b\n````')).toEqual([
      { kind: 'suggestion', lines: ['a ``` b'] },
    ])
    expect(splitSuggestionBlocks('~~~suggestion\r\nx\r\n~~~')).toEqual([
      { kind: 'suggestion', lines: ['x'] },
    ])
    expect(splitSuggestionBlocks('```suggestion\nlast line')).toEqual([
      { kind: 'suggestion', lines: ['last line'] },
    ])
  })

  it('leaves other code fences (and suggestions quoted inside them) as Markdown', () => {
    const body = '```markdown\n```suggestion\nnot real\n```\n```'
    expect(splitSuggestionBlocks(body)).toEqual([{ kind: 'markdown', text: body }])
    expect(hasSuggestion(body)).toBe(false)
    expect(hasSuggestion('```ts\nx\n```')).toBe(false)
  })
})

describe('buildSuggestionBlock / insertSuggestion', () => {
  it('builds a block that round-trips through the parser', () => {
    const lines = ['  const total = 1', '  return total']
    const block = buildSuggestionBlock(lines)
    expect(block).toBe('```suggestion\n  const total = 1\n  return total\n```')
    expect(splitSuggestionBlocks(block)).toEqual([{ kind: 'suggestion', lines }])
  })

  it('uses a longer fence when the code has backticks', () => {
    const block = buildSuggestionBlock(['const md = "```"'])
    expect(block.startsWith('````suggestion\n')).toBe(true)
    expect(splitSuggestionBlocks(block)).toEqual([
      { kind: 'suggestion', lines: ['const md = "```"'] },
    ])
  })

  it('inserts on its own lines and puts the caret on the first suggested line', () => {
    const block = buildSuggestionBlock(['x = 1'])
    const empty = insertSuggestion('', block, 0, 0)
    expect(empty.text).toBe(block + '\n')
    expect(empty.text.slice(empty.caret)).toMatch(/^x = 1/)

    const mid = insertSuggestion('Try this:', block, 9, 9)
    expect(mid.text).toBe('Try this:\n' + block + '\n')
    expect(mid.text.slice(mid.caret)).toMatch(/^x = 1/)

    const replaced = insertSuggestion('A SELECTED B', block, 2, 10)
    expect(replaced.text).toBe('A \n' + block + '\n\n B')
  })
})

describe('diffSuggestion', () => {
  it('marks changed lines as removed/added and keeps equal ones as context', () => {
    expect(diffSuggestion(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('handles pure insertions and deletions', () => {
    expect(diffSuggestion(['a'], ['a', 'b'])).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
    ])
    expect(diffSuggestion(['a', 'b'], [])).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'del', text: 'b' },
    ])
  })

  it('falls back to all-removed/all-added above the size cap', () => {
    expect(diffSuggestion(['a', 'b'], ['a', 'c'], 1)).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'c' },
    ])
  })
})
