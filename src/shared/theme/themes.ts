/**
 * Theme definitions: built-ins, palette generation, editing and theme files.
 *
 * Ported from T3 Code (`apps/web/src/themePalette.ts`,
 * https://github.com/pingdotgg/t3code), MIT License, Copyright (c) 2026 T3
 * Tools Inc. See THIRD_PARTY_NOTICES.md. What changed in the port: no Effect
 * Schema / Atom / localStorage (the theme library lives in settings.json,
 * see `./appearance.ts`), no published "environment" themes, and a Minerva
 * built-in palette next to T3 Code's. Theme files (`version: 1`) keep the
 * same format, so a file exported from T3 Code imports here and vice versa.
 * Pure TypeScript, shared by main and the renderer.
 */
import {
  EMBER_THEME,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeVariants,
} from './palettes'
import {
  formatOklchThemeColor,
  isDarkRgb,
  mixThemeRgbColors,
  parseThemeColor,
  parseThemeRgbColor,
  readableThemeColorOn,
  readableThemeForeground,
  readableThemeText,
  solveOklchLightness,
  standardMutedThemeText,
  THEME_BLACK_FOREGROUND,
  THEME_LIGHT_FOREGROUND,
  THEME_WHITE_FOREGROUND,
  themeOklchToRgb,
  themeOklchToThemeColor,
  themeRgbToOklch,
  themeRgbToThemeColor,
  toCanonicalThemeColor,
  type ThemeOklch,
  type ThemeRgb,
} from './color'

export { THEME_COLOR_ROLES }
export type { ThemeAppearance, ThemeColorRole, ThemeColors, ThemeDefinition, ThemeVariants }

export const THEME_FILE_VERSION = 1 as const
export const MINERVA_THEME_ID = 'minerva'
export const T3_CODE_THEME_ID = 't3-code'

/** Built-in ids plus appearance keywords and T3 Code's legacy aliases: a custom theme can never take one. */
export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set([
  'system',
  'light',
  'dark',
  MINERVA_THEME_ID,
  T3_CODE_THEME_ID,
  't3-chat',
  'grove',
  'ocean',
  'ember',
  'iris',
  't3-chat-dark',
  't3-grove',
  't3-ocean',
  't3-ember',
  't3-iris',
])

const THEME_COLOR_ROLE_SET: ReadonlySet<string> = new Set(THEME_COLOR_ROLES)

export type ThemeColorOverrides = Readonly<Partial<Record<ThemeColorRole, string>>>
export type ThemeCollection = Readonly<{ id: string; label: string }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === 'light' || value === 'dark'
}

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,47})$/.test(value)
}

export function isThemeLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 48
}

export function isThemeCollectionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9.:-]{0,127}$/i.test(value)
}

function parseThemeCollection(value: unknown): ThemeCollection | undefined {
  return isRecord(value) && isThemeCollectionId(value.id) && isThemeLabel(value.label)
    ? { id: value.id, label: value.label.trim() }
    : undefined
}

export function themeIdFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return normalized || 'custom-theme'
}

/** Every role, canonicalized; throws on a color that does not parse (built-ins are tested). */
export function decodeThemeColors(colors: ThemeColors): ThemeColors {
  return Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => {
      const color = toCanonicalThemeColor(colors[role])
      if (!color) {
        throw new Error('The color for "' + role + '" is not a valid CSS color literal.')
      }
      return [role, color]
    }),
  ) as Record<ThemeColorRole, string>
}

export function canonicalizeThemeDefinition(theme: ThemeDefinition): ThemeDefinition {
  return {
    ...theme,
    colors: decodeThemeColors(theme.colors),
    ...(theme.variants
      ? {
          variants: Object.fromEntries(
            Object.entries(theme.variants).map(([appearance, colors]) => [
              appearance,
              decodeThemeColors(colors as ThemeColors),
            ]),
          ) as ThemeVariants,
        }
      : {}),
  }
}

export function getThemeColorsForMode(
  theme: ThemeDefinition,
  mode: ThemeAppearance,
): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors
  return theme.variants?.[mode] ?? null
}

export function getThemeModes(theme: ThemeDefinition): ReadonlyArray<ThemeAppearance> {
  return (['light', 'dark'] as const).filter((mode) => getThemeColorsForMode(theme, mode) !== null)
}

