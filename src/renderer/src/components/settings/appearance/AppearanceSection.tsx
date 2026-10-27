import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, Moon, Paintbrush, Pencil, Plus, Sun, Trash2 } from 'lucide-react'
import {
  APPEARANCE_MODES,
  DEFAULT_APPEARANCE_CONTRAST,
  MAX_APPEARANCE_CONTRAST,
  MIN_APPEARANCE_CONTRAST,
  allThemes,
  findThemeById,
  resolveAppearance,
  type AppearanceMode,
  type AppearanceSettings,
} from '../../../../../shared/theme/appearance'
import {
  assignHalf,
  halvesUsing,
  pickTheme,
  removeCustomThemes,
  ThemeLibraryError,
} from '../../../../../shared/theme/library'
import {
  getThemeColorsForMode,
  getThemeModes,
  isBuiltInThemeId,
  serializeThemeFile,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from '../../../../../shared/theme/themes'
import { useAppearanceStore } from '../../../stores/appearance-store'
import { errorText } from '../../../lib/error-text'
import { IconButton } from '../../ui/IconButton'
import { ThemeOrb, ThemeWireframe } from './ThemePreviews'
import { ThemeEditorDialog, type ThemeEditorTarget } from './ThemeEditorDialog'
import { ThemeImportDialog } from './ThemeImportDialog'
import { useLibraryErrorText } from './library-errors'

interface AppearanceSectionProps {
  /** Short window (F16): drop the explanatory text, keep the controls. */
  compact?: boolean
}

function colorsFor(settings: AppearanceSettings, appearance: ThemeAppearance): ThemeColors | null {
  const id = appearance === 'light' ? settings.lightTheme : settings.darkTheme
  const theme = findThemeById(settings, id)
  return (theme && getThemeColorsForMode(theme, appearance)) ?? null
}

type Pane = { colors: ThemeColors; mode: ThemeAppearance; clip?: 'left' | 'right' }

/** Wireframe panes of a mode tile: System shows the light half left and the dark half right. */
function modePanes(
  mode: AppearanceMode,
  light: ThemeColors | null,
  dark: ThemeColors | null,
): Pane[] {
  if (mode === 'system') {
    return [
      ...(light ? [{ colors: light, mode: 'light' as const, clip: 'left' as const }] : []),
      ...(dark ? [{ colors: dark, mode: 'dark' as const, clip: 'right' as const }] : []),
    ]
  }
  const colors = mode === 'light' ? light : dark
  return colors ? [{ colors, mode }] : []
}

function downloadThemeFile(theme: ThemeDefinition): void {
  const url = URL.createObjectURL(
    new Blob([serializeThemeFile(theme)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = theme.id + '.json'
  anchor.click()
  // Revoke later so the download can start reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/**
 * Settings → Appearance (T3 Code's "Colors & themes" panel, ported): the
 * System/Light/Dark mode tiles, the theme library (built-ins and the user's
 * own themes, each pickable for both halves or one), create/edit/duplicate/
 * export/delete, import (theme file, VS Code theme, Open VSX) and contrast.
 * Every change is saved through main (`settings:setAppearance`), which pushes
 * it to every window.
 */
export function AppearanceSection({ compact = false }: AppearanceSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useAppearanceStore((s) => s.settings)
  const saveError = useAppearanceStore((s) => s.error)
  const save = useAppearanceStore((s) => s.save)
  const libraryErrorText = useLibraryErrorText()
  const [localError, setLocalError] = useState<string | null>(null)
  const [editor, setEditor] = useState<ThemeEditorTarget | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ThemeDefinition | null>(null)
  // Contrast is dragged locally and saved on release (one write per gesture).
  const [contrastDraft, setContrastDraft] = useState<number | null>(null)
  const contrast = contrastDraft ?? settings.contrast

  function apply(next: (current: AppearanceSettings) => AppearanceSettings): void {
    setLocalError(null)
    let computed: AppearanceSettings
    try {
      computed = next(useAppearanceStore.getState().settings)
    } catch (error) {
      setLocalError(error instanceof ThemeLibraryError ? libraryErrorText(error) : String(error))
      return
    }
    void save(computed)
  }

  function commitContrast(): void {
    if (contrastDraft === null) return
    const value = contrastDraft
    setContrastDraft(null)
    if (value !== settings.contrast) apply((current) => ({ ...current, contrast: value }))
  }

  const modeLabel: Record<AppearanceMode, string> = {
    system: t('settings.appearance.mode.system'),
    light: t('settings.appearance.mode.light'),
    dark: t('settings.appearance.mode.dark'),
  }
  const modeHint: Record<AppearanceMode, string> = {
    system: t('settings.appearance.mode.systemHint'),
    light: t('settings.appearance.mode.lightHint'),
    dark: t('settings.appearance.mode.darkHint'),
  }
  const forModeLabel = (mode: ThemeAppearance, name: string): string =>
    mode === 'light'
      ? t('settings.appearance.themes.useForLight', { name })
      : t('settings.appearance.themes.useForDark', { name })
  const lightColors = colorsFor(settings, 'light')
  const darkColors = colorsFor(settings, 'dark')
  const themes = allThemes(settings)
  const error = localError ?? (saveError ? errorText(saveError) : null)

  return (
    <div className="p-4" data-testid="appearance-section">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('settings.appearance.title')}
      </h3>
      {!compact && (
        <p className="mb-2 text-xs text-muted">{t('settings.appearance.description')}</p>
      )}

      <div
        role="group"
        aria-label={t('settings.appearance.mode.label')}
        className="mb-4 grid grid-cols-3 gap-2"
      >
        {APPEARANCE_MODES.map((mode) => {
          const active = settings.mode === mode
          const panes = modePanes(mode, lightColors, darkColors)
          return (
            <button
              key={mode}
              type="button"
              data-testid={'appearance-mode-' + mode}
              aria-pressed={active}
              title={modeHint[mode]}
              onClick={() => apply((current) => ({ ...current, mode }))}
              className={
                'flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 transition-colors ' +
                (active ? 'border-accent bg-accent/10' : 'border-border hover:bg-border/40')
              }
            >
              <ThemeWireframe panes={panes} className="aspect-[16/10]" />
              <span className={'text-xs font-medium ' + (active ? 'text-text' : 'text-muted')}>
                {modeLabel[mode]}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-text">{t('settings.appearance.themes.title')}</h4>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="theme-create"
            onClick={() => {
              const { systemDark } = useAppearanceStore.getState()
              setEditor({ kind: 'new', seedId: resolveAppearance(settings, systemDark).theme.id })
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-border/40"
          >
            <Paintbrush size={12} aria-hidden />
            {t('settings.appearance.themes.create')}
          </button>
          <button
            type="button"
            data-testid="theme-import"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text hover:bg-border/40"
          >
            <Plus size={12} aria-hidden />
            {t('settings.appearance.themes.import')}
          </button>
        </div>
      </div>
      {!compact && (
        <p className="mb-2 text-xs text-muted">{t('settings.appearance.themes.hint')}</p>
      )}

      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
        data-testid="theme-grid"
      >
        {themes.map((theme) => {
          const usedBy = halvesUsing(settings, theme.id)
          const custom = !isBuiltInThemeId(theme.id)
          return (
            <div
              key={theme.id}
              data-testid="theme-card"
              data-theme-id={theme.id}
              data-active-halves={usedBy.join(' ')}
              className={
                'flex min-w-0 flex-col rounded-lg border transition-colors ' +
                (usedBy.length > 0 ? 'border-accent bg-accent/10' : 'border-border')
              }
            >
              <div className="flex items-center justify-center gap-2 px-2 pt-2">
                {getThemeModes(theme).map((mode) => {
                  const picked = usedBy.includes(mode)
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-testid={'theme-half-' + mode}
                      aria-pressed={picked}
                      aria-label={forModeLabel(mode, theme.label)}
                      title={forModeLabel(mode, theme.label)}
                      onClick={() => apply((current) => assignHalf(current, mode, theme.id))}
                      className={
                        'relative rounded-full p-0.5 transition-transform hover:scale-105 ' +
                        (picked ? 'ring-2 ring-accent' : '')
                      }
                    >
                      <ThemeOrb
                        colors={getThemeColorsForMode(theme, mode)!}
                        mode={mode}
                        size={40}
                      />
                      {picked && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-panel text-text">
                          {mode === 'light' ? (
                            <Sun size={9} aria-hidden />
                          ) : (
                            <Moon size={9} aria-hidden />
                          )}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5 pt-1">
                <button
                  type="button"
                  data-testid="theme-use"
                  onClick={() => apply((current) => pickTheme(current, theme.id))}
                  title={t('settings.appearance.themes.use', { name: theme.label })}
                  aria-label={t('settings.appearance.themes.use', { name: theme.label })}
                  className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs font-medium text-text hover:bg-border/40"
                >
                  {theme.label}
                </button>
                <IconButton
                  icon={<Copy size={12} />}
                  label={t('settings.appearance.themes.duplicate', { name: theme.label })}
                  className="!h-6 !w-6"
                  onClick={() => setEditor({ kind: 'new', seedId: theme.id })}
                />
                {custom && (
                  <>
                    <IconButton
                      icon={<Pencil size={12} />}
                      label={t('settings.appearance.themes.edit', { name: theme.label })}
                      className="!h-6 !w-6"
                      onClick={() => setEditor({ kind: 'edit', id: theme.id })}
                    />
                    <IconButton
                      icon={<Download size={12} />}
                      label={t('settings.appearance.themes.export', { name: theme.label })}
                      className="!h-6 !w-6"
                      onClick={() => downloadThemeFile(theme)}
                    />
                    <IconButton
                      icon={<Trash2 size={12} />}
                      label={t('settings.appearance.themes.delete', { name: theme.label })}
                      className="!h-6 !w-6"
                      onClick={() => setPendingDelete(theme)}
                    />
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {pendingDelete && (
        <div
          role="alertdialog"
          aria-label={t('settings.appearance.themes.deleteTitle', { name: pendingDelete.label })}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-text"
        >
          <span className="min-w-0 flex-1">
            {t('settings.appearance.themes.deleteConfirm', { name: pendingDelete.label })}
          </span>
          <button
            type="button"
            data-testid="theme-delete-confirm"
            onClick={() => {
              const id = pendingDelete.id
              setPendingDelete(null)
              apply((current) => removeCustomThemes(current, [id]))
            }}
            className="rounded-md bg-danger px-2 py-1 font-medium text-white hover:opacity-90"
          >
            {t('settings.appearance.themes.deleteButton')}
          </button>
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            className="rounded-md border border-border px-2 py-1 text-text hover:bg-border/40"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor="appearance-contrast" className="text-xs font-semibold text-text">
            {t('settings.appearance.contrast.label')}
          </label>
          <div className="flex items-center gap-2">
            <span
              className="text-xs tabular-nums text-muted"
              data-testid="appearance-contrast-value"
            >
              {t('settings.appearance.contrast.value', { value: contrast })}
            </span>
            {settings.contrast !== DEFAULT_APPEARANCE_CONTRAST && (
              <button
                type="button"
                onClick={() =>
                  apply((current) => ({ ...current, contrast: DEFAULT_APPEARANCE_CONTRAST }))
                }
                className="text-xs text-accent hover:underline"
              >
                {t('settings.appearance.contrast.reset')}
              </button>
            )}
          </div>
        </div>
        {!compact && (
          <p className="mb-1 text-xs text-muted">{t('settings.appearance.contrast.description')}</p>
        )}
        <input
          id="appearance-contrast"
          data-testid="appearance-contrast"
          type="range"
          min={MIN_APPEARANCE_CONTRAST}
          max={MAX_APPEARANCE_CONTRAST}
          step={5}
          value={contrast}
          onChange={(event) => setContrastDraft(Number(event.target.value))}
          onPointerUp={commitContrast}
          onKeyUp={commitContrast}
          onBlur={commitContrast}
          className="w-full accent-[var(--theme-accent)]"
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t('settings.appearance.saveError', { error })}
        </p>
      )}

      {editor && (
        <ThemeEditorDialog
          key={editor.kind === 'edit' ? 'edit:' + editor.id : 'new:' + editor.seedId}
          target={editor}
          onClose={() => setEditor(null)}
        />
      )}
      {importOpen && <ThemeImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  )
}
