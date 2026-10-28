import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { PullRequestSummary } from '../../../../shared/types'
import type { RepoGroupData } from '../../lib/pr-filters'
import { prKey } from '../../../../shared/scm'
import { Badge } from '../ui/Badge'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { PrListItem } from './PrListItem'

interface RepoGroupProps {
  group: RepoGroupData
  /** Llamado al hacer click en un item (T52, F10): selecciona el PR y lo marca visto. */
  onSelectPr: (pr: PullRequestSummary) => void
}

/** Header colapsable por repo (con el proveedor) + lista de PRs de ese repo. */
export function RepoGroup({ group, onSelectPr }: RepoGroupProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted transition-colors duration-150 hover:text-text"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <ScmProviderIcon provider={group.repo.provider} />
        <span className="truncate">{group.repo.fullName}</span>
        <Badge size="sm" className="ml-auto normal-case">
          {group.pullRequests.length}
        </Badge>
      </button>
      {!collapsed && (
        <ul>
          {group.pullRequests.map((pr) => (
            <li key={prKey(pr.repo, pr.number)}>
              <PrListItem pr={pr} onSelect={onSelectPr} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
