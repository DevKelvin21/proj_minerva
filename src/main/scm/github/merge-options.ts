/**
 * GitHub's merge facts -> provider-neutral `MergeOptions` (pure, unit tested).
 * The real service reads them with `MERGE_OPTIONS_QUERY`; the mock builds the
 * same node from its fixtures, so both go through `mapGithubMergeOptions`.
 *
 * GitHub rules that shape the result:
 * - methods: `mergeCommitAllowed` / `squashMergeAllowed` / `rebaseMergeAllowed`;
 * - auto-merge needs "Allow auto-merge" on the repository AND something to
 *   wait for: GitHub refuses it on a PR that could merge right now (a clean or
 *   unstable merge state), so it is only offered while the PR is blocked;
 * - branch deletion: the "Automatically delete head branches" setting does it
 *   by itself; a fork's branch can't be deleted from here; auto-merge never
 *   deletes on its own (only the repository setting does).
 */
import type {
  AutoMergeState,
  MergeBlocker,
  MergeOptions,
  MergeStrategy,
  UserRef,
} from '../../../shared/types'

export type GithubMergeMethod = 'MERGE' | 'SQUASH' | 'REBASE'

export const GITHUB_MERGE_METHOD: Record<Exclude<MergeStrategy, 'rebase_merge'>, GithubMergeMethod> = {
  merge: 'MERGE',
  squash: 'SQUASH',
  rebase: 'REBASE',
}

/** Strategy -> REST `merge_method`. `rebase_merge` is Azure-only. */
export function githubMergeMethod(strategy: MergeStrategy): GithubMergeMethod | null {
  return strategy === 'rebase_merge' ? null : GITHUB_MERGE_METHOD[strategy]
}

export function strategyFromGithub(method: string | null | undefined): MergeStrategy | null {
  if (method === 'MERGE') return 'merge'
  if (method === 'SQUASH') return 'squash'
  if (method === 'REBASE') return 'rebase'
  return null
}

export interface GithubAutoMergeRequestNode {
  mergeMethod?: string | null
  enabledBy?: { login?: string; avatarUrl?: string } | null
}

/** The fields `MERGE_OPTIONS_QUERY` asks for (all optional: GitHub may omit them). */
export interface GithubMergeNode {
  repository: {
    mergeCommitAllowed?: boolean
    squashMergeAllowed?: boolean
    rebaseMergeAllowed?: boolean
    autoMergeAllowed?: boolean
    deleteBranchOnMerge?: boolean
    /** ADMIN | MAINTAIN | WRITE | TRIAGE | READ */
    viewerPermission?: string | null
  }
  pullRequest: {
    state?: string
    isDraft?: boolean
    headRefOid?: string
    isCrossRepository?: boolean
    /** MERGEABLE | CONFLICTING | UNKNOWN */
    mergeable?: string
    /** CLEAN | UNSTABLE | HAS_HOOKS | BLOCKED | BEHIND | DIRTY | DRAFT | UNKNOWN */
    mergeStateStatus?: string
    reviewDecision?: string | null
    viewerCanEnableAutoMerge?: boolean
    autoMergeRequest?: GithubAutoMergeRequestNode | null
    /** State of the head commit's `statusCheckRollup` (SUCCESS | FAILURE | ERROR | PENDING | EXPECTED). */
    checksState?: string | null
  }
}

export const MERGE_OPTIONS_QUERY = `
  query PullRequestMergeOptions($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      autoMergeAllowed
      deleteBranchOnMerge
      viewerPermission
      pullRequest(number: $number) {
        state
        isDraft
        headRefOid
        isCrossRepository
        mergeable
        mergeStateStatus
        reviewDecision
        viewerCanEnableAutoMerge
        autoMergeRequest { mergeMethod enabledBy { login avatarUrl } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
`

export function mapAutoMergeRequest(
  node: GithubAutoMergeRequestNode | null | undefined,
): AutoMergeState | null {
  if (!node) return null
  const setBy: UserRef = node.enabledBy?.login
    ? { login: node.enabledBy.login, ...(node.enabledBy.avatarUrl ? { avatarUrl: node.enabledBy.avatarUrl } : {}) }
    : { login: 'ghost' }
  return { setBy, strategy: strategyFromGithub(node.mergeMethod) }
}

const WRITE_PERMISSIONS = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])

function checksVerdict(state: string | null | undefined): 'failing' | 'pending' | null {
  if (state === 'FAILURE' || state === 'ERROR') return 'failing'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return null
}

/** What stops "merge now", from GitHub's merge state (worst first). */
export function githubBlocker(node: GithubMergeNode): MergeBlocker | null {
  const { repository: repo, pullRequest: pr } = node
  if (pr.state !== undefined && pr.state !== 'OPEN') return 'not_open'
  if (pr.isDraft || pr.mergeStateStatus === 'DRAFT') return 'draft'
  if (repo.viewerPermission && !WRITE_PERMISSIONS.has(repo.viewerPermission)) {
    return 'no_permission'
  }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'conflicts'
  switch (pr.mergeStateStatus) {
    case 'BLOCKED': {
      const checks = checksVerdict(pr.checksState)
      if (checks === 'failing') return 'checks_failing'
      if (checks === 'pending') return 'checks_pending'
      if (pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewDecision === 'CHANGES_REQUESTED') {
        return 'approvals_missing'
      }
      return 'blocked'
    }
    case 'BEHIND':
      return 'behind'
    case 'CLEAN':
    case 'UNSTABLE':
    case 'HAS_HOOKS':
      return null
    default:
      // UNKNOWN (or absent): GitHub computes mergeability lazily.
      return 'checking'
  }
}

export function mapGithubMergeOptions(node: GithubMergeNode): MergeOptions {
  const { repository: repo, pullRequest: pr } = node
  const blocker = githubBlocker(node)
  const current = mapAutoMergeRequest(pr.autoMergeRequest)

  let autoMerge: MergeOptions['autoMerge']
  if (blocker === 'not_open') autoMerge = { available: false, reason: 'not_open' }
  else if (repo.autoMergeAllowed !== true) autoMerge = { available: false, reason: 'repo_disabled' }
  else if (current !== null) autoMerge = { available: true }
  else if (blocker === null) autoMerge = { available: false, reason: 'nothing_to_wait_for' }
  else if (pr.viewerCanEnableAutoMerge !== true) autoMerge = { available: false, reason: 'no_permission' }
  else autoMerge = { available: true }

  return {
    headSha: pr.headRefOid ?? '',
    strategies: [
      { strategy: 'merge', allowed: repo.mergeCommitAllowed === true },
      { strategy: 'squash', allowed: repo.squashMergeAllowed === true },
      { strategy: 'rebase', allowed: repo.rebaseMergeAllowed === true },
    ],
    blocker,
    checksWarning: blocker === null ? checksVerdict(pr.checksState) : null,
    deleteSourceBranch: pr.isCrossRepository
      ? 'none'
      : repo.deleteBranchOnMerge
        ? 'repo'
        : 'option',
    deleteBranchWithAutoMerge: false,
    workItems: null,
    autoMerge,
    current,
  }
}
