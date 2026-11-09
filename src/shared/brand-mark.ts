/**
 * Minerva's brand mark, the "merge owl": an owl head whose eyes are two
 * commits on branches that merge into the beak. One definition feeds the
 * in-app mark (`renderer/src/components/ui/BrandMark.tsx`) and the app icons
 * (`scripts/build-app-icons.mjs` writes `build/icon.svg` and the .icns, .ico
 * and PNGs from `appIconSvg`), so the two never drift apart. The same script
 * renders the macOS menu bar icon from `trayIconSvg` (`build/tray.svg`,
 * `resources/tray/minervaTemplate*.png`).
 *
 * Geometry is on Lucide's 24-unit grid with round caps and joins, so the
 * mark sits next to the UI icons in the same line.
 */

export type BrandMarkShape =
  | { kind: 'path'; d: string }
  /** `filled`: a solid dot (the beak) rather than a ring. */
  | { kind: 'circle'; cx: number; cy: number; r: number; filled?: boolean }

export const BRAND_MARK_SHAPES: readonly BrandMarkShape[] = [
  // Facial disc: ear tufts at the corners and the owl's V-shaped brow between them.
  {
    kind: 'path',
    d: 'M4.5 3.5C3.4 7.2 3.2 10 3.6 12.6 4.3 17.5 7.8 20.8 12 20.8S19.7 17.5 20.4 12.6C20.8 10 20.6 7.2 19.5 3.5 17 4.6 14 5.8 12 8 10 5.8 7 4.6 4.5 3.5Z',
  },
  // Eyes: the two commits.
  { kind: 'circle', cx: 8.6, cy: 11.7, r: 2.5 },
  { kind: 'circle', cx: 15.4, cy: 11.7, r: 2.5 },
  // Their branches, merging.
  { kind: 'path', d: 'M8.6 14.2c0 1.6 3.4 1.5 3.4 3M15.4 14.2c0 1.6-3.4 1.5-3.4 3' },
  // Beak: the merge commit.
  { kind: 'circle', cx: 12, cy: 18, r: 1.25, filled: true },
]

/** Line width of the in-app mark (Lucide units), as the UI icons' 1.25 px reads at 16 px. */
export const BRAND_MARK_STROKE = 1.6

/** The app-icon palette: Minerva teal on the Minerva dark canvas, in sRGB hex for every icon renderer. */
export const APP_ICON_COLORS = {
  /** Minerva dark accent, oklch(0.703753 0.123018 182.503). */
  mark: '#14b8a6',
  /** Tile gradient, top to bottom (the dark canvas, lifted and deepened). */
  tileTop: '#303540',
  tileBottom: '#13161c',
} as const

/** One shape as SVG; the filled beak takes `fill` (the line color comes from the group). */
function shapeMarkup(shape: BrandMarkShape, fill: string): string {
  return shape.kind === 'path'
    ? '<path d="' + shape.d + '"/>'
    : '<circle cx="' +
        shape.cx +
        '" cy="' +
        shape.cy +
        '" r="' +
        shape.r +
        '"' +
        (shape.filled ? ' fill="' + fill + '" stroke="none"' : '') +
        '/>'
}

/**
 * Line width of the mark on the app icon for a rendered size: heavier as the
 * icon shrinks, so the owl still reads in a 16 px Finder list.
 */
export function appIconStroke(pixels: number): number {
  if (pixels >= 128) return 1.25
  if (pixels >= 64) return 1.45
  if (pixels >= 32) return 1.8
  return 2.2
}

/**
 * The app icon as a 1024-unit SVG. `inset` is the tile's margin: macOS draws
 * icons on Apple's grid (an 824 tile inside 1024, so it lines up with other
 * apps in the Dock), Windows and Linux fill more of the square.
 */
export function appIconSvg(options: { inset: number; stroke: number }): string {
  const { inset, stroke } = options
  const tile = 1024 - inset * 2
  const radius = Math.round(tile * 0.225)
  const markSize = tile * 0.64
  const markOffset = inset + (tile - markSize) / 2
  const scale = markSize / 24
  const c = APP_ICON_COLORS
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">' +
    '<defs>' +
    '<linearGradient id="tile" x1="0.33" y1="0" x2="0.67" y2="1">' +
    '<stop offset="0" stop-color="' +
    c.tileTop +
    '"/>' +
    '<stop offset="1" stop-color="' +
    c.tileBottom +
    '"/>' +
    '</linearGradient>' +
    '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>' +
    '<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.03"/>' +
    '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>' +
    '</linearGradient>' +
    '<radialGradient id="glow" cx="0.5" cy="0.62" r="0.5">' +
    '<stop offset="0" stop-color="' +
    c.mark +
    '" stop-opacity="0.18"/>' +
    '<stop offset="1" stop-color="' +
    c.mark +
    '" stop-opacity="0"/>' +
    '</radialGradient>' +
    '</defs>' +
    '<rect x="' +
    inset +
    '" y="' +
    inset +
    '" width="' +
    tile +
    '" height="' +
    tile +
    '" rx="' +
    radius +
    '" fill="url(#tile)"/>' +
    '<rect x="' +
    inset +
    '" y="' +
    inset +
    '" width="' +
    tile +
    '" height="' +
    tile +
    '" rx="' +
    radius +
    '" fill="url(#glow)"/>' +
    '<rect x="' +
    (inset + 2) +
    '" y="' +
    (inset + 2) +
    '" width="' +
    (tile - 4) +
    '" height="' +
    (tile - 4) +
    '" rx="' +
    (radius - 2) +
    '" fill="none" stroke="url(#rim)" stroke-width="4"/>' +
    '<g transform="translate(' +
    markOffset +
    ' ' +
    markOffset +
    ') scale(' +
    scale +
    ')" fill="none" stroke="' +
    c.mark +
    '" stroke-width="' +
    stroke +
    '" stroke-linecap="round" stroke-linejoin="round">' +
    BRAND_MARK_SHAPES.map((shape) => shapeMarkup(shape, c.mark)).join('') +
    '</g>' +
    '</svg>'
  )
}

/**
 * Line width of the menu bar icon (Lucide units): it is shown at 16 pt, where
 * the in-app 1.6 looks thin next to the system's own menu bar glyphs.
 */
export const TRAY_ICON_STROKE = 1.8

/**
 * The macOS menu bar icon: the bare mark on its 24-unit grid, no tile, all
 * black. It becomes a template image (`minervaTemplate.png`), so macOS
 * recolors it for light and dark menu bars and the highlighted state; only
 * its alpha counts.
 */
export function trayIconSvg(options: { stroke: number }): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="' +
    options.stroke +
    '" stroke-linecap="round" stroke-linejoin="round">' +
    BRAND_MARK_SHAPES.map((shape) => shapeMarkup(shape, '#000000')).join('') +
    '</svg>'
  )
}

/** Margins of the two icon layouts (1024 units). */
export const APP_ICON_INSET = { mac: 100, square: 40 } as const
