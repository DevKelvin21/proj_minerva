import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileJson, Search } from 'lucide-react'
import {
  importCustomThemes,
  pickTheme,
  ThemeLibraryError,
} from '../../../../../shared/theme/library'
import {
  OPEN_VSX_SORTS,
  type OpenVsxExtension,
  type OpenVsxSort,
} from '../../../../../shared/theme/open-vsx'
import { themesFromOpenVsxPackage } from '../../../../../shared/theme/open-vsx-import'
import { ThemeFileError, type ThemeDefinition } from '../../../../../shared/theme/themes'
import { parseThemeText } from '../../../../../shared/theme/import-text'
import { useAppearanceStore } from '../../../stores/appearance-store'
import { useLocale } from '../../../i18n/use-locale'
import { errorText } from '../../../lib/error-text'
import { OverlayDialog } from './OverlayDialog'
import { useImportErrorText } from './library-errors'

const MAX_IMPORT_BYTES = 1024 * 1024

type Tab = 'file' | 'openVsx'

const TABS: readonly Tab[] = ['file', 'openVsx']

/**
 * Adds themes: Minerva/T3 Code theme files and VS Code color themes (paste
 * or pick a file), or a whole extension from Open VSX (searched and
 * downloaded by main, see `main/theme/open-vsx.ts`). Every color is parsed
 * strictly before it is stored; the first imported theme is put in use.
 */
export function ThemeImportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('file')

  return (
    <OverlayDialog
      testId="theme-import-dialog"
      title={t('settings.appearance.import.title')}
      onClose={onClose}
    >
      <div role="tablist" className="flex gap-1 border-b border-border px-4 pt-2">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            data-testid={'theme-import-tab-' + id}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              '-mb-px rounded-t-md border px-3 py-1 text-xs ' +
              (tab === id
                ? 'border-border border-b-panel bg-panel text-text'
                : 'border-transparent text-muted hover:text-text')
            }
          >
            {id === 'file'
              ? t('settings.appearance.import.tabFile')
              : t('settings.appearance.import.tabOpenVsx')}
          </button>
        ))}
      </div>
      {tab === 'file' ? <FileImport onDone={onClose} /> : <OpenVsxImport />}
    </OverlayDialog>
  )
}

function useImportThemes(): (themes: ThemeDefinition[]) => Promise<ThemeDefinition[] | null> {
  const save = useAppearanceStore((s) => s.save)
  return async (themes) => {
    const current = useAppearanceStore.getState().settings
    const { settings, imported } = importCustomThemes(current, themes)
    const next = imported.length > 0 ? pickTheme(settings, imported[0].id) : settings
    return (await save(next)) ? imported : null
  }
}

function FileImport({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const importErrorText = useImportErrorText()
  const importThemes = useImportThemes()
  const saveError = useAppearanceStore((s) => s.error)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function importText(source: string): Promise<void> {
    setError(null)
    let theme: ThemeDefinition
    try {
      theme = parseThemeText(source)
    } catch (caught) {
      setError(importErrorText(caught))
      return
    }
    setBusy(true)
    try {
      const imported = await importThemes([theme])
      if (imported) onDone()
      else setError(errorText(useAppearanceStore.getState().error ?? saveError ?? ''))
    } catch (caught) {
      setError(importErrorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs text-muted">{t('settings.appearance.import.fileHint')}</p>
      <label className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-border/40">
        <FileJson size={12} aria-hidden />
        {t('settings.appearance.import.pickFile')}
        <input
          type="file"
          data-testid="theme-import-file"
          accept=".json,.jsonc,application/json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (file.size > MAX_IMPORT_BYTES) {
              setError(t('settings.appearance.import.errors.tooLarge'))
              return
            }
            void file.text().then((content) => {
              setText(content)
              return importText(content)
            })
          }}
        />
      </label>
      <label className="text-xs text-muted">
        {t('settings.appearance.import.paste')}
        <textarea
          data-testid="theme-import-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('settings.appearance.import.pastePlaceholder')}
          spellCheck={false}
          rows={8}
          className="mt-1 block w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-[11px] text-text outline-none focus:border-accent/60"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger" data-testid="theme-import-error">
          {error}
        </p>
      )}
      <button
        type="button"
        data-testid="theme-import-submit"
        disabled={busy || text.trim().length === 0 || text.length > MAX_IMPORT_BYTES}
        onClick={() => void importText(text)}
        className="self-end rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t('common.saving') : t('settings.appearance.import.submit')}
      </button>
    </div>
  )
}

