import { describe, expect, it } from 'vitest'
import { buildDidacticHash, parseDidacticHash } from './didactic-route'
import type { AzureRepoRef, GithubRepoRef } from './scm'

describe('didactic-route', () => {
  const repo: GithubRepoRef = {
    provider: 'github',
    owner: 'shopwave',
    name: 'api',
    fullName: 'shopwave/api',
  }
  const azureRepo: AzureRepoRef = {
    provider: 'azure',
    organization: 'contoso',
    project: 'Studio v2',
    name: 'cms-api',
    repositoryId: '3f2c1a9e-0000-4000-8000-000000000001',
    fullName: 'contoso/Studio v2/cms-api',
  }

  it('round-trips a GitHub repo, number and title through build+parse', () => {
    const hash = buildDidacticHash(repo, 482, 'Add coupon support')
    expect(parseDidacticHash('#' + hash)).toEqual({
      repo,
      number: 482,
      title: 'Add coupon support',
    })
  })

  it('round-trips an Azure DevOps repo', () => {
    const hash = buildDidacticHash(azureRepo, 12561, 'Retarget stack')
    expect(parseDidacticHash('#' + hash)).toEqual({
      repo: azureRepo,
      number: 12561,
      title: 'Retarget stack',
    })
  })

  it('parses without a leading #, since main passes it bare to loadFile', () => {
    const hash = buildDidacticHash(repo, 1, 'x')
    expect(parseDidacticHash(hash)).toEqual({ repo, number: 1, title: 'x' })
  })

  it('handles non-ASCII and URL-hostile characters in repo fields and title', () => {
    const weird: GithubRepoRef = {
      provider: 'github',
      owner: 'a b',
      name: 'ñ/d?#',
      fullName: 'a b/ñ/d?#',
    }
    const hash = buildDidacticHash(weird, 7, 'Título con ñ & <script>')
    expect(hash).not.toMatch(/[ #ñ]/)
    expect(parseDidacticHash('#' + hash)).toEqual({
      repo: weird,
      number: 7,
      title: 'Título con ñ & <script>',
    })
  })

  it('returns null for a hash without the didactic/ prefix', () => {
    expect(parseDidacticHash('#/some/other/route')).toBeNull()
    expect(parseDidacticHash('')).toBeNull()
  })

  it('returns null for a malformed number', () => {
    const encoded = buildDidacticHash(repo, 5, 't').split('/')[1]
    expect(parseDidacticHash('#didactic/' + encoded)).toBeNull()
    expect(parseDidacticHash('#didactic/' + encoded + '/not-a-number')).toBeNull()
    expect(parseDidacticHash('#didactic/' + encoded + '/0')).toBeNull()
    expect(parseDidacticHash('#didactic/' + encoded + '/1.5')).toBeNull()
  })

  it('rejects the legacy owner/name/number format', () => {
    expect(parseDidacticHash('#didactic/owner/name/5')).toBeNull()
  })

  it('rejects a repo that fails the IPC rules (extra keys, wrong provider, garbage)', () => {
    const encode = (value: unknown): string =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(parseDidacticHash('#didactic/' + encode({ ...repo, extra: 1 }) + '/5')).toBeNull()
    expect(
      parseDidacticHash('#didactic/' + encode({ ...repo, provider: 'gitlab' }) + '/5'),
    ).toBeNull()
    expect(parseDidacticHash('#didactic/' + encode({ ...repo, owner: '' }) + '/5')).toBeNull()
    expect(parseDidacticHash('#didactic/' + encode('nope') + '/5')).toBeNull()
    expect(parseDidacticHash('#didactic/%%%/5')).toBeNull()
  })

  it('parses fine without a title in the query', () => {
    const hash = buildDidacticHash(repo, 5, 'x').split('?')[0]
    expect(parseDidacticHash('#' + hash)).toEqual({ repo, number: 5, title: null })
  })
})
