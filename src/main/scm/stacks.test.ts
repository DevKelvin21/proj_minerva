import { describe, expect, it } from 'vitest'
import type { AzureRepoRef, GithubRepoRef } from '../../shared/scm'
import { buildStacks, flattenStack, type StackInputPr } from './stacks'

function azRepo(name: string): AzureRepoRef {
  return {
    provider: 'azure',
    organization: 'contoso',
    project: 'Platform',
    name,
    repositoryId: name + '-id',
    fullName: 'contoso/Platform/' + name,
  }
}

const api = azRepo('api')
const web = azRepo('web')

function pr(
  repo: AzureRepoRef | GithubRepoRef,
  number: number,
  headRef: string,
  baseRef: string,
  extra: Partial<StackInputPr> = {},
): StackInputPr {
  return {
    repo,
    number,
    title: 'PR ' + number,
    headRef: 'refs/heads/' + headRef,
    baseRef: 'refs/heads/' + baseRef,
    state: 'open',
    isDraft: false,
    ...extra,
  }
}

const merged = (
  repo: AzureRepoRef,
  n: number,
  head: string,
  base: string,
  extra: Partial<StackInputPr> = {},
) => pr(repo, n, head, base, { state: 'merged', ...extra })

describe('buildStacks', () => {
  it('chains PRs by base === parent head and normalizes refs', () => {
    const stacks = buildStacks(
      [
        pr(api, 3, 'feat/c', 'feat/b'),
        pr(api, 1, 'feat/a', 'main'),
        pr(api, 2, 'feat/b', 'feat/a'),
      ],
      [],
    )
    expect(stacks).toHaveLength(1)
    const [stack] = stacks
    expect(stack.size).toBe(3)
    expect(flattenStack(stack.root).map((n) => n.number)).toEqual([1, 2, 3])
    expect(stack.root.headRef).toBe('feat/a')
    expect(stack.root.prKey).toBe('azure:contoso/platform/api-id#1')
    expect(stack.root.orphan).toBeUndefined()
  })

  it('does not chain across repos and omits plain singletons by default', () => {
    const open = [pr(api, 1, 'feat/a', 'main'), pr(web, 2, 'feat/b', 'feat/a')]
    expect(buildStacks(open, [])).toEqual([])
    expect(buildStacks(open, [], { includeSingletons: true })).toHaveLength(2)
  })

  it('supports branching stacks (two children on one parent)', () => {
    const stacks = buildStacks(
      [pr(api, 1, 'base', 'main'), pr(api, 5, 'left', 'base'), pr(api, 4, 'right', 'base')],
      [],
    )
    expect(stacks[0].size).toBe(3)
    expect(stacks[0].root.children.map((c) => c.number)).toEqual([4, 5])
  })

  it('flags an orphan whose parent completed and suggests the parent target', () => {
    const stacks = buildStacks(
      [pr(api, 12, 'feat/b', 'feat/a'), pr(api, 13, 'feat/c', 'feat/b')],
      [merged(api, 11, 'feat/a', 'main')],
      { branchExists: () => true },
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].root.number).toBe(12)
    expect(stacks[0].root.orphan).toEqual({
      parent: { number: 11, title: 'PR 11', mergedInto: 'main' },
      targetBranchExists: true,
      suggestedBase: 'main',
    })
    expect(stacks[0].root.children[0].orphan).toBeUndefined()
  })

  it('reports a single orphaned PR and the branch-exists hint', () => {
    const stacks = buildStacks(
      [pr(api, 12, 'feat/b', 'feat/a')],
      [merged(api, 11, 'feat/a', 'main')],
      {
        branchExists: () => false,
      },
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].size).toBe(1)
    expect(stacks[0].root.orphan?.targetBranchExists).toBe(false)
  })

  it('walks up a chain of completed parents', () => {
    const stacks = buildStacks(
      [pr(api, 20, 'feat/c', 'feat/b')],
      [merged(api, 19, 'feat/b', 'feat/a'), merged(api, 18, 'feat/a', 'release/2')],
    )
    expect(stacks[0].root.orphan).toMatchObject({
      parent: { number: 19 },
      suggestedBase: 'release/2',
    })
  })

  it('stops walking at a branch that is an open PR head', () => {
    const stacks = buildStacks(
      [pr(api, 30, 'feat/x', 'main'), pr(api, 32, 'feat/z', 'feat/y')],
      [merged(api, 31, 'feat/y', 'feat/x')],
    )
    const orphan = stacks.find((s) => s.root.number === 32)?.root.orphan
    expect(orphan?.suggestedBase).toBe('feat/x')
  })

  it('ignores completed PRs from other repos and long-lived targets', () => {
    expect(
      buildStacks([pr(api, 2, 'feat/b', 'feat/a')], [merged(web, 1, 'feat/a', 'main')]),
    ).toEqual([])
    // gitflow: develop was merged to main by a release PR long ago.
    expect(
      buildStacks([pr(api, 9, 'feat/x', 'develop')], [merged(api, 3, 'develop', 'main')]),
    ).toEqual([])
  })

  it('does not flag a PR opened after the parent completed', () => {
    const open = [pr(api, 12, 'feat/b', 'feat/a', { createdAt: '2026-10-02T00:00:00Z' })]
    const done = [merged(api, 11, 'feat/a', 'main', { closedAt: '2026-10-01T00:00:00Z' })]
    expect(buildStacks(open, done)).toEqual([])
    const before = [pr(api, 12, 'feat/b', 'feat/a', { createdAt: '2026-09-30T00:00:00Z' })]
    expect(buildStacks(before, done)[0].root.orphan).toBeDefined()
  })

  it('uses mergedInto when given', () => {
    const stacks = buildStacks(
      [pr(api, 2, 'feat/b', 'feat/a')],
      [merged(api, 1, 'feat/a', 'main', { mergedInto: 'refs/heads/release/1' })],
    )
    expect(stacks[0].root.orphan?.suggestedBase).toBe('release/1')
  })

  it('terminates on cycles', () => {
    const stacks = buildStacks([pr(api, 2, 'x', 'y'), pr(api, 1, 'y', 'x')], [])
    expect(stacks).toHaveLength(1)
    expect(stacks[0].root.number).toBe(1)
    expect(stacks[0].size).toBe(2)
  })

  it('groups same-named stacks across repos of the same org', () => {
    const other: AzureRepoRef = {
      ...azRepo('web'),
      organization: 'fabrikam',
      fullName: 'fabrikam/Platform/web',
    }
    const stacks = buildStacks(
      [
        pr(api, 1, 'feat/a', 'main'),
        pr(api, 2, 'feat/b', 'feat/a'),
        pr(web, 6, 'feat/base', 'main'),
        pr(web, 7, 'feat/a', 'feat/base'),
        pr(web, 8, 'feat/b', 'feat/a'),
        pr(api, 20, 'other/x', 'main'),
        pr(api, 21, 'other/y', 'other/x'),
        pr(other, 1, 'feat/a', 'main'),
        pr(other, 2, 'feat/b', 'feat/a'),
      ],
      [],
    )
    expect(stacks.map((s) => [s.repo.name, s.root.number, s.groupKey])).toEqual([
      ['api', 1, 'azure:contoso:feat/a'],
      ['api', 20, undefined], // no branch shared with another repo
      // web: the same chain starts one branch lower; still grouped.
      ['web', 6, 'azure:contoso:feat/a'],
      ['web', 1, undefined], // fabrikam: another org
    ])
  })
})