export function singleAppearanceOf(theme: ThemeDefinition): ThemeAppearance | null {
  const modes = getThemeModes(theme)
  return modes.length === 1 ? modes[0] : null
}

// ---------------------------------------------------------------------------
// Palette generation (T3 Code's "vivid" generator: a canvas + an accent give
// every role, with WCAG contrast solved per foreground).
// ---------------------------------------------------------------------------

const STANDARD_STATUS_COLORS = {
  light: {
    error: '#fb2c36',
    errorForeground: '#c10007',
    warning: '#fe9a00',
    warningForeground: '#bb4d00',
  },
  dark: {
    error: '#fb414a',
    errorForeground: '#ff6467',
    warning: '#fe9a00',
    warningForeground: '#ffb900',
  },
} as const

function standardStatusColors(
  canvas: ThemeRgb,
): Pick<
  ThemeColors,
  'error' | 'errorForeground' | 'errorSurface' | 'warning' | 'warningForeground' | 'warningSurface'
> {
  const appearance: ThemeAppearance = isDarkRgb(canvas) ? 'dark' : 'light'
  const standard = STANDARD_STATUS_COLORS[appearance]
  const surfaceMix = appearance === 'dark' ? 0.16 : 0.08
  const surfaceOf = (value: string): ThemeRgb =>
    mixThemeRgbColors(canvas, parseThemeRgbColor(value, canvas), surfaceMix)
  const readableOn = (foreground: string, surface: ThemeRgb): string =>
    themeOklchToThemeColor(
      solveOklchLightness(
        themeRgbToOklch(parseThemeRgbColor(foreground, canvas)),
        surface,
        4.6,
        appearance === 'dark' ? 'lighter' : 'darker',
      ),
    )
  const errorSurface = surfaceOf(standard.error)
  const warningSurface = surfaceOf(standard.warning)
  return {
    error: toCanonicalThemeColor(standard.error) as string,
    errorForeground: readableOn(standard.errorForeground, errorSurface),
    errorSurface: themeRgbToThemeColor(errorSurface),
    warning: toCanonicalThemeColor(standard.warning) as string,
    warningForeground: readableOn(standard.warningForeground, warningSurface),
    warningSurface: themeRgbToThemeColor(warningSurface),
  }
}

/** Fallback for roles a theme file leaves out (same choice as T3 Code: T3 Chat's palette). */
export function getDefaultThemeColors(appearance: ThemeAppearance): ThemeColors {
  return appearance === 'dark'
    ? (T3_CHAT_THEME.variants?.dark as ThemeColors)
    : T3_CHAT_THEME.colors
}

let standardLight: ThemeColors | undefined
let standardDark: ThemeColors | undefined

/** T3 Code's stock light/dark palettes, canonicalized. */
export function getStandardThemeColors(appearance: ThemeAppearance): ThemeColors {
  if (appearance === 'dark') return (standardDark ??= decodeThemeColors(T3_CODE_DARK_THEME_COLORS))
  return (standardLight ??= decodeThemeColors(T3_CODE_LIGHT_THEME_COLORS))
}

