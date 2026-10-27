/**
 * Open VSX theme search/install contract (types shared by main, preload and
 * the renderer). Main does every network request and opens the .vsix; the
 * renderer only ever receives the parsed metadata below and the workbench
 * colors of each theme (already filtered to the keys the importer reads),
 * which it converts with `./vscode-import.ts`.
 */
import type { ThemeAppearance } from './palettes'

export const OPEN_VSX_SORTS = ['relevance', 'downloadCount', 'rating', 'timestamp'] as const
export type OpenVsxSort = (typeof OPEN_VSX_SORTS)[number]

export const MAX_OPEN_VSX_QUERY_LENGTH = 100

/** `namespace` / `name` as Open VSX allows them (also what the IPC validator accepts). */
export function isOpenVsxIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
}

export interface OpenVsxExtension {
  /** `namespace.name` */
  id: string
  namespace: string
  name: string
  displayName: string
  description: string
  version: string
  /** SPDX id; only permissive licenses are offered (see main's list). */
  license: string
  downloadCount: number
  /** Icon served by Open VSX (https, open-vsx.org only), or `null`. */
  iconUrl: string | null
}

/** One color theme contributed by an extension, as main read it from the package. */
export interface OpenVsxThemeSource {
  /** `contributes.themes[].label`, or the extension name. */
  label: string
  /** From `uiTheme` (`vs` light, `vs-dark` dark, high contrast mapped to its base), `null` = guess. */
  type: ThemeAppearance | 'hc-light' | 'hc-black' | null
  /** Package-relative path of the theme file (stable id input). */
  path: string
  /** Workbench colors, only the keys the importer reads. */
  colors: Record<string, string>
}

export interface OpenVsxThemePackage {
  extension: OpenVsxExtension
  themes: OpenVsxThemeSource[]
}

/** Stable short id piece (FNV-1a, 2 x 32 bits): deterministic theme ids for an extension's themes. */
export function shortHash(value: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12)
}

export function openVsxCollectionId(extensionId: string): string {
  const normalized = 'open-vsx:' + extensionId.toLowerCase()
  return /^[a-z0-9][a-z0-9.:-]{0,127}$/.test(normalized)
    ? normalized
    : 'open-vsx:' + shortHash(extensionId)
}

export function openVsxThemeId(extensionId: string, source: string): string {
  return 'ovx-' + shortHash(extensionId.toLowerCase() + ':' + source)
}
