import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Sun, Wand2 } from 'lucide-react'
import { findThemeById, resolveAppearance } from '../../../../../shared/theme/appearance'
import { themeColorToHex } from '../../../../../shared/theme/color'
import {
  pickTheme,
  ThemeLibraryError,
  uniqueThemeId,
  uniqueThemeLabel,
  upsertCustomTheme,
} from '../../../../../shared/theme/library'
import {
  createVividThemeColors,
  getThemeColorsForMode,
  isThemeLabel,
  THEME_COLOR_ROLES,
  updateThemeColorFamily,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from '../../../../../shared/theme/themes'
import { useAppearanceStore } from '../../../stores/appearance-store'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Input } from '../../ui/Input'
import { OverlayDialog } from './OverlayDialog'
import { ThemeColorField } from './ThemeColorField'
import { ThemeWireframe } from './ThemePreviews'
import { useLibraryErrorText } from './library-errors'

export type ThemeEditorTarget = { kind: 'new'; seedId: string } | { kind: 'edit'; id: string }

type Variants = Partial<Record<ThemeAppearance, ThemeColors>>

/**
 * The colors Minerva paints, as editable "families" (T3 Code's editor
 * groups): editing the family's role also re-derives the roles that travel
 * with it (`updateThemeColorFamily`). The remaining T3 Code roles are listed
 * under "More roles" by their raw names: Minerva does not paint them, but
 * they are kept so an exported file still works in T3 Code.
 */
const FAMILIES = [
  'canvas',
  'surface',
  'text',
  'textMuted',
  'border',
  'codeBackground',
  'accent',
  'error',
  'warning',
] as const satisfies readonly ThemeColorRole[]

const FAMILY_ROLES: ReadonlySet<ThemeColorRole> = new Set<ThemeColorRole>([
  ...FAMILIES,
  'chrome',
  'toolbar',
  'toolbarForeground',
  'toolbarControlForeground',
  'mutedForeground',
  'placeholder',
  'secondaryLabel',
  'iconMuted',
  'sidebarMutedForeground',
  'toolbarBorder',
  'sidebarBorder',
  'codeForeground',
  'accentForeground',
  'focus',
  'update',
  'updateForeground',
  'updateSurface',
  'terminalCursor',
  'errorForeground',
  'errorSurface',
  'warningForeground',
  'warningSurface',
])

const OTHER_ROLES = THEME_COLOR_ROLES.filter((role) => !FAMILY_ROLES.has(role))

const APPEARANCES: readonly ThemeAppearance[] = ['light', 'dark']

/** Stock seeds for a variant the theme does not have yet. */
const NEW_VARIANT_CANVAS: Record<ThemeAppearance, string> = { light: '#f6f7f9', dark: '#1a1d23' }

interface Draft {
  /** `null` while creating: the id is derived from the name on save. */
  id: string | null
  label: string
  base: ThemeAppearance
  variants: Variants
  collection?: ThemeDefinition['collection']
}

function variantsOf(theme: ThemeDefinition): Variants {
  return {
    ...(getThemeColorsForMode(theme, 'light')
      ? { light: getThemeColorsForMode(theme, 'light')! }
      : {}),
    ...(getThemeColorsForMode(theme, 'dark')
      ? { dark: getThemeColorsForMode(theme, 'dark')! }
      : {}),
  }
}

/**
 * Create / edit / duplicate a custom theme (T3 Code's theme editor, ported
 * with Minerva's role subset up front). Changes preview live in THIS window
 * while the dialog is open; Save stores the theme in settings.json (through
 * main) and, for a new theme, starts using it.
 */
