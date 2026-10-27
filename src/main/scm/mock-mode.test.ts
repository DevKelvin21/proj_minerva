import { afterEach, describe, expect, it } from 'vitest'
import { isMockScmMode } from './mock-mode'

describe('isMockScmMode', () => {
  afterEach(() => {
    delete process.env.MINERVA_MOCK
  })

  it('is true only when MINERVA_MOCK="1"', () => {
    process.env.MINERVA_MOCK = '1'
    expect(isMockScmMode()).toBe(true)
  })

  it('is false without MINERVA_MOCK or with any other value', () => {
    expect(isMockScmMode()).toBe(false)
    process.env.MINERVA_MOCK = 'true'
    expect(isMockScmMode()).toBe(false)
  })
})
