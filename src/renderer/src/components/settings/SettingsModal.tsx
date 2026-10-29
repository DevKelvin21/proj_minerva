import { useState } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/app-store'
import { useSettings } from '../../hooks/use-settings'
import { useProviderStatus } from '../../hooks/use-provider-status'
import { useProviderAuthViews } from '../../hooks/use-provider-auth-views'
import { useLayoutTier } from '../../hooks/use-layout-tier'
import { useUpdater } from '../../hooks/use-updater'
import {
  SETTINGS_PAGE_GROUP,
  resolveSettingsPage,
  settingsPageDots,
  settingsSplitView,
  visibleSettingsPages,
  type SettingsPageId,
} from '../../lib/settings-pages'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { IconButton } from '../ui/IconButton'
import { SettingsNav } from './SettingsNav'
import { useSettingsPageLabel } from './use-settings-page-label'
import { GithubPage } from './GithubPage'
import { AzureDevopsSection } from './AzureDevopsSection'
import { AiProvidersPage } from './AiProvidersPage'
import { AiModelPage } from './AiModelPage'
import { UpdateSection } from './UpdateSection'
import { LanguageSection } from './LanguageSection'
import { NotificationsSection } from './NotificationsSection'
import { AppearanceSection } from './appearance/AppearanceSection'

/**
 * The Settings dialog: a page list on the left grouped by concern (General,
 * Appearance, Source control, AI, App) and one page at a time on the right,
 * under a breadcrumb header with the close button.
 *
 * `App.tsx` mounts it only while `settingsOpen` is true, so every page's
 * local state (drafts, the viewed AI provider) resets on the next open. The
 * page itself lives in the store (`settingsPage`): callers open Settings on
 * the page they are about (`openSettings('github')`), and otherwise it opens
 * on the last page visited this session.
 *
 * Tiled (below `lg`, see `settingsSplitView`) the list and the page take
 * turns: the list first, unless the caller named a page, and a Back button on
 * the page. A short window (`xshort`) makes the dialog take the whole window.
 *
 * The shell is `ui/Dialog`: Esc or a click on the scrim closes it, focus
 * stays inside while it is open and returns to the opener on close.
 */
export function SettingsModal(): React.JSX.Element {
  const { t } = useTranslation()
  const closeSettings = useAppStore((s) => s.closeSettings)
  const requestedPage = useAppStore((s) => s.settingsPage)
  const setSettingsPage = useAppStore((s) => s.setSettingsPage)
  const entry = useAppStore((s) => s.settingsEntry)
  const settings = useSettings()
  const providerStatus = useProviderStatus()
  const scmViews = useProviderAuthViews()
  const updater = useUpdater()
  const tier = useLayoutTier()
  const split = settingsSplitView(tier.w)
  const isSheet = tier.h === 'xshort'
  // Tiled: which of the two takes the dialog. Local, so it resets per open.
  const [showList, setShowList] = useState(entry === 'list')

  const updatesVisible = updater.status !== null && updater.status.phase !== 'disabled'
  const visible = visibleSettingsPages({ updates: updatesVisible })
  const page = resolveSettingsPage(requestedPage, visible)
  const dots = settingsPageDots({
    scm: scmViews,
    activeAiStatus: settings.info ? providerStatus.statuses?.[settings.info.provider] : undefined,
    updater: updater.status,
  })

  const sizeClass = isSheet
    ? 'h-full w-full ' + (split ? 'max-w-[1000px]' : '')
    : 'h-[min(88vh,720px)] w-full ' + (split ? 'max-w-[960px]' : 'max-w-xl')

  function select(next: SettingsPageId): void {
    setSettingsPage(next)
    setShowList(false)
  }

  const nav = (
    <SettingsNav
      pages={visible}
      current={page}
      dots={dots}
      onSelect={select}
      // Side by side, arrows switch the page as they move (like tabs); as a
      // full list they only move focus, and Enter opens the page.
      followFocus={split}
      className={split ? 'w-52 shrink-0 border-r border-border' : 'min-h-0 flex-1'}
    />
  )

  const body = (
    <SettingsPage
      page={page}
      settings={settings}
      providerStatus={providerStatus}
      updater={updater}
      onNavigate={select}
    />
  )

  return (
    <Dialog
      onClose={closeSettings}
      label={t('settings.modal.title')}
      className={sizeClass}
      testId="settings-dialog"
    >
      {split ? (
        <div className="flex min-h-0 flex-1">
          {nav}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SettingsHeader page={page} onClose={closeSettings} />
            {body}
          </div>
        </div>
      ) : showList ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <SettingsHeader page={null} onClose={closeSettings} />
          {nav}
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SettingsHeader page={page} onClose={closeSettings} onBack={() => setShowList(true)} />
          {body}
        </div>
      )}
    </Dialog>
  )
}

