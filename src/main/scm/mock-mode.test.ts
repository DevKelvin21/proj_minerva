import { afterEach, describe, expect, it } from 'vitest'
import { isMockScmMode, mockAuthOverride } from './mock-mode'

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

describe('mockAuthOverride', () => {
  afterEach(() => {
    delete process.env.MINERVA_MOCK
    delete process.env.MINERVA_MOCK_GH_AUTH
    delete process.env.MINERVA_MOCK_AZURE_AUTH
  })

  it('reads a known value only in mock mode', () => {
    process.env.MINERVA_MOCK_AZURE_AUTH = 'unauthenticated'
    expect(mockAuthOverride('MINERVA_MOCK_AZURE_AUTH')).toBeNull()
    process.env.MINERVA_MOCK = '1'
    expect(mockAuthOverride('MINERVA_MOCK_AZURE_AUTH')).toBe('unauthenticated')
    expect(mockAuthOverride('MINERVA_MOCK_GH_AUTH')).toBeNull()
  })

  it('ignores unknown values', () => {
    process.env.MINERVA_MOCK = '1'
    process.env.MINERVA_MOCK_GH_AUTH = 'admin'
    expect(mockAuthOverride('MINERVA_MOCK_GH_AUTH')).toBeNull()
  })
})
