/**
 * VS Code color theme JSON -> Minerva/T3 Code theme.
 *
 * Ported from T3 Code (`apps/web/src/vscodeThemeImport.ts`,
 * https://github.com/pingdotgg/t3code), MIT License, Copyright (c) 2026 T3
 * Tools Inc. See THIRD_PARTY_NOTICES.md. Only workbench `colors` are read
 * (`tokenColors` are ignored: syntax highlighting keeps its own light/dark
 * Shiki themes). Every color goes through the strict parser in `./color` and
 * the result through `parseThemeFile`, so a hostile theme can only produce a
 * palette of valid colors.
 */
import { parseThemeColor, themeColorToHex, themeOklchToRgb, themeRgbToHex } from './color'
import {
  createVividThemeColors,
  getStandardThemeColors,
  getThemeModes,
  parseThemeFile,
  readableThemeColorOn,
  RESERVED_THEME_IDS,
  THEME_FILE_VERSION,
  ThemeFileError,
  themeIdFromName,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeDefinition,
} from './themes'

/**
 * The workbench keys the importer reads. Anything else in a theme file is
 * dropped before conversion (and by main before an Open VSX theme crosses IPC).
 */
export const USED_WORKBENCH_COLORS: ReadonlySet<string> = new Set([
  'activityBar.background',
  'activityBarBadge.background',
  'badge.background',
  'button.background',
  'button.foreground',
  'contrastBorder',
  'descriptionForeground',
  'disabledForeground',
  'dropdown.background',
  'dropdown.border',
  'editor.background',
  'editor.foreground',
  'editor.findMatchBackground',
  'editor.findMatchForeground',
  'editor.findMatchHighlightBackground',
  'editor.findMatchHighlightForeground',
  'editor.selectionBackground',
  'editorCursor.foreground',
  'editorError.foreground',
  'editorGroup.border',
  'editorPane.background',
  'editorWarning.foreground',
  'editorWidget.background',
  'errorForeground',
  'focusBorder',
  'foreground',
  'input.border',
  'input.placeholderForeground',
  'list.activeSelectionBackground',
  'list.hoverBackground',
  'list.inactiveSelectionBackground',
  'menu.background',
  'panel.background',
  'panel.border',
  'progressBar.background',
  'quickInput.background',
  'scrollbarSlider.background',
  'sideBar.background',
  'sideBar.border',
  'sideBar.foreground',
  'terminal.background',
  'terminal.foreground',
  'terminal.selectionBackground',
  'terminalCursor.foreground',
  'textCodeBlock.background',
  'textLink.foreground',
])

const MAX_VSCODE_COLOR_LENGTH = 128

/** Keeps only the workbench colors the importer reads (strings of sane length). */
export function sanitizeVsCodeColors(value: unknown): Record<string, string> {
  const colors: Record<string, string> = {}
  if (!isRecord(value)) return colors
  for (const [key, color] of Object.entries(value)) {
    if (
      USED_WORKBENCH_COLORS.has(key) &&
      typeof color === 'string' &&
      color.length <= MAX_VSCODE_COLOR_LENGTH
    ) {
      colors[key] = color
    }
  }
  return colors
}

type VsCodeRgba = { r: number; g: number; b: number; a: number }
type VsCodeRgb = { r: number; g: number; b: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Hex exactly (the common case); anything else through the strict shared parser. */
function parseVsCodeColor(value: unknown): VsCodeRgba | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed)?.[1]
  if (hex) {
    const expand = (part: string): number =>
      part.length === 1 ? Number.parseInt(part + part, 16) : Number.parseInt(part, 16)
    if (hex.length <= 4) {
      return {
        r: expand(hex[0]),
        g: expand(hex[1]),
        b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      }
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    }
  }
  const parsed = parseThemeColor(trimmed)
  return parsed ? { ...themeOklchToRgb(parsed.color), a: parsed.alpha } : null
}

function toHex(color: VsCodeRgb): string {
  return themeRgbToHex(color)
}

// Composite VS Code translucent overlays onto their surfaces; our roles are opaque.
function flattenOver(color: VsCodeRgba, base: VsCodeRgb): string {
  if (color.a >= 1) return toHex(color)
  return toHex({
    r: color.r * color.a + base.r * (1 - color.a),
    g: color.g * color.a + base.g * (1 - color.a),
    b: color.b * color.a + base.b * (1 - color.a),
  })
}

