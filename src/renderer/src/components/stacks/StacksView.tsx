import { useMemo, useState } from 'react'
import { Layers, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { InlineError } from '../ui/InlineError'

interface StacksViewProps {
  /** The PR list's items: mark/filter "mine", and select without refetching. */
  pullRequests: readonly PullRequestSummary[]
  /** The Sidebar's selection path (select + mark seen). */
  onSelectPr: (pr: PullRequestSummary) => void
}

function ProviderErrors({ errors }: { errors: ScmListError[] }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1 border-b border-border p-3">
      {errors.map((providerError) => (
        <InlineError
          key={providerError.provider}
          data-error-code={providerError.code}
          message={t('stacks.view.providerError', {
            provider: SCM_PROVIDER_LABEL[providerError.provider],
            message: providerError.message,
          })}
        />
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
  const { t } = useTranslation()
  return (
    <section
      aria-label={t('stacks.view.stackAriaLabel', {
        repo: stack.repo.fullName,
        number: stack.root.number,
      })}
      className="min-w-0"
    >
      <header className="flex min-w-0 items-center gap-1.5 px-3 pb-0.5 pt-2 text-[11px] text-muted">
        <ScmProviderIcon provider={stack.repo.provider} size={11} />
        <span className="min-w-0 truncate" title={stack.repo.fullName}>
          {stack.repo.fullName}
        </span>
        <span className="ml-auto shrink-0">
          {t('stacks.view.prCount', { count: stack.size })}
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
  const { t } = useTranslation()
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
            {t('stacks.view.sameFeature', { count: repoCount })}
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
  const { t } = useTranslation()
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
    body = (
      <InlineError className="p-4" message={t('stacks.view.loadFailed', { error })} onRetry={refresh} />
    )
  } else if (stacks === null) {
    body = (
      <div className="flex flex-col gap-1 p-4 text-sm text-muted">
        <p>{t('stacks.view.loading')}</p>
        <p className="text-xs">{t('stacks.view.loadingHint')}</p>
      </div>
    )
  } else if (visible.length === 0) {
    body =
      stacks.length > 0 ? (
        <p className="p-4 text-sm text-muted">
          {searchQuery.trim()
            ? t('stacks.view.noMatch', { query: searchQuery })
            : t('stacks.view.noneMine')}
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-4 text-sm text-muted">
          <p>{t('stacks.view.empty')}</p>
          <p className="text-xs">{t('stacks.view.emptyHint')}</p>
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
          title={t('stacks.view.mineOnlyTitle')}
          className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-150 ${
            mineOnly
              ? 'border-accent/40 bg-accent/15 text-accent'
              : 'border-border text-muted hover:text-text'
          }`}
        >
          {t('stacks.view.mineOnly')}
        </button>
        {orphanCount > 0 && (
          <span className="min-w-0 truncate text-xs text-warning">{t('stacks.view.orphaned', { count: orphanCount })}
          </span>
        )}
        <IconButton
          icon={<RefreshCw size={14} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />}
          label={t('stacks.view.refresh')}
          onClick={refresh}
          disabled={loading}
          className="ml-auto"
        />
      </div>
      <p className="border-b border-border px-3 py-2 text-[11px] leading-snug text-muted">
        {t('stacks.view.intro')}
      </p>
      <RetargetNote
        onOpenPr={onSelectPr}
        except={selectedKey}
        className="border-b border-border bg-bg/60 px-3 py-2"
      />
      {error && stacks !== null && (
        <InlineError
          className="border-b border-border px-3 py-2"
          message={t('stacks.view.refreshFailed', { error })}
          onRetry={refresh}
        />
      )}
      {openError && (
        <InlineError className="border-b border-border px-3 py-2" message={openError} />
      )}
      {providerErrors.length > 0 && <ProviderErrors errors={providerErrors} />}
      {body}
    </div>
  )
}
