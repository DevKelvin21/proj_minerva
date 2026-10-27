import type { CSSProperties } from 'react'
import {
  parseThemeColor,
  readableThemeForeground,
  themeOklchToRgb,
  themeRgbToHex,
} from '../../../shared/theme/color'

/**
 * Background + readable text for a PR label colored by the SCM (`RRGGBB`
 * without `#`, untrusted): near-black or near-white text, whichever reads
 * better on that color in any theme. `null` when the value is not a color.
 */
export function labelStyle(color: string | null | undefined): CSSProperties | null {
  if (!color || !/^[0-9a-f]{6}$/i.test(color)) return null
  const parsed = parseThemeColor('#' + color)
  if (!parsed) return null
  return {
    backgroundColor: '#' + color,
    color: themeRgbToHex(readableThemeForeground(themeOklchToRgb(parsed.color))),
  }
}