export function createVividThemeColors(
  appearance: ThemeAppearance,
  backgroundValue: string,
  accentValue: string,
): ThemeColors {
  const defaults = getDefaultThemeColors(appearance)
  const canvasRgb = parseThemeRgbColor(
    backgroundValue,
    appearance === 'dark' ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 },
  )
  const accentRgb = parseThemeRgbColor(accentValue, { r: 168, g: 67, b: 112 })
  const canvas = themeRgbToOklch(canvasRgb)
  const accent = themeRgbToOklch(accentRgb)
  const dark = isDarkRgb(canvasRgb)
  const hue = accent.C < 0.02 ? canvas.h : accent.h
  const tintC = Math.min(0.045, Math.max(0.008, accent.C * 0.22))
  const step = dark ? 1 : -1

  const surfaceAt = (deltaL: number, chroma = tintC): ThemeOklch => ({
    L: Math.min(0.98, Math.max(0.05, canvas.L + step * deltaL)),
    C: chroma,
    h: hue,
  })
  const themeColor = (color: ThemeOklch): string => themeOklchToThemeColor(color)

  const textBase: ThemeOklch = { L: dark ? 0.95 : 0.2, C: Math.min(0.035, accent.C * 0.25), h: hue }
  const text = solveOklchLightness(textBase, canvasRgb, 7, dark ? 'lighter' : 'darker')
  const textRgb = themeOklchToRgb(text)
  const textMutedRgb = standardMutedThemeText(canvasRgb, textRgb)

  const action: ThemeOklch = {
    L: Math.min(0.85, Math.max(0.35, accent.L + (dark ? 0.06 : -0.02))),
    C: Math.max(accent.C * 0.9, 0.06),
    h: (hue + 50) % 360,
  }
  const actionRgb = themeOklchToRgb(action)
  const actionForeground = readableThemeForeground(actionRgb)
  const accentForeground = readableThemeForeground(accentRgb)

  const sidebar = surfaceAt(0.045, tintC * 1.4)
  const sidebarRgb = themeOklchToRgb(sidebar)
  const surface = surfaceAt(0.015)
  const surfaceRaised = surfaceAt(0.05)
  const surfaceRaisedRgb = themeOklchToRgb(surfaceRaised)
  const surfaceOverlay = surfaceAt(0.075)
  const border = surfaceAt(dark ? 0.16 : 0.12, Math.min(0.07, accent.C * 0.35))
  const input = surfaceAt(dark ? 0.21 : 0.16, Math.min(0.08, accent.C * 0.4))
  const secondary = surfaceAt(dark ? 0.1 : 0.06, Math.min(0.09, accent.C * 0.5))
  const secondaryRgb = themeOklchToRgb(secondary)
  const muted = surfaceAt(dark ? 0.06 : 0.04, Math.min(0.06, accent.C * 0.35))
  const mutedRgb = themeOklchToRgb(muted)
  const accentSurface = surfaceAt(dark ? 0.13 : 0.08, Math.min(0.11, accent.C * 0.55))
  const accentSurfaceRgb = themeOklchToRgb(accentSurface)
  const messageSurface = surfaceAt(dark ? 0.16 : 0.1, Math.min(0.13, accent.C * 0.6))
  const messageSurfaceRgb = themeOklchToRgb(messageSurface)
  const codeBackground = surfaceAt(0.035, tintC * 0.8)
  const updateSurface = surfaceAt(dark ? 0.14 : 0.09, Math.min(0.12, accent.C * 0.55))

  const foregroundOn = (surfaceRgb: ThemeRgb): string =>
    themeOklchToThemeColor(
      solveOklchLightness(textBase, surfaceRgb, 4.6, dark ? 'lighter' : 'darker'),
    )
  const mutedForeground = themeRgbToThemeColor(readableThemeText(mutedRgb, textRgb, 1, 4.6))
  const placeholder = themeRgbToThemeColor(readableThemeText(surfaceRaisedRgb, textRgb, 1, 4.6))
  const searchMatch = themeOklchToRgb(surfaceAt(0.22, Math.min(0.12, accent.C)))
  const searchMatchActive = themeOklchToRgb(surfaceAt(0.4, Math.min(0.18, accent.C)))
  const actionHover: ThemeOklch = { ...action, L: action.L + (dark ? 0.06 : -0.06) }

  return {
    ...defaults,
    ...standardStatusColors(canvasRgb),
    canvas: themeRgbToThemeColor(canvasRgb),
    chrome: themeRgbToThemeColor(canvasRgb),
    toolbar: themeRgbToThemeColor(canvasRgb),
    toolbarForeground: themeRgbToThemeColor(textRgb),
    toolbarBorder: themeColor(surfaceAt(dark ? 0.14 : 0.1, Math.min(0.08, accent.C * 0.4))),
    toolbarControl: themeColor(surfaceAt(dark ? 0.09 : 0.05, tintC * 1.3)),
    toolbarControlForeground: themeRgbToThemeColor(textRgb),
    toolbarControlHover: themeColor(surfaceAt(dark ? 0.14 : 0.09, tintC * 1.6)),
    surface: themeColor(surface),
    surfaceRaised: themeColor(surfaceRaised),
    surfaceOverlay: themeColor(surfaceOverlay),
    text: themeRgbToThemeColor(textRgb),
    textMuted: themeRgbToThemeColor(textMutedRgb),
    border: themeColor(border),
    input: themeColor(input),
    focus: themeRgbToThemeColor(accentRgb),
    accent: themeRgbToThemeColor(accentRgb),
    accentForeground: themeRgbToThemeColor(accentForeground),
    secondary: themeColor(secondary),
    secondaryForeground: foregroundOn(secondaryRgb),
    muted: themeColor(muted),
    mutedForeground,
    placeholder,
    secondaryLabel: themeRgbToThemeColor(textMutedRgb),
    iconMuted: themeRgbToThemeColor(textMutedRgb),
    update: themeRgbToThemeColor(accentRgb),
    updateForeground: foregroundOn(themeOklchToRgb(updateSurface)),
    updateSurface: themeColor(updateSurface),
    accentSurface: themeColor(accentSurface),
    accentSurfaceForeground: foregroundOn(accentSurfaceRgb),
    messageSurface: themeColor(messageSurface),
    messageForeground: foregroundOn(messageSurfaceRgb),
    messageAction: themeRgbToThemeColor(actionRgb),
    messageActionForeground: themeRgbToThemeColor(actionForeground),
    messageActionHover: themeColor(actionHover),
    codeBackground: themeColor(codeBackground),
    codeForeground: themeRgbToThemeColor(textRgb),
    searchMatchBackground: themeRgbToThemeColor(searchMatch),
    searchMatchForeground: themeRgbToThemeColor(readableThemeForeground(searchMatch)),
    searchMatchActiveBackground: themeRgbToThemeColor(searchMatchActive),
    searchMatchActiveForeground: themeRgbToThemeColor(readableThemeForeground(searchMatchActive)),
    sidebar: themeColor(sidebar),
    sidebarForeground: foregroundOn(sidebarRgb),
    sidebarMutedForeground: themeRgbToThemeColor(standardMutedThemeText(sidebarRgb, textRgb)),
    sidebarControlSurface: themeColor(surfaceAt(dark ? 0.1 : 0.07, tintC * 1.5)),
    sidebarRowHover: themeColor(surfaceAt(dark ? 0.08 : 0.06, Math.min(0.08, accent.C * 0.45))),
    sidebarRowActive: themeColor(surfaceAt(dark ? 0.12 : 0.09, Math.min(0.1, accent.C * 0.55))),
    sidebarRowSelected: themeColor(surfaceAt(dark ? 0.14 : 0.1, Math.min(0.11, accent.C * 0.6))),
    sidebarBorder: themeColor(surfaceAt(dark ? 0.17 : 0.12, Math.min(0.08, accent.C * 0.4))),
    terminalBackground: themeRgbToThemeColor(canvasRgb),
    terminalForeground: themeRgbToThemeColor(textRgb),
    terminalCursor: themeRgbToThemeColor(accentRgb),
    terminalSelection: themeColor(surfaceAt(dark ? 0.18 : 0.12, Math.min(0.12, accent.C * 0.55))),
    terminalScrollbar: themeColor(surfaceAt(dark ? 0.22 : 0.16, tintC)),
    terminalScrollbarHover: themeColor(surfaceAt(dark ? 0.3 : 0.22, tintC)),
  }
}