function relativeLuminance(color: VsCodeRgb): number {
  const channel = (value: number) => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrastRatio(first: VsCodeRgb, second: VsCodeRgb): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function hexToRgb(value: string): VsCodeRgb {
  return parseVsCodeColor(themeColorToHex(value) ?? value) ?? { r: 0, g: 0, b: 0, a: 1 }
}

export function isVsCodeThemeFile(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.version === THEME_FILE_VERSION) return false
  const hasWorkbenchColors =
    isRecord(value.colors) && Object.keys(value.colors).some((key) => key.includes('.'))
  return hasWorkbenchColors || Array.isArray(value.tokenColors)
}

function resolveAppearance(value: Record<string, unknown>, canvas: VsCodeRgb): ThemeAppearance {
  const type = typeof value.type === 'string' ? value.type.toLowerCase() : null
  if (type === 'light' || type === 'hc-light') return 'light'
  if (type === 'dark' || type === 'hc-black') return 'dark'
  return relativeLuminance(canvas) < 0.179 ? 'dark' : 'light'
}

export function humanizeThemeName(raw: string): string {
  const trimmed = raw.trim()
  if (/\s/.test(trimmed) || !/[-_.]/.test(trimmed)) return trimmed
  return trimmed
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function resolveName(value: Record<string, unknown>): string {
  for (const candidate of [value.displayName, value.name]) {
    if (typeof candidate !== 'string') continue
    const humanized = humanizeThemeName(candidate)
    if (humanized.length > 0) return humanized.slice(0, 48)
  }
  return 'VS Code theme'
}

export function parseVsCodeThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new ThemeFileError('notObject')
  const colors = sanitizeVsCodeColors(value.colors)

  const pick = (...keys: ReadonlyArray<string>): VsCodeRgba | null => {
    for (const key of keys) {
      const parsed = parseVsCodeColor(colors[key])
      if (parsed) return parsed
    }
    return null
  }
  const solidOver = (base: VsCodeRgb, ...keys: ReadonlyArray<string>): string | null => {
    const parsed = pick(...keys)
    return parsed ? flattenOver(parsed, base) : null
  }

  const canvasColor = pick('editor.background', 'editorPane.background')
  if (!canvasColor) {
    throw new ThemeFileError('noEditorBackground')
  }
  const canvas = { r: canvasColor.r, g: canvasColor.g, b: canvasColor.b }
  const appearance = resolveAppearance(value, canvas)

  const canvasHex = toHex(canvas)
  const raisedSurfaceCandidateHex = solidOver(
    canvas,
    'editorWidget.background',
    'dropdown.background',
  )

  const standsApart = (first: string, second: string) =>
    contrastRatio(hexToRgb(first), hexToRgb(second)) >= 1.1

  let accentColor: VsCodeRgba | null = null
  let accentHex: string | null = null
  for (const key of [
    'focusBorder',
    'button.background',
    'textLink.foreground',
    'activityBarBadge.background',
    'progressBar.background',
    'badge.background',
  ]) {
    const candidate = parseVsCodeColor(colors[key])
    if (!candidate) continue
    const candidateHex = flattenOver(candidate, canvas)
    if (
      !standsApart(candidateHex, canvasHex) ||
      (raisedSurfaceCandidateHex !== null && !standsApart(candidateHex, raisedSurfaceCandidateHex))
    )
      continue
    accentColor = candidate
    accentHex = candidateHex
    break
  }
  if (!accentColor || !accentHex) {
    const standardAccentHex = themeColorToHex(getStandardThemeColors(appearance).accent) as string
    accentHex =
      [standardAccentHex, '#ffffff', '#000000'].find(
        (candidate) =>
          standsApart(candidate, canvasHex) &&
          (raisedSurfaceCandidateHex === null || standsApart(candidate, raisedSurfaceCandidateHex)),
      ) ?? standardAccentHex
    accentColor = parseVsCodeColor(accentHex) as VsCodeRgba
  }

  const mutedAccentHex = flattenOver(
    { r: accentColor.r, g: accentColor.g, b: accentColor.b, a: 0.2 },
    canvas,
  )
  const derived = createVividThemeColors(appearance, canvasHex, mutedAccentHex)
  const sidebarHex =
    solidOver(canvas, 'sideBar.background', 'activityBar.background') ?? derived.sidebar
  const sidebar = hexToRgb(sidebarHex)
  const terminalHex =
    solidOver(canvas, 'terminal.background', 'panel.background') ?? derived.terminalBackground
  const terminal = hexToRgb(terminalHex)

  const readableOn = (
    surface: string,
    fallback: string,
    ...keys: ReadonlyArray<string>
  ): string => {
    const surfaceRgb = hexToRgb(surface)
    const isReadable = (candidate: string) => contrastRatio(hexToRgb(candidate), surfaceRgb) >= 4.5
    const specified = solidOver(surfaceRgb, ...keys)
    if (specified && isReadable(specified)) return specified
    if (isReadable(fallback)) return fallback
    return relativeLuminance(surfaceRgb) < 0.179 ? '#ffffff' : '#000000'
  }
  // Status colors also fill controls such as destructive buttons, which carry
  // white text, so a dim one is lightened along its hue rather than replaced
  // by readableOn's black or white. One hidden in the canvas has no hue to
  // keep, so the derived color stands in.
  const readableStatusColor = (fallback: string, ...keys: ReadonlyArray<string>): string => {
    const specified = solidOver(canvas, ...keys)
    const base = specified && standsApart(specified, canvasHex) ? specified : fallback
    return readableThemeColorOn(base, canvasHex, 4.5)
  }

  const surfaceRaisedHex = raisedSurfaceCandidateHex ?? derived.surfaceRaised
  // Checked tracks use messageAction; resolve it before the unchecked input role.
  const buttonHex = solidOver(canvas, 'button.background')
  const actionHex =
    buttonHex && standsApart(buttonHex, canvasHex) && standsApart(buttonHex, surfaceRaisedHex)
      ? buttonHex
      : accentHex
  const inputCandidates = [
    derived.input,
    derived.surfaceRaised,
    getStandardThemeColors(appearance).input,
    '#000000',
    '#ffffff',
    '#808080',
  ]
  let inputHex =
    inputCandidates.find(
      (candidate) => standsApart(candidate, canvasHex) && standsApart(candidate, actionHex),
    ) ?? '#808080'
  for (const key of ['input.background', 'input.border']) {
    const candidate = solidOver(canvas, key)
    if (candidate && standsApart(candidate, canvasHex) && standsApart(candidate, actionHex)) {
      inputHex = candidate
      break
    }
  }
  const searchMatchBackground =
    solidOver(canvas, 'editor.findMatchHighlightBackground') ?? derived.searchMatchBackground
  const searchMatchActiveBackground =
    solidOver(canvas, 'editor.findMatchBackground') ?? derived.searchMatchActiveBackground

  const overrides: Partial<Record<ThemeColorRole, string>> = {
    canvas: canvasHex,
    text: readableOn(canvasHex, derived.text, 'editor.foreground', 'foreground'),
    textMuted: readableOn(
      canvasHex,
      derived.textMuted,
      'descriptionForeground',
      'disabledForeground',
    ),
    surface: solidOver(canvas, 'editorWidget.background') ?? derived.surface,
    surfaceRaised: surfaceRaisedHex,
    surfaceOverlay:
      solidOver(canvas, 'menu.background', 'quickInput.background', 'dropdown.background') ??
      derived.surfaceOverlay,
    border:
      solidOver(canvas, 'panel.border', 'editorGroup.border', 'contrastBorder') ?? derived.border,
    input: inputHex,
    placeholder: readableOn(surfaceRaisedHex, derived.placeholder, 'input.placeholderForeground'),
    error: readableStatusColor(derived.error, 'editorError.foreground', 'errorForeground'),
    warning: readableStatusColor(derived.warning, 'editorWarning.foreground'),
    accentSurface:
      solidOver(canvas, 'list.activeSelectionBackground', 'list.hoverBackground') ??
      derived.accentSurface,
    codeBackground: solidOver(canvas, 'textCodeBlock.background') ?? derived.codeBackground,
    searchMatchBackground,
    searchMatchForeground: readableOn(
      searchMatchBackground,
      derived.searchMatchForeground,
      'editor.findMatchHighlightForeground',
      'editor.foreground',
      'foreground',
    ),
    searchMatchActiveBackground,
    searchMatchActiveForeground: readableOn(
      searchMatchActiveBackground,
      derived.searchMatchActiveForeground,
      'editor.findMatchForeground',
      'editor.foreground',
      'foreground',
    ),
    sidebar: sidebarHex,
    sidebarForeground: readableOn(sidebarHex, derived.sidebarForeground, 'sideBar.foreground'),
    sidebarBorder: solidOver(sidebar, 'sideBar.border') ?? derived.sidebarBorder,
    sidebarRowHover: solidOver(sidebar, 'list.hoverBackground') ?? derived.sidebarRowHover,
    sidebarRowActive:
      solidOver(sidebar, 'list.inactiveSelectionBackground', 'list.hoverBackground') ??
      derived.sidebarRowActive,
    sidebarRowSelected:
      solidOver(sidebar, 'list.activeSelectionBackground') ?? derived.sidebarRowSelected,
    terminalBackground: terminalHex,
    terminalForeground: readableOn(terminalHex, derived.terminalForeground, 'terminal.foreground'),
    terminalCursor:
      solidOver(terminal, 'terminalCursor.foreground', 'editorCursor.foreground') ??
      derived.terminalCursor,
    terminalSelection:
      solidOver(terminal, 'terminal.selectionBackground', 'editor.selectionBackground') ??
      derived.terminalSelection,
    terminalScrollbar:
      solidOver(terminal, 'scrollbarSlider.background') ?? derived.terminalScrollbar,
  }
  overrides.accent = accentHex
  overrides.focus = accentHex
  overrides.messageAction = actionHex
  overrides.messageActionForeground = readableOn(
    actionHex,
    derived.messageActionForeground,
    'button.foreground',
  )
  overrides.accentForeground = readableOn(accentHex, derived.accentForeground, 'button.foreground')

  const name = resolveName(value)
  const generatedId = themeIdFromName(name)
  return parseThemeFile({
    version: THEME_FILE_VERSION,
    ...(RESERVED_THEME_IDS.has(generatedId) ? { id: generatedId + '-vscode' } : {}),
    name,
    appearance,
    colors: { ...derived, ...overrides },
  })
}

