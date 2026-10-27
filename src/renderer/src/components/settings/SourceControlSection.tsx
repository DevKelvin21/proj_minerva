import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { ScmAuthStatus } from '../../../../shared/scm'
import { useGhAccounts } from '../../hooks/use-gh-accounts'
import { useScmAuth } from '../../hooks/use-scm-auth'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { Badge } from '../ui/Badge'
import { ScmProviderIcon } from '../ui/ScmProviderIcon'
import { AzureDevopsSection } from './AzureDevopsSection'

/** External link consistent with the design system (see `CliLoginGuide.tsx`): main's link guard opens it in the system browser. */
function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent/80"
    >
      {children}
    </a>
  )
}

/**
 * Feedback for the current GitHub auth status (the `gh` probe in
 * `main/scm/github/gh-cli-auth.ts`). `cli_unauthenticated` reads very
 * differently with or without an account picked by hand: with one, "run gh
 * auth login" is misleading — the user may have other healthy accounts and
 * what fails is the choice, not the CLI. Main's `detail` already says which.
 */
function GhCliStatusFeedback({
  status,
}: {
  status: ScmAuthStatus | undefined
}): React.JSX.Element | null {
  if (status === undefined) return null
  if (status.state === 'cli_unavailable') {
    return (
      <p className="text-xs text-danger">
        GitHub CLI not found. Install it from the link above and try again.
      </p>
    )
  }
  if (status.state === 'cli_unauthenticated') {
    return (
      <p className="text-xs text-warning">
        {status.detail ?? "No gh session: run 'gh auth login' in a terminal."}
      </p>
    )
  }
  if (status.state === 'signed_in') {
    return <p className="text-xs text-success">Signed in as {status.user?.login} via gh.</p>
  }
  return null
}

/** Radio-like card of the account picker; same anatomy as the model cards of `ProviderModelPanel.tsx`. */
function AccountCard({
  label,
  description,
  selected,
  busy,
  disabled,
  badge,
  onSelect,
}: {
  label: React.ReactNode
  description: string
  selected: boolean
  busy: boolean
  disabled: boolean
  badge?: React.JSX.Element | null
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-start justify-between gap-2.5 rounded-md border p-2.5 text-left transition-colors duration-150 ${
        selected ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-accent/30'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-text">{label}</span>
        <span className="text-[11px] text-muted">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badge}
        {busy ? (
          <Loader2 size={14} className="mt-0.5 animate-spin text-muted" />
        ) : selected ? (
          <Badge tone="success">Active</Badge>
        ) : null}
      </span>
    </button>
  )
}

/**
 * "GitHub access": GitHub goes through the `gh` CLI session only — nothing
 * to authorize per machine, and enterprise orgs that block third-party OAuth
 * apps usually approve GitHub CLI.
 *
 * The account picker exists because `gh` supports several accounts and,
 * without `--user`, resolves its own active one. Picking here NEVER runs
 * `gh auth switch`: the choice is local to Minerva and the user's terminal
 * stays where it was.
 */
