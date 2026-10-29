import { describe, expect, it, vi } from 'vitest'
import type { RepoRef } from '../../shared/scm'
import type { DiffFile, PullRequestDetail } from '../../shared/types'
import { reportingPrContext, type PrContextSource } from './pr-context'

const repo: RepoRef = { provider: 'github', owner: 'shopwave', name: 'api', fullName: 'shopwave/api' }

describe('reportingPrContext', () => {
  it('reports loading on every read and waiting once the snapshot is ready', async () => {
    let finishSnapshot: (dir: string) => void = () => {}
    const source: PrContextSource = {
      getDetail: async () => ({}) as PullRequestDetail,
      getFiles: async () => [] as DiffFile[],
      ensureSnapshot: () => new Promise((resolve) => (finishSnapshot = resolve)),
    }
    const report = vi.fn()
    const context = reportingPrContext(source, report)

    await context.getDetail(repo, 1)
    await context.getFiles(repo, 1)
    const snapshot = context.ensureSnapshot(repo, 'abc')
    expect(report.mock.calls.map(([stage]) => stage)).toEqual(['loading', 'loading', 'loading'])

    finishSnapshot('/tmp/snap')
    await expect(snapshot).resolves.toBe('/tmp/snap')
    expect(report).toHaveBeenLastCalledWith('waiting')
  })

  it('does not report waiting when the snapshot fails', async () => {
    const source: PrContextSource = {
      getDetail: async () => ({}) as PullRequestDetail,
      getFiles: async () => [],
      ensureSnapshot: async () => {
        throw new Error('no snapshot')
      },
    }
    const report = vi.fn()
    await expect(reportingPrContext(source, report).ensureSnapshot(repo, 'abc')).rejects.toThrow()
    expect(report.mock.calls.map(([stage]) => stage)).toEqual(['loading'])
  })
})
