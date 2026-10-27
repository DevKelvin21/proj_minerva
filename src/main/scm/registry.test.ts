import { describe, expect, it, vi } from 'vitest'

const { createScmRegistry, getAuthStatusMap, listAcrossProviders } = await import('./registry')
const { ScmError } = await import('./errors')
const { githubRepo } = await import('../../shared/scm-guards')

import type { ScmProvider } from './provider'
import type { ScmProviderId } from '../../shared/scm'
import type { PullRequestSummary } from '../../shared/types'

function pr(id: string, provider: ScmProviderId): PullRequestSummary {
  return { id, repo: { provider } } as unknown as PullRequestSummary
}

function fakeProvider(id: ScmProviderId, overrides: Partial<ScmProvider> = {}): ScmProvider {
  const notUsed = (): never => {
    throw new Error('not used')
  }
  return {
    id,
    getAuthStatus: async () => ({ provider: id, state: 'signed_in' }),
    listPullRequests: async () => [],
    getPullRequestDetail: notUsed,
    getPullRequestFiles: notUsed,
    getCommentThreads: notUsed,
    postComment: notUsed,
    writeSnapshot: notUsed,
    setThreadStatus: notUsed,
    getFileContent: notUsed,
    branchExists: notUsed,
    updatePullRequestBase: notUsed,
    listStackCandidates: notUsed,
    listMergedBySourceBranch: notUsed,
    ...overrides,
  }
}

describe('SCM registry', () => {
  it("fan-out: one failing provider does not drop the other one's items", async () => {
    const registry = createScmRegistry([
      fakeProvider('github', { listPullRequests: async () => [pr('g1', 'github')] }),
      fakeProvider('azure', {
        listPullRequests: async () => {
          throw new ScmError('RATE_LIMITED', 'slow down')
        },
      }),
    ])

    const result = await listAcrossProviders(registry, { state: 'open' })

    expect(result.items.map((item) => item.id)).toEqual(['g1'])
    expect(result.errors).toEqual([
      { provider: 'azure', code: 'RATE_LIMITED', message: 'slow down' },
    ])
    expect(result.okProviders).toEqual(['github'])
  })

  it('fan-out: an untyped rejection becomes an UNKNOWN error entry', async () => {
    const registry = createScmRegistry([
      fakeProvider('github', {
        listPullRequests: async () => {
          throw new Error('kaboom')
        },
      }),
    ])

    const result = await listAcrossProviders(registry, {})

    expect(result.items).toEqual([])
    expect(result.errors).toEqual([{ provider: 'github', code: 'UNKNOWN', message: 'kaboom' }])
  })

  it('fan-out passes the query through to every provider', async () => {
    const list = vi.fn().mockResolvedValue([])
    const registry = createScmRegistry([
      fakeProvider('github', { listPullRequests: list }),
      fakeProvider('azure', { listPullRequests: list }),
    ])

    await listAcrossProviders(registry, { search: 'x', state: 'all' })

    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenCalledWith({ search: 'x', state: 'all' })
  })

  it('forRepo resolves by provider and throws NOT_FOUND for an unregistered one', () => {
    const github = fakeProvider('github')
    const registry = createScmRegistry([github])

    expect(registry.forRepo(githubRepo('a', 'b'))).toBe(github)
    expect(registry.get('azure')).toBeNull()
    const azureRepo = {
      provider: 'azure' as const,
      organization: 'o',
      project: 'p',
      name: 'n',
      repositoryId: 'r',
      fullName: 'o/p/n',
    }
    expect(() => registry.forRepo(azureRepo)).toThrow(ScmError)
    try {
      registry.forRepo(azureRepo)
    } catch (error) {
      expect((error as InstanceType<typeof ScmError>).code).toBe('NOT_FOUND')
    }
  })

  it('rejects registering the same provider twice', () => {
    expect(() => createScmRegistry([fakeProvider('github'), fakeProvider('github')])).toThrow()
  })

  it('auth map reports every known provider; unregistered ones are disabled', async () => {
    const registry = createScmRegistry([fakeProvider('github')])

    await expect(getAuthStatusMap(registry)).resolves.toEqual({
      github: { provider: 'github', state: 'signed_in' },
      azure: { provider: 'azure', state: 'disabled' },
    })
  })

  it('honors per-provider enabled flags on every call (toggle without restart)', async () => {
    const enabled: Record<ScmProviderId, boolean> = { github: true, azure: false }
    const registry = createScmRegistry(
      [
        fakeProvider('github', { listPullRequests: async () => [pr('g1', 'github')] }),
        fakeProvider('azure', { listPullRequests: async () => [pr('a1', 'azure')] }),
      ],
      (id) => enabled[id],
    )
    const azureRepo = {
      provider: 'azure' as const,
      organization: 'o',
      project: 'p',
      name: 'r',
      repositoryId: 'id',
      fullName: 'o/p/r',
    }

    expect(registry.enabled().map((p) => p.id)).toEqual(['github'])
    expect(registry.get('azure')).toBeNull()
    expect(() => registry.forRepo(azureRepo)).toThrow(/not enabled/)
    await expect(getAuthStatusMap(registry)).resolves.toMatchObject({
      azure: { provider: 'azure', state: 'disabled' },
    })

    enabled.azure = true
    enabled.github = false
    expect(registry.enabled().map((p) => p.id)).toEqual(['azure'])
    expect(registry.forRepo(azureRepo).id).toBe('azure')
    const listed = await listAcrossProviders(registry, {})
    expect(listed.items.map((item) => item.id)).toEqual(['a1'])
  })
})
