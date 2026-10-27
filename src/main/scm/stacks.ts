/**
 * Stacked-PR detection. Pure and provider-neutral: GitHub and Azure DevOps
 * both feed it plain PR lists.
 *
 * - A child PR targets its parent's source branch, in the same repo
 *   (`child.baseRef === parent.headRef`). Roots are open PRs whose base is
 *   not another open PR's head.
 * - Orphan: an open PR still targets the source branch of a PR that already
 *   COMPLETED (merged) in the same repo. Azure DevOps has no auto-retarget,
 *   and the stale branch usually still exists, so "branch deleted" is not a
 *   usable signal. The suggested new base is the parent's own target; when
 *   that one was also a completed PR's source (a chain that merged bottom-up),
 *   we keep walking up to the first branch that is not.
 * - False-positive guards: long-lived branches (`main`, `develop`, ...) are
 *   never treated as stale even if some old PR once merged them elsewhere
 *   (gitflow release PRs), and when dates are known a PR opened AFTER the
 *   parent completed targeted that branch on purpose.
 * - Cycles (A targets B's head and B targets A's head) are broken
 *   deterministically, so the walk always terminates.
 */
import {
  prKey,
  repoKey,
  shortRef,
  type PrStack,
  type RepoRef,
  type StackNode,
} from '../../shared/scm'

/** Minimal input, independent of the full PR summary types being refactored elsewhere. */
export interface StackInputPr {
  repo: RepoRef
  number: number
  title: string
  headRef: string
  baseRef: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  /** For merged PRs: the branch it was merged into (defaults to `baseRef`). */
  mergedInto?: string
  /** ISO dates; optional, used only to reject false orphans. */
  createdAt?: string
  closedAt?: string
}

export interface BuildStacksOptions {
  /** `false` when the branch is known to be gone, `undefined` when unknown. */
  branchExists?: (repo: RepoRef, branch: string) => boolean | undefined
  /** Branches never considered stale. Default: main, master, develop, development, dev, trunk. */
  isLongLivedBranch?: (branch: string) => boolean
  /** Also return single-PR "stacks" that are not orphaned. Default false. */
  includeSingletons?: boolean
}

const DEFAULT_LONG_LIVED = /^(main|master|develop|development|dev|trunk)$/i

function normalize(pr: StackInputPr): StackInputPr {
  return {
    ...pr,
    headRef: shortRef(pr.headRef),
    baseRef: shortRef(pr.baseRef),
    ...(pr.mergedInto ? { mergedInto: shortRef(pr.mergedInto) } : {}),
  }
}

function groupByRepo(prs: StackInputPr[]): Map<string, StackInputPr[]> {
  const byRepo = new Map<string, StackInputPr[]>()
  for (const pr of prs) {
    const key = repoKey(pr.repo)
    const list = byRepo.get(key)
    if (list) list.push(pr)
    else byRepo.set(key, [pr])
  }
  return byRepo
}

function indexByHead(prs: StackInputPr[]): Map<string, StackInputPr[]> {
  const byHead = new Map<string, StackInputPr[]>()
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    const list = byHead.get(pr.headRef)
    if (list) list.push(pr)
    else byHead.set(pr.headRef, [pr])
  }
  return byHead
}