export function ThemeEditorDialog({
  target,
  onClose,
}: {
  target: ThemeEditorTarget
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useAppearanceStore((s) => s.settings)
  const systemDark = useAppearanceStore((s) => s.systemDark)
  const setPreview = useAppearanceStore((s) => s.setPreview)
  const save = useAppearanceStore((s) => s.save)
  const libraryErrorText = useLibraryErrorText()

  const [draft, setDraft] = useState<Draft>(() => {
    const source =
      findThemeById(settings, target.kind === 'edit' ? target.id : target.seedId) ??
      resolveAppearance(settings, systemDark).theme
    return {
      id: target.kind === 'edit' ? source.id : null,
      label:
        target.kind === 'edit'
          ? source.label
          : uniqueThemeLabel(
              settings,
              t('settings.appearance.editor.copyName', { name: source.label }),
            ),
      base: source.appearance,
      variants: variantsOf(source),
      ...(target.kind === 'edit' && source.collection ? { collection: source.collection } : {}),
    }
  })
  const resolvedAppearance = resolveAppearance(settings, systemDark).appearance
  const [mode, setMode] = useState<ThemeAppearance>(() =>
    draft.variants[resolvedAppearance] ? resolvedAppearance : draft.base,
  )
  const [livePreview, setLivePreview] = useState(true)
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const colors = draft.variants[mode]
  const [seed, setSeed] = useState(() => ({
    canvas: themeColorToHex(colors?.canvas ?? NEW_VARIANT_CANVAS[mode])?.slice(0, 7) ?? '#1a1d23',
    accent: themeColorToHex(colors?.accent ?? '#14b8a6')?.slice(0, 7) ?? '#14b8a6',
  }))

  // Live preview of the variant being edited (this window only); the saved
  // theme comes back when the dialog unmounts.
  useEffect(() => {
    setPreview(livePreview && colors ? { colors, appearance: mode } : null)
  }, [colors, mode, livePreview, setPreview])
  useEffect(() => () => setPreview(null), [setPreview])

  function updateColors(next: ThemeColors): void {
    setDraft((current) => ({ ...current, variants: { ...current.variants, [mode]: next } }))
  }

  function addVariant(appearance: ThemeAppearance): void {
    const accent = draft.variants[mode]?.accent ?? '#14b8a6'
    setDraft((current) => ({
      ...current,
      variants: {
        ...current.variants,
        [appearance]: createVividThemeColors(appearance, NEW_VARIANT_CANVAS[appearance], accent),
      },
    }))
    setMode(appearance)
  }

  function removeVariant(appearance: ThemeAppearance): void {
    const other: ThemeAppearance = appearance === 'light' ? 'dark' : 'light'
    if (!draft.variants[other]) return
    setDraft((current) => ({
      ...current,
      base: current.base === appearance ? other : current.base,
      variants: { [other]: current.variants[other] },
    }))
    setMode(other)
  }

  async function submit(): Promise<void> {
    setError(null)
    const label = draft.label.trim()
    if (!isThemeLabel(label)) {
      setError(t('settings.appearance.editor.nameRequired'))
      return
    }
    const base = draft.variants[draft.base] ? draft.base : mode
    const other: ThemeAppearance = base === 'light' ? 'dark' : 'light'
    const current = useAppearanceStore.getState().settings
    const theme: ThemeDefinition = {
      id: draft.id ?? uniqueThemeId(current, label),
      label: draft.id ? label : uniqueThemeLabel(current, label),
      appearance: base,
      colors: draft.variants[base]!,
      ...(draft.variants[other] ? { variants: { [other]: draft.variants[other] } } : {}),
      ...(draft.collection ? { collection: draft.collection } : {}),
    }
    let next
    try {
      next = upsertCustomTheme(current, theme)
      if (!draft.id) next = pickTheme(next, theme.id)
    } catch (caught) {
      setError(caught instanceof ThemeLibraryError ? libraryErrorText(caught) : String(caught))
      return
    }
    setSaving(true)
    const ok = await save(next)
    setSaving(false)
    if (ok) onClose()
  }

  const familyLabel: Record<(typeof FAMILIES)[number], string> = {
    canvas: t('settings.appearance.editor.roles.canvas'),
    surface: t('settings.appearance.editor.roles.surface'),
    text: t('settings.appearance.editor.roles.text'),
    textMuted: t('settings.appearance.editor.roles.textMuted'),
    border: t('settings.appearance.editor.roles.border'),
    codeBackground: t('settings.appearance.editor.roles.codeBackground'),
    accent: t('settings.appearance.editor.roles.accent'),
    error: t('settings.appearance.editor.roles.error'),
    warning: t('settings.appearance.editor.roles.warning'),
  }
  const modeName = (appearance: ThemeAppearance): string =>
    appearance === 'light'
      ? t('settings.appearance.mode.light')
      : t('settings.appearance.mode.dark')

  return (
    <OverlayDialog
      wide
      testId="theme-editor"
      title={
        target.kind === 'edit'
          ? t('settings.appearance.editor.titleEdit')
          : t('settings.appearance.editor.titleNew')
      }
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mr-auto text-xs text-danger">
              {error}
            </p>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            data-testid="theme-editor-save"
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? t('common.saving') : t('settings.appearance.editor.save')}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4 p-4 md:flex-row">
        <div className="min-w-0 flex-1">
          <label className="mb-3 block text-xs text-muted">
            {t('settings.appearance.editor.name')}
            <Input
              data-testid="theme-editor-name"
              value={draft.label}
              maxLength={48}
              onChange={(event) =>
                setDraft((current) => ({ ...current, label: event.target.value }))
              }
              className="mt-1 block w-full"
            />
          </label>

          <div
            className="mb-3 flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t('settings.appearance.editor.variant')}
          >
            {APPEARANCES.map((appearance) =>
              draft.variants[appearance] ? (
                <button
                  key={appearance}
                  type="button"
                  data-testid={'theme-editor-variant-' + appearance}
                  aria-pressed={mode === appearance}
                  onClick={() => setMode(appearance)}
                  className={
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ' +
                    (mode === appearance
                      ? 'border-accent bg-accent/15 text-text'
                      : 'border-border text-muted hover:bg-border/40')
                  }
                >
                  {appearance === 'light' ? (
                    <Sun size={12} aria-hidden />
                  ) : (
                    <Moon size={12} aria-hidden />
                  )}
                  {modeName(appearance)}
                </button>
              ) : (
                <Button
                  key={appearance}
                  size="xs"
                  onClick={() => addVariant(appearance)}
                  className="border-dashed"
                >
                  {t('settings.appearance.editor.addVariant', { mode: modeName(appearance) })}
                </Button>
              ),
            )}
            {draft.variants.light && draft.variants.dark && (
              <Button variant="ghost" size="xs" onClick={() => removeVariant(mode)} className="ml-auto">
                {t('settings.appearance.editor.removeVariant', { mode: modeName(mode) })}
              </Button>
            )}
          </div>

          {colors && (
            <>
              <section className="mb-3 rounded-md border border-border p-2">
                <h3 className="mb-1 flex items-center gap-1 text-xs font-semibold text-text">
                  <Wand2 size={12} aria-hidden />
                  {t('settings.appearance.editor.generateTitle')}
                </h3>
                <p className="mb-1 text-xs text-muted">
                  {t('settings.appearance.editor.generateHint')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="color"
                      value={seed.canvas}
                      onChange={(event) =>
                        setSeed((current) => ({ ...current, canvas: event.target.value }))
                      }
                      className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    />
                    {t('settings.appearance.editor.roles.canvas')}
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="color"
                      value={seed.accent}
                      onChange={(event) =>
                        setSeed((current) => ({ ...current, accent: event.target.value }))
                      }
                      className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    />
                    {t('settings.appearance.editor.roles.accent')}
                  </label>
                  <Button
                    size="xs"
                    data-testid="theme-editor-generate"
                    onClick={() =>
                      updateColors(createVividThemeColors(mode, seed.canvas, seed.accent))
                    }
                  >
                    {t('settings.appearance.editor.generate')}
                  </Button>
                </div>
              </section>

              <section className="mb-3">
                <h3 className="mb-1 text-xs font-semibold text-text">
                  {t('settings.appearance.editor.minervaColors')}
                </h3>
                {FAMILIES.map((role) => (
                  <ThemeColorField
                    key={mode + role}
                    id={role}
                    label={familyLabel[role]}
                    value={colors[role]}
                    onChange={(value) =>
                      updateColors(updateThemeColorFamily(mode, colors, role, value))
                    }
                  />
                ))}
              </section>

              <section>
                <Button
                  variant="link"
                  size="xs"
                  aria-expanded={showMore}
                  onClick={() => setShowMore((open) => !open)}
                  className="mb-1"
                >
                  {showMore
                    ? t('settings.appearance.editor.hideMore')
                    : t('settings.appearance.editor.showMore', { count: OTHER_ROLES.length })}
                </Button>
                {showMore && (
                  <>
                    <p className="mb-1 text-xs text-muted">
                      {t('settings.appearance.editor.moreHint')}
                    </p>
                    {OTHER_ROLES.map((role) => (
                      <ThemeColorField
                        key={mode + role}
                        id={role}
                        mono
                        label={role}
                        value={colors[role]}
                        onChange={(value) =>
                          updateColors(updateThemeColorFamily(mode, colors, role, value))
                        }
                      />
                    ))}
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="w-full shrink-0 md:w-60">
          <ThemeWireframe className="aspect-[16/10]" panes={colors ? [{ colors, mode }] : []} />
          <Checkbox
            className="mt-2"
            checked={livePreview}
            onChange={(event) => setLivePreview(event.target.checked)}
            label={t('settings.appearance.editor.livePreview')}
          />
        </aside>
      </div>
    </OverlayDialog>
  )
}
