import { describe, expect, it } from 'vitest'
import { encodeScmErrorMessage } from '../../../shared/scm-errors'
import { describeRetargetError, validateBranchName } from './retarget'

describe('validateBranchName', () => {
  it('accepts normal branch names and strips refs/heads/', () => {
    expect(validateBranchName('main')).toEqual({ ok: true, branch: 'main' })
    expect(validateBranchName('  task/23590-login ')).toEqual({
      ok: true,
      branch: 'task/23590-login',
    })
    expect(validateBranchName('refs/heads/feature/x')).toEqual({ ok: true, branch: 'feature/x' })
    expect(validateBranchName('release/1.2.3')).toEqual({ ok: true, branch: 'release/1.2.3' })
  })

  it.each([
    '',
    '   ',
    'has space',
    'a~b',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    'a\\b',
    'a..b',
    'a@{b',
    '@',
    '-flag',
    '/lead',
    'trail/',
    'a//b',
    'dot.',
    'feature/.hidden',
    'x.lock',
    'tab\there',
  ])('rejects %j', (name) => {
    const result = validateBranchName(name)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
  })

  it('names the problem so the UI can explain it', () => {
    expect(validateBranchName('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateBranchName('a b')).toEqual({ ok: false, reason: 'invalidChars' })
    expect(validateBranchName('x.lock')).toEqual({ ok: false, reason: 'dotOrLock' })
  })
})

describe('describeRetargetError', () => {
  const wrap = (message: string) =>
    new Error("Error invoking remote method 'scm:retarget': Error: " + message)

  it('CONFLICT asks for a refresh and keeps main text without the marker', () => {
    const failure = describeRetargetError(
      wrap(encodeScmErrorMessage('CONFLICT', 'Pull request #105 now targets main.')),
      'main',
    )
    expect(failure).toMatchObject({
      code: 'CONFLICT',
      detail: 'Pull request #105 now targets main.',
      reason: 'conflict',
      shouldRefresh: true,
    })
  })

  it('NOT_FOUND names the missing branch', () => {
    const failure = describeRetargetError(
      wrap(encodeScmErrorMessage('NOT_FOUND', 'Branch nope does not exist.')),
      'nope',
    )
    expect(failure.code).toBe('NOT_FOUND')
    expect(failure).toMatchObject({ reason: 'notFound', newBase: 'nope' })
    expect(failure.shouldRefresh).toBe(false)
  })

  it('unknown errors stay visible with their text', () => {
    const failure = describeRetargetError(new Error('socket hang up'), 'main')
    expect(failure).toMatchObject({
      code: null,
      detail: 'socket hang up',
      reason: 'unchanged',
      shouldRefresh: false,
    })
    expect(describeRetargetError('boom', 'main').detail).toBe('boom')
  })
})
