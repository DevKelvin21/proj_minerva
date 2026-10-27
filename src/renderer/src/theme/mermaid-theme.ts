/**
 * Mermaid config for the active palette. Mermaid only understands hex/rgb
 * colors (it derives shades with khroma), so each role is converted from its
 * canonical OKLCH form. The `base` theme takes these variables as-is; the
 * diagram re-renders whenever the palette changes (`MermaidDiagram`).
 */
import type { MermaidConfig } from 'mermaid'
import { themeColorToHex } from '../../../shared/theme/color'
import type { ThemeAppearance, ThemeColors } from '../../../shared/theme/themes'

function hex(value: string, fallback: string): string {
  return (themeColorToHex(value) ?? fallback).slice(0, 7)
}

export function mermaidThemeConfig(
  appearance: ThemeAppearance,
  colors: ThemeColors,
): Pick<MermaidConfig, 'theme' | 'themeVariables'> {
  const dark = appearance === 'dark'
  const canvas = hex(colors.canvas, dark ? '#1a1d23' : '#ffffff')
  const surface = hex(colors.surface, canvas)
  const raised = hex(colors.surfaceRaised, surface)
  const text = hex(colors.text, dark ? '#e2e5ea' : '#1f2328')
  const muted = hex(colors.textMuted, text)
  const border = hex(colors.border, muted)
  const accent = hex(colors.accent, muted)
  return {
    theme: 'base',
    themeVariables: {
      darkMode: dark,
      background: canvas,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      primaryColor: raised,
      primaryTextColor: text,
      primaryBorderColor: muted,
      secondaryColor: surface,
      secondaryTextColor: text,
      secondaryBorderColor: border,
      tertiaryColor: hex(colors.codeBackground, surface),
      tertiaryTextColor: text,
      tertiaryBorderColor: border,
      mainBkg: raised,
      nodeBorder: muted,
      nodeTextColor: text,
      textColor: text,
      titleColor: text,
      lineColor: muted,
      clusterBkg: surface,
      clusterBorder: border,
      edgeLabelBackground: canvas,
      labelBackground: canvas,
      noteBkgColor: hex(colors.accentSurface, surface),
      noteTextColor: text,
      noteBorderColor: accent,
      attributeBackgroundColorOdd: surface,
      attributeBackgroundColorEven: raised,
    },
  }
}

export interface MermaidInk {
  text: string
  line: string
}

/** Text and line colors of a config (for the SVG fixes in `MermaidDiagram`). */
export function mermaidInk(config: Pick<MermaidConfig, 'themeVariables'>): MermaidInk {
  const vars = (config.themeVariables ?? {}) as Record<string, string>
  return { text: vars.textColor ?? '#444444', line: vars.lineColor ?? '#444444' }
}
