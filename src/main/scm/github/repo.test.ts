import { describe, expect, it } from 'vitest'
import { asGithubRepo } from './repo'

describe('asGithubRepo', () => {
  it('rebuilds fullName from owner/name: a spoofed fullName never reaches a dialog', () => {
    expect(
      asGithubRepo({ provider: 'github', owner: 'victim', name: 'prod', fullName: 'my/sandbox' }),
    ).toEqual({ provider: 'github', owner: 'victim', name: 'prod', fullName: 'victim/prod' })
  })

  it.each(['..', '.', 'a/b', 'a b', ''])('refuses %j as a path segment', (segment) => {
    expect(() =>
      asGithubRepo({ provider: 'github', owner: segment, name: 'api', fullName: 'x' }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(() =>
      asGithubRepo({ provider: 'github', owner: 'acme', name: segment, fullName: 'x' }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
})