function GithubAccessSection({ compact }: { compact: boolean }): React.JSX.Element | null {
  const { statuses } = useScmAuth()
  const { info, setGithubAccount, saveProviderSettings } = useScmSettings()
  const [togglingGithub, setTogglingGithub] = useState(false)
  const { accounts, loading, reload } = useGhAccounts(true)
  // `null` is a legitimate value ("follow gh's active account"), so "nothing
  // in flight" needs its own sentinel: `undefined`.
  const [saving, setSaving] = useState<string | null | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (info === null) return null
  const githubAccount = info.githubAccount

  async function select(login: string | null): Promise<void> {
    if (login === githubAccount || saving !== undefined) return
    setSaving(login)
    setSaveError(null)
    const ok = await setGithubAccount(login)
    setSaving(undefined)
    if (!ok) setSaveError('Could not switch accounts. Try again.')
  }

  const busy = saving !== undefined
  const activeInGh = accounts.find((account) => account.active) ?? null

  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <ScmProviderIcon provider="github" size={12} />
        GitHub access
      </h3>
      {!compact && (
        <p className="mb-3 text-xs text-muted">
          Minerva uses your <span className="font-mono text-text">gh</span> (GitHub CLI) session:
          there is no separate login to authorize. Enterprise orgs that block third-party OAuth apps
          usually allow GitHub CLI.
        </p>
      )}

      <label className="mb-3 flex items-center gap-2 text-xs text-text">
        <input
          type="checkbox"
          checked={info.providers.github.enabled}
          disabled={togglingGithub}
          aria-label="Enable GitHub"
          onChange={(event) => {
            const enabled = event.target.checked
            setTogglingGithub(true)
            void saveProviderSettings({ github: { enabled } }).finally(() =>
              setTogglingGithub(false),
            )
          }}
        />
        Enable GitHub
      </label>

      {info.mockScm && (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
          Demo mode (MINERVA_MOCK): data is simulated; this setting applies once you go back to real
          data.
        </p>
      )}

      <div className="rounded-md border border-border bg-bg/40 px-2.5 py-2">
        <p className="mb-2 text-xs text-muted">
          Install GitHub CLI from{' '}
          <ExternalLink href="https://cli.github.com">cli.github.com</ExternalLink> and run{' '}
          <span className="font-mono text-text">gh auth login</span> in a terminal.
        </p>
        <GhCliStatusFeedback status={statuses?.github} />
      </div>

      <div className="mb-1.5 mt-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Account</h4>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading || busy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:text-text disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {/*
          "Follow gh" is ALWAYS present, even with an empty list (gh missing or
          unreadable output): it works without enumerating anything, so
          leaving it out would turn a listing failure into "nothing to pick".
        */}
        <AccountCard
          label="gh active account"
          description={
            activeInGh !== null
              ? 'Follows whichever account gh has active (now: ' + activeInGh.login + ').'
              : 'Follows the account gh resolves on its own.'
          }
          selected={githubAccount === null}
          busy={saving === null}
          disabled={busy}
          onSelect={() => void select(null)}
        />

        {accounts.map((account) => (
          <AccountCard
            key={account.login}
            label={account.login}
            description={
              account.valid ? 'Valid gh session.' : 'gh reports its token as invalid or expired.'
            }
            selected={githubAccount === account.login}
            busy={saving === account.login}
            disabled={busy}
            badge={account.valid ? null : <Badge tone="warning">Token expired</Badge>}
            onSelect={() => void select(account.login)}
          />
        ))}

        {/*
          A chosen account that gh no longer lists (`gh auth logout -u ...`):
          without this card the selection would be INVISIBLE. Gated by
          `!loading`: while the first listing is in flight the list is `[]`
          and every chosen account would flash as "no longer in gh".
        */}
        {!loading &&
          githubAccount !== null &&
          !accounts.some((account) => account.login === githubAccount) && (
            <AccountCard
              label={githubAccount}
              description="Picked earlier, but gh no longer lists it. Pick another account."
              selected
              busy={saving === githubAccount}
              disabled={busy}
              badge={<Badge tone="danger">No longer in gh</Badge>}
              onSelect={() => void select(githubAccount)}
            />
          )}

        {!loading && accounts.length === 0 && (
          <p className="text-[11px] text-muted">
            Could not read gh&apos;s account list. With a single signed-in account this changes
            nothing: Minerva uses whichever account gh resolves.
          </p>
        )}
      </div>

      {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}
    </div>
  )
}

/** Settings section with one block per source-control provider. */
export function SourceControlSection({
  compact = false,
}: {
  compact?: boolean
}): React.JSX.Element {
  return (
    <div className="p-4">
      <GithubAccessSection compact={compact} />
      <AzureDevopsSection compact={compact} />
    </div>
  )
}