export function pairVsCodeThemes(
  themes: ReadonlyArray<ThemeDefinition>,
  options?: {
    pairedId?: (light: ThemeDefinition, dark: ThemeDefinition) => string
  },
): ReadonlyArray<ThemeDefinition> {
  const stripAppearance = (label: string) =>
    label
      .replace(/\b(?:light|dark)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  type Group = { light: ThemeDefinition[]; dark: ThemeDefinition[]; order: number }
  const groups = new Map<string, Group>()
  const passthrough: Array<{ theme: ThemeDefinition; order: number }> = []
  themes.forEach((theme, order) => {
    const key = stripAppearance(theme.label)
    if (getThemeModes(theme).length !== 1 || key === theme.label || !/[a-z0-9]/i.test(key)) {
      passthrough.push({ theme, order })
      return
    }
    const group = groups.get(key) ?? { light: [], dark: [], order }
    group[theme.appearance].push(theme)
    groups.set(key, group)
  })

  const paired: Array<{ theme: ThemeDefinition; order: number }> = []
  for (const [key, group] of groups) {
    if (group.light.length === 1 && group.dark.length === 1) {
      try {
        paired.push({
          order: group.order,
          theme: parseThemeFile({
            version: THEME_FILE_VERSION,
            ...(options?.pairedId ? { id: options.pairedId(group.light[0], group.dark[0]) } : {}),
            name: key,
            appearance: 'light',
            colors: group.light[0].colors,
            variants: { dark: group.dark[0].colors },
          }),
        })
        continue
      } catch {
        // Falls through to keep the two halves as separate themes.
      }
    }
    for (const theme of [...group.light, ...group.dark]) {
      paired.push({ theme, order: group.order })
    }
  }

  return [...passthrough, ...paired].sort((a, b) => a.order - b.order).map((entry) => entry.theme)
}

export function resolveThemeLabelCollisions(
  entries: ReadonlyArray<{ theme: ThemeDefinition; sourceName?: string | undefined }>,
): ReadonlyArray<ThemeDefinition> {
  const rename = (theme: ThemeDefinition, name: string): ThemeDefinition | null => {
    try {
      return parseThemeFile({
        version: THEME_FILE_VERSION,
        name: name.slice(0, 48),
        appearance: theme.appearance,
        colors: theme.colors,
        ...(theme.variants ? { variants: theme.variants } : {}),
      })
    } catch {
      return null
    }
  }

  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.theme.id, (counts.get(entry.theme.id) ?? 0) + 1)
  }
  const relabelled = entries.map(({ theme, sourceName }) => {
    if ((counts.get(theme.id) ?? 0) < 2) return theme
    const stem = sourceName?.replace(/\.[^.]+$/, '')
    const fromFile = stem ? humanizeThemeName(stem) : null
    const renamed =
      fromFile && fromFile.toLowerCase() !== theme.label.toLowerCase()
        ? rename(theme, fromFile)
        : null
    return renamed ?? theme
  })

  const seen = new Set<string>()
  return relabelled.map((theme) => {
    if (!seen.has(theme.id)) {
      seen.add(theme.id)
      return theme
    }
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = rename(theme, theme.label + ' ' + suffix)
      if (candidate && !seen.has(candidate.id)) {
        seen.add(candidate.id)
        return candidate
      }
    }
    return theme
  })
}
