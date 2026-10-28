/**
 * Reglas de layout responsivo (F16) en UN solo lugar: cortes de tier, anchos
 * de la sidebar y clamp del panel didáctico. Vive en `lib/` (no en el hook ni
 * en el store) porque lo consumen los tres: `use-layout-tier.ts` para
 * clasificar, `app-store.ts` al arrastrar el panel y `DidacticPanel` al
 * pintarlo — si el clamp del arrastre y el del render no fueran la MISMA
 * función, el panel "saltaría" al soltar.
 *
 * Los cortes salen del mapa de tiling de `.agents/PLAN.md` § F16: una ventana
 * partida a la mitad de un monitor 1080p mide 960px (tier `md`), un cuarto
 * mide 960x540 (`md`/`xshort`), la mitad horizontal 1920x540 (`xl`/`xshort`).
 */

export type WidthTier = 'xl' | 'lg' | 'md' | 'sm'
export type HeightTier = 'tall' | 'short' | 'xshort'

/** Anchos de corte (px). `md` es "media pantalla de 1080p"; `sm`, una laptop partida. */
export const WIDTH_BREAKPOINTS = { xl: 1360, lg: 1040, md: 760 } as const
export const HEIGHT_BREAKPOINTS = { tall: 700, short: 560 } as const

/** Ancho de la sidebar acoplada por tier; en `md`/`sm` no está acoplada (drawer). */
export const SIDEBAR_WIDTH: Record<WidthTier, number> = { xl: 280, lg: 240, md: 0, sm: 0 }

/** Docked sidebar drag limits (px). The rail it folds to is 56px (`SidebarRail`, `w-14`). */
export const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 480
/** Most of the viewport a dragged sidebar may take. */
const SIDEBAR_MAX_FRACTION = 0.32
export const SIDEBAR_RAIL_WIDTH = 56

/**
 * Ancho mínimo que se le respeta al panel CENTRAL al clampear el didáctico: por
 * debajo de esto el diff vuelve a ser la astilla de 40px que motivó F16.
 */
const MIN_CENTER_WIDTH = 420

/** Fracción máxima del viewport que puede ocupar el didáctico acoplado, por tier. */
const DIDACTIC_MAX_FRACTION: Record<WidthTier, number> = { xl: 0.6, lg: 0.4, md: 0.45, sm: 0.6 }

export const DIDACTIC_PANEL_DEFAULT_WIDTH = 380
export const DIDACTIC_PANEL_MIN_WIDTH = 300

/** Por debajo de este ancho REAL de panel, el split diff deja de ser legible (2x280). */
export const SPLIT_DIFF_MIN_WIDTH = 560
/** Por debajo de este ancho REAL, el árbol de archivos deja de ser columna y pasa a drawer. */
export const FILE_TREE_COLUMN_MIN_WIDTH = 640

export function widthTier(width: number): WidthTier {
  if (width >= WIDTH_BREAKPOINTS.xl) return 'xl'
  if (width >= WIDTH_BREAKPOINTS.lg) return 'lg'
  if (width >= WIDTH_BREAKPOINTS.md) return 'md'
  return 'sm'
}

export function heightTier(height: number): HeightTier {
  if (height >= HEIGHT_BREAKPOINTS.tall) return 'tall'
  if (height >= HEIGHT_BREAKPOINTS.short) return 'short'
  return 'xshort'
}

/** `true` cuando la sidebar se comporta como drawer overlay en vez de columna. */
export function sidebarIsDrawer(tier: WidthTier): boolean {
  return SIDEBAR_WIDTH[tier] === 0
}

/**
 * Ancho efectivo del panel didáctico acoplado: el preferido del usuario,
 * clampeado contra el viewport ACTUAL. El máximo es el menor entre la fracción
 * del tier y "lo que sobra dejándole `MIN_CENTER_WIDTH` al centro" — así el
 * ancho persistido en un monitor grande no se come la ventana al tilearla,
 * pero tampoco se pierde: el valor guardado sigue siendo el preferido y vuelve
 * solo al ensanchar.
 */
export function clampDidacticWidth(
  preferred: number,
  viewportWidth: number,
  sidebarWidth: number = SIDEBAR_WIDTH[widthTier(viewportWidth)],
): number {
  const tier = widthTier(viewportWidth)
  const byFraction = viewportWidth * DIDACTIC_MAX_FRACTION[tier]
  const byCenter = viewportWidth - sidebarWidth - MIN_CENTER_WIDTH
  const max = Math.max(DIDACTIC_PANEL_MIN_WIDTH, Math.round(Math.min(byFraction, byCenter)))
  return Math.min(Math.max(Math.round(preferred), DIDACTIC_PANEL_MIN_WIDTH), max)
}

/** A dragged sidebar width, clamped against the viewport it is painted in. */
export function clampSidebarWidth(preferred: number, viewportWidth: number): number {
  const max = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.round(Math.min(SIDEBAR_MAX_WIDTH, viewportWidth * SIDEBAR_MAX_FRACTION)),
  )
  return Math.min(Math.max(Math.round(preferred), SIDEBAR_MIN_WIDTH), max)
}

/**
 * Width the docked sidebar is painted at: the tier's default until the user
 * drags it (`preferred === null`), then their width clamped against the
 * CURRENT viewport. Like the didactic panel, the stored value is the
 * preference: tiling the window shrinks the column, widening it brings the
 * preference back. 0 on drawer tiers (the sidebar is an overlay there).
 */
export function dockedSidebarWidth(preferred: number | null, viewportWidth: number): number {
  const tier = widthTier(viewportWidth)
  if (sidebarIsDrawer(tier)) return 0
  if (preferred === null) return SIDEBAR_WIDTH[tier]
  return clampSidebarWidth(preferred, viewportWidth)
}

/** Room the left column takes from the center: the rail when folded, 0 as a drawer. */
export function sidebarFootprint(
  preferred: number | null,
  collapsed: boolean,
  viewportWidth: number,
): number {
  if (sidebarIsDrawer(widthTier(viewportWidth))) return 0
  return collapsed ? SIDEBAR_RAIL_WIDTH : dockedSidebarWidth(preferred, viewportWidth)
}

/** Preferred width (px) of each narrow-tier drawer, before `drawerWidth` clamps it. */
export const DRAWER_WIDTH = { sidebar: 300, files: 260, didactic: 360 } as const
/** Most of its container a drawer may cover: the scrim beside it stays a visible way out. */
const DRAWER_MAX_FRACTION = 0.85

/**
 * Width a drawer is painted at: its preferred width, never more than 85% of
 * the container it slides over (the window row for the PR list and the AI
 * panel, the Files tab for the file column). `null` = not measured yet.
 */
export function drawerWidth(preferred: number, containerWidth: number | null): number {
  if (containerWidth === null) return preferred
  return Math.max(0, Math.min(preferred, Math.round(containerWidth * DRAWER_MAX_FRACTION)))
}