/**
 * Sets one role and re-derives the roles that travel with it (T3 Code's
 * editor behavior): picking `canvas` also sets `chrome`/`toolbar`, picking
 * `accent` re-solves its foreground, and so on.
 */
export function updateThemeColorFamily(
  appearance: ThemeAppearance,
  colors: ThemeColors,
  role: ThemeColorRole,
  value: string,
): ThemeColors {
  const parsedSelected = parseThemeColor(value)
  if (!parsedSelected) return colors
  const normalized = formatOklchThemeColor(parsedSelected.color, parsedSelected.alpha)

  const canvas = parseThemeRgbColor(
    colors.canvas,
    appearance === 'dark' ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 },
  )
  const selected = themeOklchToRgb(parsedSelected.color)
  const selectedOn = (background: ThemeRgb): ThemeRgb =>
    mixThemeRgbColors(background, selected, parsedSelected.alpha)
  const selectedOnCanvas = selectedOn(canvas)
  const accent = parseThemeRgbColor(colors.accent, { r: 168, g: 67, b: 112 })
  const canvasIsDark = isDarkRgb(canvas)
  const terminalIsDark = isDarkRgb(selectedOnCanvas)
  const colorOf = (color: ThemeRgb): string => themeRgbToThemeColor(color)
  const foregroundOn = (background: ThemeRgb): string =>
    colorOf(readableThemeForeground(background))
  const selectedToneOn = (background: ThemeRgb): string =>
    themeOklchToThemeColor(
      solveOklchLightness(
        parsedSelected.color,
        background,
        4.6,
        isDarkRgb(background) ? 'lighter' : 'darker',
      ),
    )
  const statusColors = (): { foreground: string; surface: string } => {
    const surface = mixThemeRgbColors(canvas, selectedOnCanvas, canvasIsDark ? 0.16 : 0.08)
    return { foreground: selectedToneOn(surface), surface: colorOf(surface) }
  }

  switch (role) {
    case 'canvas':
      return { ...colors, canvas: normalized, chrome: normalized, toolbar: normalized }
    case 'text':
      return {
        ...colors,
        text: normalized,
        toolbarForeground: normalized,
        toolbarControlForeground: normalized,
      }
    case 'textMuted':
    case 'mutedForeground':
      return {
        ...colors,
        textMuted: normalized,
        mutedForeground: normalized,
        placeholder: normalized,
        secondaryLabel: normalized,
        iconMuted: normalized,
        sidebarMutedForeground: normalized,
      }
    case 'border':
      return { ...colors, border: normalized, toolbarBorder: normalized, sidebarBorder: normalized }
    case 'secondary':
      return {
        ...colors,
        secondary: normalized,
        secondaryForeground: foregroundOn(selectedOnCanvas),
        muted: normalized,
        toolbarControl: normalized,
      }
    case 'accentSurface':
      return {
        ...colors,
        accentSurface: normalized,
        accentSurfaceForeground: foregroundOn(selectedOnCanvas),
        toolbarControlHover: normalized,
      }
    case 'accent': {
      const updateSurface = mixThemeRgbColors(canvas, selectedOnCanvas, canvasIsDark ? 0.32 : 0.16)
      return {
        ...colors,
        accent: normalized,
        accentForeground: foregroundOn(selectedOnCanvas),
        focus: normalized,
        update: normalized,
        updateForeground: selectedToneOn(updateSurface),
        updateSurface: colorOf(updateSurface),
        terminalCursor: normalized,
      }
    }
    case 'messageAction': {
      const actionForeground = readableThemeForeground(selectedOnCanvas)
      const towardOpposite =
        actionForeground === THEME_LIGHT_FOREGROUND || actionForeground === THEME_WHITE_FOREGROUND
          ? THEME_BLACK_FOREGROUND
          : THEME_WHITE_FOREGROUND
      const actionHover = mixThemeRgbColors(selected, towardOpposite, 0.12)
      return {
        ...colors,
        messageAction: normalized,
        messageActionForeground: colorOf(actionForeground),
        messageActionHover: formatOklchThemeColor(
          themeRgbToOklch(actionHover),
          parsedSelected.alpha,
        ),
      }
    }
    case 'messageSurface':
      return {
        ...colors,
        messageSurface: normalized,
        messageForeground: foregroundOn(selectedOnCanvas),
      }
    case 'searchMatchBackground':
      return {
        ...colors,
        searchMatchBackground: colorOf(selectedOnCanvas),
        searchMatchForeground: foregroundOn(selectedOnCanvas),
      }
    case 'searchMatchActiveBackground':
      return {
        ...colors,
        searchMatchActiveBackground: colorOf(selectedOnCanvas),
        searchMatchActiveForeground: foregroundOn(selectedOnCanvas),
      }
    case 'codeBackground':
      return {
        ...colors,
        codeBackground: normalized,
        codeForeground: foregroundOn(selectedOnCanvas),
      }
    case 'sidebar':
      return { ...colors, sidebar: normalized, sidebarForeground: foregroundOn(selectedOnCanvas) }
    case 'sidebarRowSelected': {
      const sidebar = parseThemeRgbColor(colors.sidebar, canvas)
      const selectedOnSidebar = selectedOn(sidebar)
      return {
        ...colors,
        sidebarRowHover: colorOf(mixThemeRgbColors(sidebar, selectedOnSidebar, 0.5)),
        sidebarRowActive: colorOf(mixThemeRgbColors(sidebar, selectedOnSidebar, 0.8)),
        sidebarRowSelected: normalized,
      }
    }
    case 'terminalBackground': {
      const terminalForeground = readableThemeForeground(selectedOnCanvas)
      return {
        ...colors,
        terminalBackground: normalized,
        terminalForeground: colorOf(terminalForeground),
        terminalSelection: colorOf(
          mixThemeRgbColors(selectedOnCanvas, accent, terminalIsDark ? 0.35 : 0.18),
        ),
        terminalScrollbar: colorOf(
          mixThemeRgbColors(selectedOnCanvas, terminalForeground, terminalIsDark ? 0.42 : 0.22),
        ),
        terminalScrollbarHover: colorOf(
          mixThemeRgbColors(selectedOnCanvas, terminalForeground, terminalIsDark ? 0.55 : 0.32),
        ),
      }
    }
    case 'error': {
      const status = statusColors()
      return {
        ...colors,
        error: normalized,
        errorForeground: status.foreground,
        errorSurface: status.surface,
      }
    }
    case 'warning': {
      const status = statusColors()
      return {
        ...colors,
        warning: normalized,
        warningForeground: status.foreground,
        warningSurface: status.surface,
      }
    }
    default:
      return { ...colors, [role]: normalized }
  }
}