function time(iso: string | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Grouping scope: stacks only group within one GitHub owner / Azure organization. */
function groupScope(repo: RepoRef): string {
  return repo.provider === 'github' ? 'github:' + repo.owner : 'azure:' + repo.organization
}

export function buildStacks(
  openPrs: StackInputPr[],
  completedPrs: StackInputPr[],
  options: BuildStacksOptions = {},
): PrStack[] {
  const isLongLived =
    options.isLongLivedBranch ?? ((branch: string) => DEFAULT_LONG_LIVED.test(branch))
  const open = openPrs.filter((pr) => pr.state === 'open').map(normalize)
  const merged = completedPrs.filter((pr) => pr.state === 'merged').map(normalize)
  const mergedByRepo = groupByRepo(merged)
  const stacks: PrStack[] = []

  for (const [key, repoPrs] of groupByRepo(open)) {
    const openByHead = indexByHead(repoPrs)
    const mergedByHead = indexByHead(mergedByRepo.get(key) ?? [])

    // parent[child] = the open PR whose head is the child's base (lowest number wins).
    const parentOf = new Map<StackInputPr, StackInputPr>()
    for (const pr of repoPrs) {
      const parent = openByHead.get(pr.baseRef)?.find((candidate) => candidate !== pr)
      if (parent) parentOf.set(pr, parent)
    }

    // Break cycles: walk up from each PR; if we come back to a visited node
    // inside this walk, cut the link of the lowest-numbered PR in the loop.
    for (const start of repoPrs) {
      const path: StackInputPr[] = []
      const onPath = new Set<StackInputPr>()
      let cursor: StackInputPr | undefined = start
      while (cursor && !onPath.has(cursor)) {
        onPath.add(cursor)
        path.push(cursor)
        cursor = parentOf.get(cursor)
      }
      if (cursor) {
        const loop = path.slice(path.indexOf(cursor))
        const cut = loop.reduce((min, pr) => (pr.number < min.number ? pr : min))
        parentOf.delete(cut)
      }
    }

    const childrenOf = new Map<StackInputPr, StackInputPr[]>()
    for (const [child, parent] of parentOf) {
      const list = childrenOf.get(parent)
      if (list) list.push(child)
      else childrenOf.set(parent, [child])
    }

    const orphanInfo = (pr: StackInputPr): StackNode['orphan'] => {
      if (isLongLived(pr.baseRef)) return undefined
      const created = time(pr.createdAt)
      const parents = (mergedByHead.get(pr.baseRef) ?? []).filter((candidate) => {
        const closed = time(candidate.closedAt)
        // Opened after the parent completed: the target was chosen on purpose.
        return !(created !== null && closed !== null && created > closed)
      })
      const parent = parents[parents.length - 1] // highest number = most recent
      if (!parent) return undefined

      const mergedInto = parent.mergedInto ?? parent.baseRef
      let suggestedBase = mergedInto
      const seen = new Set<string>([pr.baseRef])
      while (
        !seen.has(suggestedBase) &&
        !isLongLived(suggestedBase) &&
        !openByHead.has(suggestedBase)
      ) {
        seen.add(suggestedBase)
        const above = mergedByHead.get(suggestedBase)
        const next = above?.[above.length - 1]
        if (!next) break
        suggestedBase = next.mergedInto ?? next.baseRef
      }

      return {
        parent: { number: parent.number, title: parent.title, mergedInto },
        targetBranchExists: options.branchExists?.(pr.repo, pr.baseRef) ?? true,
        suggestedBase,
      }
    }

    const toNode = (pr: StackInputPr, isRoot: boolean): StackNode => {
      const children = (childrenOf.get(pr) ?? [])
        .sort((a, b) => a.number - b.number)
        .map((child) => toNode(child, false))
      const node: StackNode = {
        prKey: prKey(pr.repo, pr.number),
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        headRef: pr.headRef,
        baseRef: pr.baseRef,
        state: pr.state,
        isDraft: pr.isDraft,
        children,
      }
      // Only a root can be orphaned: a non-root targets an OPEN PR's head.
      const orphan = isRoot ? orphanInfo(pr) : undefined
      if (orphan) node.orphan = orphan
      return node
    }

    const roots = repoPrs.filter((pr) => !parentOf.has(pr)).sort((a, b) => a.number - b.number)
    for (const rootPr of roots) {
      const root = toNode(rootPr, true)
      const size = countNodes(root)
      if (size < 2 && !root.orphan && !options.includeSingletons) continue
      stacks.push({ repo: rootPr.repo, root, size })
    }
  }

  assignGroupKeys(stacks, isLongLived)
  return stacks.sort(
    (a, b) => a.repo.fullName.localeCompare(b.repo.fullName) || a.root.number - b.root.number,
  )
}

export function countNodes(node: StackNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0)
}

/**
 * Stacks in DIFFERENT repos of the same provider scope that share at least
 * one (non-long-lived) source branch name get a shared `groupKey`: one
 * feature split across services. Sharing is transitive (union-find), and the
 * key is the alphabetically first shared branch, so it is stable across
 * refreshes. Not shape-based on purpose: in real data the same feature
 * chain starts one branch lower in one service than in the others.
 */
function assignGroupKeys(stacks: PrStack[], isLongLived: (branch: string) => boolean): void {
  const parent = stacks.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }

  // scope + branch -> indices of the stacks that contain a PR from that branch.
  const byBranch = new Map<string, number[]>()
  stacks.forEach((stack, index) => {
    for (const node of flattenStack(stack.root)) {
      if (isLongLived(node.headRef)) continue
      const key = groupScope(stack.repo) + ':' + node.headRef
      const list = byBranch.get(key)
      if (!list) byBranch.set(key, [index])
      else if (!list.includes(index)) list.push(index)
    }
  })

  const sharedBranches = new Map<number, string[]>()
  for (const [key, indices] of byBranch) {
    const repos = new Set(indices.map((i) => repoKey(stacks[i].repo)))
    if (repos.size < 2) continue
    for (const i of indices.slice(1)) parent[find(i)] = find(indices[0])
    const list = sharedBranches.get(indices[0]) ?? []
    list.push(key)
    sharedBranches.set(indices[0], list)
  }

  const keyOfComponent = new Map<number, string>()
  for (const [index, keys] of sharedBranches) {
    const component = find(index)
    for (const key of keys) {
      const current = keyOfComponent.get(component)
      if (current === undefined || key < current) keyOfComponent.set(component, key)
    }
  }
  stacks.forEach((stack, index) => {
    const key = keyOfComponent.get(find(index))
    if (key) stack.groupKey = key.toLowerCase()
  })
}

/** Depth-first list of a stack's nodes (root first). Handy for UIs and logs. */
export function flattenStack(node: StackNode): StackNode[] {
  return [node, ...node.children.flatMap(flattenStack)]
}
