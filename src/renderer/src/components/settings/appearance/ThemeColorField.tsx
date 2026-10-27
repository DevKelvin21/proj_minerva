import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { themeColorToHex, toCanonicalThemeColor } from '../../../../../shared/theme/color'

interface ThemeColorFieldProps {
  /** Visible label (translated family name, or the raw role id for advanced roles). */
  label: string
  /** Stable id for tests (`theme-color-<id>`). */
  id: string
  value: string
  /** Called with the canonical form of a valid color only. */
  onChange: (canonical: string) => void
  mono?: boolean
}

/**
 * One theme color: the native color well (Chromium's picker, with the macOS
 * eyedropper) plus a text field that takes any color the strict parser
 * accepts (`#hex`, `rgb()`, `hsl()`, `oklch()`, …). Invalid text never
 * reaches the theme: it stays in the field with an error until fixed.
 */
export function ThemeColorField({
  label,
  id,
  value,
  onChange,
  mono = false,
}: ThemeColorFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const hex = themeColorToHex(value) ?? '#000000'
  // `null` = showing the theme's value; a string = the user is typing.
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && toCanonicalThemeColor(draft) === null

  function commit(text: string): void {
    const canonical = toCanonicalThemeColor(text)
    if (!canonical) return
    setDraft(null)
    onChange(canonical)
  }

  return (
    <div className="flex min-w-0 items-center gap-2 py-1" data-testid={'theme-color-' + id}>
      <input
        type="color"
        value={hex.slice(0, 7)}
        onChange={(event) => onChange(toCanonicalThemeColor(event.target.value) ?? value)}
        aria-label={t('settings.appearance.editor.pick', { role: label })}
        title={t('settings.appearance.editor.pick', { role: label })}
        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <span className={'min-w-0 flex-1 truncate text-xs text-text ' + (mono ? 'font-mono' : '')}>
        {label}
      </span>
      <input
        type="text"
        spellCheck={false}
        value={draft ?? hex}
        aria-label={t('settings.appearance.editor.valueLabel', { role: label })}
        aria-invalid={invalid}
        title={invalid ? t('settings.appearance.editor.colorInvalid') : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && !invalid) commit(draft)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft !== null) commit(draft)
          if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation()
            setDraft(null)
          }
        }}
        className={
          'w-28 shrink-0 rounded-md border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-text outline-none ' +
          (invalid ? 'border-danger' : 'border-border focus:border-accent/60')
        }
      />
    </div>
  )
}