// ---------------------------------------------------------------------------
// Built-in themes.
// ---------------------------------------------------------------------------

/**
 * Minerva's own palette: the dark half is the GitKraken-style palette the app
 * shipped with (deep slate, teal accent); the light half is its daylight
 * counterpart. Unlisted roles come from the vivid generator so every role
 * stays consistent with the hand-picked ones.
 */
function buildMinervaTheme(): ThemeDefinition {
  const dark = createVividThemeColors('dark', '#1a1d23', '#14b8a6')
  const light = createVividThemeColors('light', '#f6f7f9', '#0f766e')
  return canonicalizeThemeDefinition({
    id: MINERVA_THEME_ID,
    label: 'Minerva',
    appearance: 'dark',
    colors: {
      ...dark,
      canvas: '#1a1d23',
      chrome: '#1a1d23',
      toolbar: '#22262e',
      surface: '#22262e',
      surfaceRaised: '#272c35',
      surfaceOverlay: '#22262e',
      sidebar: '#1d2027',
      border: '#353b47',
      toolbarBorder: '#353b47',
      sidebarBorder: '#353b47',
      input: '#3d4452',
      codeBackground: '#15181d',
      codeForeground: '#e2e5ea',
      text: '#e2e5ea',
      toolbarForeground: '#e2e5ea',
      sidebarForeground: '#e2e5ea',
      textMuted: '#8b93a1',
      mutedForeground: '#8b93a1',
      sidebarMutedForeground: '#8b93a1',
      secondaryLabel: '#8b93a1',
      iconMuted: '#8b93a1',
      placeholder: '#8b93a1',
      accent: '#14b8a6',
      focus: '#14b8a6',
      accentForeground: '#1a1d23',
      error: '#ef4444',
      warning: '#eab308',
    },
    variants: {
      light: {
        ...light,
        canvas: '#f6f7f9',
        chrome: '#f6f7f9',
        toolbar: '#ffffff',
        surface: '#ffffff',
        surfaceRaised: '#fbfbfc',
        surfaceOverlay: '#ffffff',
        sidebar: '#f1f3f6',
        border: '#d6dae1',
        toolbarBorder: '#d6dae1',
        sidebarBorder: '#d6dae1',
        input: '#c7ccd5',
        codeBackground: '#f3f5f8',
        codeForeground: '#1f2328',
        text: '#1f2328',
        toolbarForeground: '#1f2328',
        sidebarForeground: '#1f2328',
        textMuted: '#5c6470',
        mutedForeground: '#5c6470',
        sidebarMutedForeground: '#5c6470',
        secondaryLabel: '#5c6470',
        iconMuted: '#5c6470',
        placeholder: '#5c6470',
        accent: '#0f766e',
        focus: '#0f766e',
        accentForeground: '#ffffff',
        error: '#dc2626',
        warning: '#b45309',
      },
    },
  })
}

