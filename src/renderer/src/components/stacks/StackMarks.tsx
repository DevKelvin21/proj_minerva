import { Icon, type IconSize } from '../ui/Icon'
import { icons } from '../ui/icons'
import { useTranslation } from 'react-i18next'
import type { StackNode } from '../../../../shared/scm'
import { orphanExplanation } from '../../lib/stacks'
import { Badge } from '../ui/Badge'
import { Callout } from '../ui/Callout'
import { RetargetPanel } from './RetargetPanel'

/*
 * The marks a stacked PR carries wherever it is drawn (the Home stack board,
 * the PR cards, the review's stack map): its state glyph, the orphan chip
 * and the orphan's explanation with the one-click retarget.
 */

export function StackStateIcon({
  isDraft,
  size = 'sm',
}: {
  isDraft: boolean
  size?: IconSize
}): React.JSX.Element {
  const { t } = useTranslation()
  return isDraft ? (
    <Icon
      icon={icons.pullRequestDraft}
      size={size}
      className="shrink-0 text-muted"
      aria-label={t('stacks.tree.draft')}
    />
  ) : (
    <Icon icon={icons.pullRequest} size={size} className="shrink-0 text-success" aria-label={t('stacks.tree.open')} />
  )
}

/** Warning chip for an orphaned PR. */
export function OrphanBadge(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Badge tone="warning" size="sm" data-orphan-badge icon={<Icon icon={icons.warning} size="xs" />}>
      {t('stacks.tree.orphaned')}
    </Badge>
  )
}

/** The orphan's explanation plus the one-click retarget, shared by the stack board and the PR header. */
export function OrphanNotice({ node }: { node: StackNode }): React.JSX.Element | null {
  const { t } = useTranslation()
  const explanation = orphanExplanation(t, node)
  if (!node.orphan || !explanation) return null
  return (
    <Callout tone="warning">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p>{explanation}</p>
        <RetargetPanel
          // Remount when the PR or its base changes: a stale panel must not retarget.
          key={node.prKey + '\n' + node.baseRef}
          repo={node.repo}
          number={node.number}
          currentBase={node.baseRef}
          headRef={node.headRef}
          mode={{
            kind: 'orphan',
            suggestedBase: node.orphan.suggestedBase,
            parentNumber: node.orphan.parent.number,
          }}
        />
      </div>
    </Callout>
  )
}