/**
 * "Settings / Source control / GitHub" and the close button. The first crumb
 * is the dialog's heading; `page === null` is the page list (tiled).
 */
function SettingsHeader({
  page,
  onClose,
  onBack,
}: {
  page: SettingsPageId | null
  onClose: () => void
  onBack?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pageLabel = useSettingsPageLabel()
  const group = page ? SETTINGS_PAGE_GROUP[page] : null
  // Beside a Back button on a narrow window only the page name stays.
  const leading = onBack ? 'hidden sm:block' : ''
  const separator = (
    <li aria-hidden className={'text-muted ' + leading}>
      /
    </li>
  )
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-3 pr-2 sm:pl-5">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          icon={<ChevronLeft size={14} aria-hidden />}
          data-testid="settings-back"
          className="-ml-1.5"
        >
          {t('settings.modal.back')}
        </Button>
      )}
      <nav aria-label={t('settings.modal.breadcrumb')} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-sm">
          <li className={leading}>
            <h2 className={page ? 'font-normal text-muted' : 'font-semibold text-text'}>
              {t('settings.modal.title')}
            </h2>
          </li>
          {group && (
            <>
              {separator}
              <li className={'truncate text-muted ' + leading}>
                {t(`settings.nav.groups.${group}`)}
              </li>
            </>
          )}
          {page && (
            <>
              {separator}
              <li
                aria-current="page"
                data-testid="settings-current-page"
                className="min-w-0 truncate font-semibold text-text"
              >
                {pageLabel(page)}
              </li>
            </>
          )}
        </ol>
      </nav>
      <IconButton icon={<X size={16} />} label={t('settings.modal.close')} onClick={onClose} />
    </header>
  )
}

interface SettingsPageProps {
  page: SettingsPageId
  settings: ReturnType<typeof useSettings>
  providerStatus: ReturnType<typeof useProviderStatus>
  updater: ReturnType<typeof useUpdater>
  onNavigate: (page: SettingsPageId) => void
}

/** The scrolling body with the current page. Pages mount only while shown. */
function SettingsPage({
  page,
  settings,
  providerStatus,
  updater,
  onNavigate,
}: SettingsPageProps): React.JSX.Element {
  const { t } = useTranslation()
  const { info, error, selectProvider, saveModel, setModelOption } = settings
  const needsInfo = page === 'ai-providers' || page === 'ai-model'

  let content: React.JSX.Element
  if (needsInfo && info === null) {
    content = <p className="text-xs text-muted">{t('common.loading')}</p>
  } else if (page === 'general') {
    content = <LanguageSection />
  } else if (page === 'appearance') {
    content = <AppearanceSection />
  } else if (page === 'github') {
    content = <GithubPage />
  } else if (page === 'azure') {
    content = <AzureDevopsSection />
  } else if (page === 'ai-providers' && info !== null) {
    content = (
      <AiProvidersPage
        info={info}
        statuses={providerStatus.statuses}
        loading={providerStatus.loading}
        onRecheck={providerStatus.refetch}
      />
    )
  } else if (page === 'ai-model' && info !== null) {
    content = (
      <AiModelPage
        info={info}
        error={error}
        statuses={providerStatus.statuses}
        selectProvider={selectProvider}
        saveModel={saveModel}
        setModelOption={setModelOption}
        onOpenProviders={() => onNavigate('ai-providers')}
      />
    )
  } else if (page === 'notifications') {
    content = <NotificationsSection />
  } else {
    content = <UpdateSection updater={updater} />
  }

  return (
    <div
      key={page}
      data-settings-page={page}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-bg px-4 py-5 sm:px-6"
    >
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6">{content}</div>
    </div>
  )
}