function OpenVsxImport(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const importErrorText = useImportErrorText()
  const importThemes = useImportThemes()
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<OpenVsxSort>('relevance')
  const [results, setResults] = useState<OpenVsxExtension[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installed, setInstalled] = useState<Record<string, number>>({})
  const sortLabel: Record<OpenVsxSort, string> = {
    relevance: t('settings.appearance.import.openVsx.sorts.relevance'),
    downloadCount: t('settings.appearance.import.openVsx.sorts.downloadCount'),
    rating: t('settings.appearance.import.openVsx.sorts.rating'),
    timestamp: t('settings.appearance.import.openVsx.sorts.timestamp'),
  }

  async function search(): Promise<void> {
    const text = query.trim()
    if (!text) return
    setSearching(true)
    setError(null)
    try {
      setResults(await window.minerva.themes.searchOpenVsx({ query: text.slice(0, 100), sortBy }))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setSearching(false)
    }
  }

  async function install(extension: OpenVsxExtension): Promise<void> {
    setInstalling(extension.id)
    setError(null)
    try {
      const pkg = await window.minerva.themes.installOpenVsx({
        namespace: extension.namespace,
        name: extension.name,
      })
      const imported = await importThemes(themesFromOpenVsxPackage(pkg))
      if (imported) setInstalled((current) => ({ ...current, [extension.id]: imported.length }))
      else setError(errorText(useAppearanceStore.getState().error ?? ''))
    } catch (caught) {
      setError(
        caught instanceof ThemeFileError ||
          caught instanceof ThemeLibraryError ||
          caught instanceof SyntaxError
          ? importErrorText(caught)
          : errorText(caught),
      )
    } finally {
      setInstalling(null)
    }
  }

  const numberFormat = new Intl.NumberFormat(locale, { notation: 'compact' })

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs text-muted">{t('settings.appearance.import.openVsx.note')}</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <input
          data-testid="open-vsx-query"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.appearance.import.openVsx.placeholder')}
          aria-label={t('settings.appearance.import.openVsx.search')}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text outline-none focus:border-accent/60"
        />
        <select
          value={sortBy}
          aria-label={t('settings.appearance.import.openVsx.sort')}
          onChange={(event) => setSortBy(event.target.value as OpenVsxSort)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-text"
        >
          {OPEN_VSX_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {sortLabel[sort]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          data-testid="open-vsx-search"
          disabled={searching || query.trim().length === 0}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          <Search size={12} aria-hidden />
          {searching
            ? t('settings.appearance.import.openVsx.searching')
            : t('settings.appearance.import.openVsx.search')}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger" data-testid="open-vsx-error">
          {error}
        </p>
      )}
      {results && results.length === 0 && (
        <p className="text-xs text-muted">{t('settings.appearance.import.openVsx.noResults')}</p>
      )}
      <ul className="flex flex-col gap-2" data-testid="open-vsx-results">
        {results?.map((extension) => (
          <li
            key={extension.id}
            data-testid="open-vsx-result"
            data-extension-id={extension.id}
            className="flex min-w-0 items-start gap-2 rounded-md border border-border p-2"
          >
            {extension.iconUrl ? (
              <img src={extension.iconUrl} alt="" className="h-8 w-8 shrink-0 rounded" />
            ) : (
              <span aria-hidden className="h-8 w-8 shrink-0 rounded bg-border/40" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">{extension.displayName}</p>
              <p className="truncate text-[11px] text-muted">
                {t('settings.appearance.import.openVsx.meta', {
                  publisher: extension.namespace,
                  downloads: numberFormat.format(extension.downloadCount),
                  license: extension.license,
                })}
              </p>
              {extension.description && (
                <p className="line-clamp-2 text-xs text-muted">{extension.description}</p>
              )}
            </div>
            <button
              type="button"
              data-testid="open-vsx-install"
              disabled={installing !== null}
              onClick={() => void install(extension)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-border/40 disabled:opacity-50"
            >
              <Download size={12} aria-hidden />
              {installing === extension.id
                ? t('settings.appearance.import.openVsx.installing')
                : installed[extension.id] !== undefined
                  ? t('settings.appearance.import.openVsx.installed', {
                      count: installed[extension.id],
                    })
                  : t('settings.appearance.import.openVsx.install')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