function buildT3CodeTheme(): ThemeDefinition {
  return {
    id: T3_CODE_THEME_ID,
    label: 'T3 Code',
    appearance: 'light',
    colors: getStandardThemeColors('light'),
    variants: { dark: getStandardThemeColors('dark') },
  }
}

let builtInThemes: ReadonlyArray<ThemeDefinition> | undefined

/** Minerva (the default) first, then T3 Code's standard palette and its five named themes. */
export function getBuiltInThemes(): ReadonlyArray<ThemeDefinition> {
  builtInThemes ??= [
    buildMinervaTheme(),
    buildT3CodeTheme(),
    ...[T3_CHAT_THEME, GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME].map(
      canonicalizeThemeDefinition,
    ),
  ]
  return builtInThemes
}

export function getBuiltInTheme(id: string): ThemeDefinition | null {
  return getBuiltInThemes().find((theme) => theme.id === id) ?? null
}

export function isBuiltInThemeId(id: string): boolean {
  return getBuiltInTheme(id) !== null
}

// ---------------------------------------------------------------------------
// Theme files (JSON import/export, T3 Code compatible).
// ---------------------------------------------------------------------------

function parseThemeColorOverrides(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) throw new ThemeFileError('colorsNotObject')
  const overrides: Partial<Record<ThemeColorRole, string>> = {}
  for (const [role, color] of Object.entries(value)) {
    if (!THEME_COLOR_ROLE_SET.has(role)) throw new ThemeFileError('unknownRole', { role })
    const normalized = toCanonicalThemeColor(color)
    if (!normalized) throw new ThemeFileError('invalidColor', { role })
    overrides[role as ThemeColorRole] = normalized
  }
  if (Object.keys(overrides).length === 0) throw new ThemeFileError('noColors')
  return overrides
}

