import { describe, expect, it } from 'vitest'
import {
  SCM_ERROR_CODES,
  decodeScmErrorMessage,
  encodeScmErrorMessage,
  scmErrorCodeOf,
} from './scm-errors'

describe('scm error codes over IPC', () => {
  it('round-trips every code through encode/decode', () => {
    for (const code of SCM_ERROR_CODES) {
      const encoded = encodeScmErrorMessage(code, 'Something failed: [x]')
      expect(decodeScmErrorMessage(encoded)).toEqual({ code, message: 'Something failed: [x]' })
    }
  })

  it("survives Electron's invoke wrapper", () => {
    const wrapped =
      "Error invoking remote method 'scm:listPullRequests': Error: " +
      encodeScmErrorMessage('UNAUTHENTICATED', 'Not authenticated')
    expect(decodeScmErrorMessage(wrapped)).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Not authenticated',
    })
    expect(scmErrorCodeOf(new Error(wrapped))).toBe('UNAUTHENTICATED')
  })

  it('returns null code for plain or unknown-coded messages', () => {
    expect(decodeScmErrorMessage('boom')).toEqual({ code: null, message: 'boom' })
    expect(decodeScmErrorMessage('[SCM:NOPE] x').code).toBeNull()
    expect(scmErrorCodeOf('nope')).toBeNull()
    expect(scmErrorCodeOf(42)).toBeNull()
  })
})
