import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ScmAuthStatus } from '../../../../shared/scm'
import type { GhAccount } from '../../../../shared/types'
import { useGhAccounts } from '../../hooks/use-gh-accounts'
import { useScmAuth } from '../../hooks/use-scm-auth'
import { useScmSettings } from '../../hooks/use-scm-settings'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Callout } from '../ui/Callout'
import { Switch } from '../ui/Switch'
import { ScmRecheckButton } from './ScmRecheckButton'
import { SettingsCardBody, SettingsGroup, SettingsRow } from './SettingsRow'

/** External link consistent with the design system (see `CliLoginGuide.tsx`): main's link guard opens it in the system browser. */
export function ExternalLink({
  href,
  children,
}: {
  href: string
  children?: React.ReactNode
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
  const { t } = useTranslation()
  if (status === undefined) return <p className="text-xs text-muted">{t('common.loading')}</p>
  if (status.state === 'cli_unavailable') {
    return <p className="text-xs text-danger">{t('settings.github.cliNotFound')}</p>
  }
  if (status.state === 'cli_unauthenticated') {
    return <p className="text-xs text-warning">{status.detail ?? t('settings.github.noSession')}</p>
  }
  if (status.state === 'signed_in') {
    return (
      <p className="text-xs text-success">
        {t('settings.github.signedInAs', { login: status.user?.login ?? '' })}
      </p>
    )
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
  const { t } = useTranslation()
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
          <Badge tone="success">{t('settings.github.active')}</Badge>
        ) : null}
      </span>
    </button>
  )
}

/**
 * Settings › Source control › GitHub. GitHub goes through the `gh` CLI
 * session only — nothing to authorize per machine, and enterprise orgs that
 * block third-party OAuth apps usually approve GitHub CLI.
 *
 * Access first (the switch, which saves at once; the sign-in help only while
 * `gh` is missing or signed out; the probe's answer with "Check again"),
 * then the account picker. It exists because `gh` supports several accounts
 * and, without `--user`, resolves its own active one. Picking here NEVER runs
 * `gh auth switch`: the choice is local to Minerva and the user's terminal
 * stays where it was.
 */
export function GithubPage(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { statuses } = useScmAuth()
  const { info, setGithubAccount, saveProviderSettings } = useScmSettings()
  const [togglingGithub, setTogglingGithub] = useState(false)
  const { accounts, loading, reload } = useGhAccounts(info?.providers.github.enabled !== false)
  // `null` is a legitimate value ("follow gh's active account"), so "nothing
  // in flight" needs its own sentinel: `undefined`.
  const [saving, setSaving] = useState<string | null | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (info === null) return null
  const githubAccount = info.githubAccount
  const enabled = info.providers.github.enabled
  const status = statuses?.github
  const signedOut = status?.state === 'cli_unavailable' || status?.state === 'cli_unauthenticated'

  async function select(login: string | null): Promise<void> {
    if (login === githubAccount || saving !== undefined) return
    setSaving(login)
    setSaveError(null)
    const ok = await setGithubAccount(login)
    setSaving(undefined)
    if (!ok) setSaveError(t('settings.github.switchError'))
  }

  const busy = saving !== undefined
  const activeInGh = accounts.find((account) => account.active) ?? null
  const mono = <span className="font-mono text-text" />

  return (
    <>
      {info.mockScm && <Callout tone="warning">{t('settings.github.demoMode')}</Callout>}

      <SettingsGroup title={t('settings.scmPage.access')}>
        <SettingsRow
          title={t('settings.github.enableTitle')}
          description={<Trans i18nKey="settings.github.intro" components={{ mono }} />}
          control={
            <Switch
              fieldSize="md"
              checked={enabled}
              aria-disabled={togglingGithub || undefined}
              label={<span className="sr-only">{t('settings.github.enable')}</span>}
              onCheckedChange={(next) => {
                setTogglingGithub(true)
                void saveProviderSettings({ github: { enabled: next } }).finally(() =>
                  setTogglingGithub(false),
                )
              }}
            />
          }
        />
        {/* Turned off: no `gh` instructions or status (nothing to sign in to). */}
        {enabled && signedOut && (
          <SettingsRow
            title={t('settings.scmPage.signIn')}
            description={
              <Trans
                i18nKey="settings.github.install"
                components={{ link: <ExternalLink href="https://cli.github.com" />, mono }}
              />
            }
          />
        )}
        {enabled && (
          <SettingsRow
            title={t('settings.scmPage.connection')}
            description={<GhCliStatusFeedback status={status} />}
            control={<ScmRecheckButton />}
          />
        )}
      </SettingsGroup>

      {/* Turned off: no account picker either. */}
      {enabled && (
        <SettingsGroup
          title={t('settings.github.account')}
          description={t('settings.github.accountHint')}
          actions={
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void reload()}
              disabled={loading || busy}
              icon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
            >
              {t('settings.github.refresh')}
            </Button>
          }
        >
          <SettingsCardBody>
            <GithubAccountCards
              accounts={accounts}
              loading={loading}
              busy={busy}
              saving={saving}
              githubAccount={githubAccount}
              activeInGh={activeInGh}
              select={select}
            />
            {saveError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {saveError}
              </p>
            )}
          </SettingsCardBody>
        </SettingsGroup>
      )}
    </>
  )
}

/** The account picker's cards (GitHub turned on only). */
function GithubAccountCards({
  accounts,
  loading,
  busy,
  saving,
  githubAccount,
  activeInGh,
  select,
}: {
  accounts: GhAccount[]
  loading: boolean
  busy: boolean
  saving: string | null | undefined
  githubAccount: string | null
  activeInGh: GhAccount | null
  select: (login: string | null) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      {/*
        "Follow gh" is ALWAYS present, even with an empty list (gh missing or
        unreadable output): it works without enumerating anything, so
        leaving it out would turn a listing failure into "nothing to pick".
      */}
      <AccountCard
        label={t('settings.github.followGh')}
        description={
          activeInGh !== null
            ? t('settings.github.followGhNow', { login: activeInGh.login })
            : t('settings.github.followGhResolved')
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
            account.valid ? t('settings.github.validSession') : t('settings.github.invalidSession')
          }
          selected={githubAccount === account.login}
          busy={saving === account.login}
          disabled={busy}
          badge={
            account.valid ? null : <Badge tone="warning">{t('settings.github.tokenExpired')}</Badge>
          }
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
            description={t('settings.github.goneFromGh')}
            selected
            busy={saving === githubAccount}
            disabled={busy}
            badge={<Badge tone="danger">{t('settings.github.noLongerInGh')}</Badge>}
            onSelect={() => void select(githubAccount)}
          />
        )}

      {!loading && accounts.length === 0 && (
        <p className="text-[11px] text-muted">{t('settings.github.listUnreadable')}</p>
      )}
    </div>
  )
}
