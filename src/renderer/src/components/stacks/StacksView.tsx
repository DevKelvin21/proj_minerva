import { useMemo, useState } from 'react'
import { Layers, RefreshCw } from 'lucide-react'
import { prKey, type PrStack, type StackNode } from '../../../../shared/scm'
import type { PullRequestSummary, ScmListError } from '../../../../shared/types'
import { useOpenPr } from '../../hooks/use-open-pr'
import { useStacks } from '../../hooks/use-stacks'
import { SCM_PROVIDER_LABEL } from '../../lib/scm-labels'
import {
  countOrphans,
  filterStacks,
  groupStacks,
  stacksContaining,
  type StackGroup,
} from '../../lib/stacks'
import { useAppStore } from '../../stores/app-store'
import { IconButton } from '../ui/IconButton'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { RetargetNote } from './RetargetNote'
import { StackTree } from './StackTree'

interface StacksViewProps {
  /** The PR list's items: mark/filter "mine", and select without refetching. */
  pullRequests: readonly PullRequestSummary[]
  /** The Sidebar's selection path (select + mark seen). */
  onSelectPr: (pr: PullRequestSummary) => void
}

function ProviderErrors({ errors }: { errors: ScmListError[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-border p-3">
      {errors.map((providerError) => (
        <p
          key={providerError.provider}
          data-error-code={providerError.code}
          className="text-xs text-danger"
        >
          {SCM_PROVIDER_LABEL[providerError.provider]}: {providerError.message}
        </p>
      ))}
    </div>
  )
}

function StackCard({
  stack,
  selectedKey,
  mineKeys,
  pendingKey,
  onOpen,
}: {
  stack: PrStack
  selectedKey: string | null
  mineKeys: ReadonlySet<string>
  pendingKey: string | null
  onOpen: (node: StackNode) => void
}): React.JSX.Element {
  return (
    <section
      aria-label={'Stack in ' + stack.repo.fullName + ' from #' + stack.root.number}
      className="min-w-0"
    >
      <header className="flex min-w-0 items-center gap-1.5 px-3 pb-0.5 pt-2 text-[11px] text-muted">
        <ScmProviderIcon provider={stack.repo.provider} size={11} />
        <span className="min-w-0 truncate" title={stack.repo.fullName}>
          {stack.repo.fullName}
        </span>
        <span className="ml-auto shrink-0">
          {stack.size} {stack.size === 1 ? 'PR' : 'PRs'}
        </span>
      </header>
      <ul>
        <StackTree
          node={stack.root}
          selectedKey={selectedKey}
          mineKeys={mineKeys}
          pendingKey={pendingKey}
          onOpen={onOpen}
        />
      </ul>
    </section>
  )
}

function GroupBlock({
  group,
  ...rest
}: {
  group: StackGroup
  selectedKey: string | null
  mineKeys: ReadonlySet<string>
  pendingKey: string | null
  onOpen: (node: StackNode) => void
}): React.JSX.Element {
  const repoCount = new Set(group.stacks.map((stack) => stack.repo.fullName)).size
  return (
    <div data-stack-group={group.key} className="border-b border-border pb-1 last:border-b-0">
      {group.label !== null && (
        <div className="flex min-w-0 flex-col px-3 pt-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text">
            <Layers size={12} className="shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 truncate" title={group.label}>
              {group.label}
            </span>
          </span>
          <span className="pl-[18px] text-[11px] text-muted">
            Same feature across {repoCount} {repoCount === 1 ? 'repo' : 'repos'}
          </span>
        </div>
      )}
      {group.stacks.map((stack) => (
        <StackCard key={stack.root.prKey} stack={stack} {...rest} />
      ))}
    </div>
  )
}

/**
 * Stacked PRs (each one targets the previous one's branch), grouped by
 * feature across repos. Clicking a PR opens it the same way the list does;
 * orphans explain themselves and offer the retarget in place.
 */
export function StacksView({ pullRequests, onSelectPr }: StacksViewProps): React.JSX.Element {
  const { stacks, providerErrors, loading, error, refresh } = useStacks()
  const searchQuery = useAppStore((s) => s.searchQuery)
  const selectedKey = useAppStore((s) =>
    s.selectedPr ? prKey(s.selectedPr.repo, s.selectedPr.number) : null,
  )
  const [mineOnly, setMineOnly] = useState(false)
  const { open, pendingKey, error: openError } = useOpenPr(pullRequests, onSelectPr)

  const mineKeys = useMemo(
    () => new Set(pullRequests.map((pr) => prKey(pr.repo, pr.number))),
    [pullRequests],
  )
  const visible = useMemo(() => {
    const scoped = mineOnly ? stacksContaining(stacks ?? [], mineKeys) : (stacks ?? [])
    return filterStacks(scoped, searchQuery)
  }, [stacks, mineOnly, mineKeys, searchQuery])
  const groups = useMemo(() => groupStacks(visible), [visible])
  const orphanCount = countOrphans(visible)
  const onOpen = (node: StackNode): void => open(node.repo, node.number)

  let body: React.JSX.Element
  if (error && stacks === null) {
    body = <p className="p-4 text-sm text-danger">Could not load stacks: {error}</p>
  } else if (stacks === null) {
    body = (
      <div className="flex flex-col gap-1 p-4 text-sm text-muted">
        <p>Loading stacks…</p>
        <p className="text-xs">This reads every open PR in scope, so it can take a few seconds.</p>
      </div>
    )
  } else if (visible.length === 0) {
    body =
      stacks.length > 0 ? (
        <p className="p-4 text-sm text-muted">
          {searchQuery.trim()
            ? 'No stacks match "' + searchQuery + '".'
            : 'None of your pull requests is in a stack.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-4 text-sm text-muted">
          <p>No stacked pull requests.</p>
          <p className="text-xs">
            A stack appears when a PR targets another open PR’s branch, or when a PR still targets
            the branch of a PR that was already completed.
          </p>
        </div>
      )
  } else {
    body = (
      <>
        {groups.map((group) => (
          <GroupBlock
            key={group.key}
            group={group}
            selectedKey={selectedKey}
            mineKeys={mineKeys}
            pendingKey={pendingKey}
            onOpen={onOpen}
          />
        ))}
      </>
    )
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
        <button
          type="button"
          aria-pressed={mineOnly}
          onClick={() => setMineOnly((value) => !value)}
          title="Only stacks that contain a PR from your pull request list"
          className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150 ${
            mineOnly
              ? 'border-accent/40 bg-accent/15 text-accent'
              : 'border-border text-muted hover:text-text'
          }`}
        >
          Mine only
        </button>
        {orphanCount > 0 && (
          <span className="min-w-0 truncate text-xs text-warning">{orphanCount} orphaned</span>
        )}
        <IconButton
          icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          label="Refresh stacks"
          onClick={refresh}
          disabled={loading}
          className="ml-auto"
        />
      </div>
      <p className="border-b border-border px-3 py-2 text-[11px] leading-snug text-muted">
        Each PR targets the branch of the one above it. Review from the top down: a child’s diff
        only shows what it adds on top of its parent.
      </p>
      <RetargetNote
        onOpenPr={onSelectPr}
        except={selectedKey}
        className="border-b border-border bg-bg/60 px-3 py-2"
      />
      {error && stacks !== null && (
        <p className="border-b border-border px-3 py-2 text-xs text-danger">
          Refresh failed: {error}
        </p>
      )}
      {openError && (
        <p role="alert" className="border-b border-border px-3 py-2 text-xs text-danger">
          {openError}
        </p>
      )}
      {providerErrors.length > 0 && <ProviderErrors errors={providerErrors} />}
      {body}
    </div>
  )
}
