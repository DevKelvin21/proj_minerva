/**
 * Open VSX package (as main returns it) -> Minerva themes. Same steps as the
 * end of T3 Code's `importOpenVsxThemeExtension` (MIT, see
 * THIRD_PARTY_NOTICES.md): convert each contributed theme, give it a stable
 * id from the extension and file path, pair "X Light"/"X Dark" into one
 * theme with both halves, and tag every result with the extension as its
 * collection (so reinstalling replaces instead of duplicating).
 */
import { openVsxCollectionId, openVsxThemeId, type OpenVsxThemePackage } from './open-vsx'
import { ThemeFileError, type ThemeDefinition } from './themes'
import {
  pairVsCodeThemes,
  parseVsCodeThemeFile,
  resolveThemeLabelCollisions,
} from './vscode-import'

export function themesFromOpenVsxPackage(pkg: OpenVsxThemePackage): ThemeDefinition[] {
  const extensionId = pkg.extension.id.toLowerCase()
  const parsed: Array<{ theme: ThemeDefinition; sourceName: string; sourcePath: string }> = []
  for (const source of pkg.themes) {
    try {
      const theme = parseVsCodeThemeFile({
        displayName: source.label,
        ...(source.type ? { type: source.type } : {}),
        colors: source.colors,
      })
      parsed.push({
        theme,
        sourceName: source.path.split('/').at(-1) ?? source.path,
        sourcePath: source.path,
      })
    } catch {
      // A theme without an editor background is skipped; the others still import.
    }
  }
  if (parsed.length === 0) throw new ThemeFileError('noEditorBackground')

  const occurrences = new Map<string, number>()
  const resolved = resolveThemeLabelCollisions(parsed).map((theme, index) => {
    const path = parsed[index].sourcePath
    const seen = occurrences.get(path) ?? 0
    occurrences.set(path, seen + 1)
    return { ...theme, id: openVsxThemeId(extensionId, seen === 0 ? path : path + '#' + seen) }
  })
  const paired = pairVsCodeThemes(resolved, {
    pairedId: (light, dark) => openVsxThemeId(extensionId, [light.id, dark.id].sort().join(':')),
  })
  const collection = {
    id: openVsxCollectionId(extensionId),
    label: pkg.extension.displayName.slice(0, 48),
  }
  return resolveThemeLabelCollisions(paired.map((theme) => ({ theme }))).map((theme, index) => ({
    ...theme,
    // Label collisions rename (and re-id) a theme; keep the stable id.
    id: paired[index].id,
    collection,
  }))
}
