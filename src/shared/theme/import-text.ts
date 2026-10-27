/**
 * Pasted or picked theme text -> theme: a Minerva/T3 Code theme file
 * (`version: 1`) or a VS Code color theme, JSON with comments allowed.
 * Throws `SyntaxError` (not JSON) or `ThemeFileError` (not a usable theme).
 */
import { parseJsonc } from './jsonc'
import { isThemeFile, parseThemeFile, ThemeFileError, type ThemeDefinition } from './themes'
import { isVsCodeThemeFile, parseVsCodeThemeFile } from './vscode-import'

export function parseThemeText(text: string): ThemeDefinition {
  const value = parseJsonc(text)
  if (isThemeFile(value)) return parseThemeFile(value)
  if (isVsCodeThemeFile(value)) return parseVsCodeThemeFile(value)
  throw new ThemeFileError('notObject')
}
