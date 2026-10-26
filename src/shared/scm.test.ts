import { describe, expect, it } from 'vitest'
import {
  isThreadOpen,
  prKey,
  prWebUrl,
  repoKey,
  sameRepo,
  shortRef,
  type AzureRepoRef,
  type GithubRepoRef,
} from './scm'
import { githubRepo, isRepoRef } from './scm-guards'

const gh: GithubRepoRef = githubRepo('Shopwave', 'API')
const az: AzureRepoRef = {
  provider: 'azure',
  organization: 'Contoso',
  project: 'Studio v2',
  name: 'cms-api',
  repositoryId: '3F2C1A9E-0000-4000-8000-000000000001',
  fullName: 'Contoso/Studio v2/cms-api',
}

describe('scm helpers', () => {
  it('repoKey is provider-prefixed and case-insensitive', () => {
    expect(repoKey(gh)).toBe('github:shopwave/api')
    expect(repoKey(az)).toBe('azure:contoso/studio v2/3f2c1a9e-0000-4000-8000-000000000001')
    expect(repoKey(githubRepo('shopwave', 'api'))).toBe(repoKey(gh))
  })

  it('azure repoKey uses the stable repositoryId, not the (renamable) name', () => {
    expect(repoKey({ ...az, name: 'renamed', fullName: 'Contoso/Studio v2/renamed' })).toBe(
      repoKey(az),
    )
  })

  it('prKey appends #number and never collides across providers', () => {
    expect(prKey(gh, 482)).toBe('github:shopwave/api#482')
    expect(prKey(az, 12561)).toMatch(/^azure:.*#12561$/)
    expect(prKey(gh, 1)).not.toBe(prKey(az, 1))
  })

  it('sameRepo compares by repoKey', () => {
    expect(sameRepo(gh, githubRepo('shopwave', 'api'))).toBe(true)
    expect(sameRepo(gh, githubRepo('shopwave', 'web'))).toBe(false)
    expect(sameRepo(gh, az)).toBe(false)
  })

  it('prWebUrl builds the provider URL, encoding Azure path segments', () => {
    expect(prWebUrl(gh, 7)).toBe('https://github.com/Shopwave/API/pull/7')
    expect(prWebUrl(az, 9)).toBe(
      'https://dev.azure.com/Contoso/Studio%20v2/_git/cms-api/pullrequest/9',
    )
  })

  it('shortRef strips refs/heads/ only', () => {
    expect(shortRef('refs/heads/feature/x')).toBe('feature/x')
    expect(shortRef('feature/x')).toBe('feature/x')
    expect(shortRef('refs/tags/v1')).toBe('refs/tags/v1')
  })

  it('isThreadOpen: active and pending are open, everything else is closed', () => {
    expect(isThreadOpen('active')).toBe(true)
    expect(isThreadOpen('pending')).toBe(true)
    for (const status of ['resolved', 'wont_fix', 'closed', 'by_design'] as const) {
      expect(isThreadOpen(status)).toBe(false)
    }
  })

  it('isRepoRef accepts both variants and rejects mixed shapes', () => {
    expect(isRepoRef(gh)).toBe(true)
    expect(isRepoRef(az)).toBe(true)
    expect(isRepoRef({ owner: 'a', name: 'b', fullName: 'a/b' })).toBe(false)
    expect(isRepoRef({ ...az, owner: 'x' })).toBe(false)
    expect(isRepoRef({ ...gh, provider: 'azure' })).toBe(false)
    expect(isRepoRef(null)).toBe(false)
  })
})
