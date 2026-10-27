import { describe, expect, it, vi } from 'vitest'
import { decodeScmErrorMessage } from '../../shared/scm-errors'
import { ScmError, scmCodeOf, toScmError } from './errors'

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  },
}))

const { handle } = await import('../ipc/register')

describe('ScmError', () => {
  it('toScmError keeps an ScmError and wraps anything else', () => {
    const original = new ScmError('FORBIDDEN', 'no')
    expect(toScmError(original)).toBe(original)
    const wrapped = toScmError(new Error('x'), 'NETWORK')
    expect(wrapped.code).toBe('NETWORK')
    expect(wrapped.message).toBe('x')
    expect(toScmError('[SCM:NOT_FOUND] gone').code).toBe('NOT_FOUND')
  })

  it('scmCodeOf reads the code from an ScmError or an encoded message', () => {
    expect(scmCodeOf(new ScmError('CONFLICT', 'c'))).toBe('CONFLICT')
    expect(scmCodeOf(new Error('[SCM:RATE_LIMITED] r'))).toBe('RATE_LIMITED')
    expect(scmCodeOf(new Error('plain'))).toBeNull()
  })

  it('the typed code survives the IPC boundary (register.ts encodes it in the message)', async () => {
    handle('scm:getPullRequestDetail', () => {
      throw new ScmError('UNAUTHENTICATED', 'Not authenticated')
    })
    const ipcHandler = handlers.get('scm:getPullRequestDetail')
    const repo = { provider: 'github', owner: 'a', name: 'b', fullName: 'a/b' }

    const error = await ipcHandler?.({}, { repo, number: 1 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ScmError)
    expect(decodeScmErrorMessage((error as Error).message)).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Not authenticated',
    })
  })
})