/** Error codes of `parseThemeFile`; the renderer turns each into a translated message. */
export type ThemeFileErrorCode =
  | 'notObject'
  | 'version'
  | 'name'
  | 'appearance'
  | 'colorsNotObject'
  | 'unknownRole'
  | 'invalidColor'
  | 'noColors'
  | 'id'
  | 'reservedId'
  | 'collection'
  | 'variantsNotObject'
  | 'variantName'
  | 'variantRepeatsBase'
  | 'noEditorBackground'

export class ThemeFileError extends Error {
  constructor(
    readonly code: ThemeFileErrorCode,
    readonly vars: Record<string, string> = {},
  ) {
    super('Invalid theme file: ' + code + (vars.role ? ' (' + vars.role + ')' : ''))
    this.name = 'ThemeFileError'
  }
}

export function parseThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new ThemeFileError('notObject')
  if (value.version !== THEME_FILE_VERSION) throw new ThemeFileError('version')
  const { name, appearance } = value
  if (!isThemeLabel(name)) throw new ThemeFileError('name')
  if (!isThemeAppearance(appearance)) throw new ThemeFileError('appearance')
  if (!isRecord(value.colors)) throw new ThemeFileError('colorsNotObject')

  const id = value.id === undefined ? themeIdFromName(name) : value.id
  if (!isThemeId(id)) throw new ThemeFileError('id')
  if (RESERVED_THEME_IDS.has(id)) throw new ThemeFileError('reservedId', { id })

  const overrides = parseThemeColorOverrides(value.colors)
  const collection = parseThemeCollection(value.collection)
  if (value.collection !== undefined && !collection) throw new ThemeFileError('collection')

  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {}
  if (value.variants !== undefined) {
    if (!isRecord(value.variants)) throw new ThemeFileError('variantsNotObject')
    for (const [variantAppearance, variantColors] of Object.entries(value.variants)) {
      if (!isThemeAppearance(variantAppearance)) throw new ThemeFileError('variantName')
      if (variantAppearance === appearance) throw new ThemeFileError('variantRepeatsBase')
      variants[variantAppearance] = {
        ...decodeThemeColors(getDefaultThemeColors(variantAppearance)),
        ...parseThemeColorOverrides(variantColors),
      }
    }
  }

  return {
    id,
    label: name.trim(),
    appearance,
    colors: { ...decodeThemeColors(getDefaultThemeColors(appearance)), ...overrides },
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
    ...(collection ? { collection } : {}),
  }
}

export function serializeThemeFile(theme: ThemeDefinition): string {
  const canonical = canonicalizeThemeDefinition(theme)
  const file = {
    version: THEME_FILE_VERSION,
    id: canonical.id,
    name: canonical.label,
    appearance: canonical.appearance,
    colors: canonical.colors,
    ...(canonical.variants ? { variants: canonical.variants } : {}),
    ...(canonical.collection ? { collection: canonical.collection } : {}),
  }
  return JSON.stringify(file, null, 2) + '\n'
}

/** A Minerva/T3 Code theme file (as opposed to a VS Code color theme). */
export function isThemeFile(value: unknown): boolean {
  return isRecord(value) && value.version === THEME_FILE_VERSION
}

/** Same hue moved until it reads on `surface` (re-exported for the VS Code importer). */
export { readableThemeColorOn }
