/**
 * Theme previews for the Appearance settings: the blurred "orb" that stands
 * for one variant of a theme, and a wireframe of Minerva's layout painted
 * with a palette (used by the System/Light/Dark tiles).
 *
 * The orb is ported from T3 Code (`ThemePreviewCircles.tsx` and
 * `packages/shared/src/themePreview.ts`, https://github.com/pingdotgg/t3code),
 * MIT License, Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.
 * The wireframe is Minerva's own layout (PR list, diff, didactic panel).
 * Every color here comes from a validated theme (canonical OKLCH strings).
 */
import type { CSSProperties } from 'react'
import { extraColorFor } from '../../../../../shared/theme/appearance'
import type { ThemeAppearance, ThemeColors } from '../../../../../shared/theme/themes'

const ORB_SPECS = {
  light: {
    baseTarget: '#ffffff',
    accentCenter: '72% 22%',
    actionCenter: '18% 82%',
    middleOpacity: 72,
  },
  dark: {
    baseTarget: '#09090b',
    accentCenter: '28% 78%',
    actionCenter: '82% 18%',
    middleOpacity: 62,
  },
} as const

const ORB_EDGE = {
  dark: 'inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)',
  light: 'inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)',
} as const

function orbStyle(colors: ThemeColors, mode: ThemeAppearance): CSSProperties {
  const spec = ORB_SPECS[mode]
  return {
    backgroundColor: 'color-mix(in oklab, ' + colors.canvas + ' 80%, ' + spec.baseTarget + ')',
    backgroundImage: [
      'radial-gradient(circle at ' +
        spec.accentCenter +
        ' in oklab, ' +
        colors.accent +
        ' 0%, color-mix(in oklab, ' +
        colors.accent +
        ' ' +
        spec.middleOpacity +
        '%, transparent) 28%, transparent 58%)',
      'radial-gradient(circle at ' +
        spec.actionCenter +
        ' in oklab, color-mix(in oklab, ' +
        colors.messageAction +
        ' 45%, transparent) 0%, transparent 55%)',
    ].join(', '),
    filter: 'blur(3px)',
    transform: 'scale(1.1)',
  }
}

export function ThemeOrb({
  colors,
  mode,
  size = 44,
}: {
  colors: ThemeColors
  mode: ThemeAppearance
  size?: number
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="relative block shrink-0 overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        boxShadow: ORB_EDGE[mode],
      }}
    >
      <span className="absolute inset-0 rounded-full" style={orbStyle(colors, mode)} />
    </span>
  )
}

/** Absolutely positioned blocks drawing Minerva's layout with one palette. */
function wireframeBlocks(
  colors: ThemeColors,
  mode: ThemeAppearance,
): Array<[string, CSSProperties]> {
  const success = extraColorFor('success', colors, mode)
  const line = 'color-mix(in oklab, ' + colors.text + ' 22%, transparent)'
  const border = colors.border
  const tint = (color: string, amount: number, over: string): string =>
    'color-mix(in oklab, ' + color + ' ' + amount + '%, ' + over + ')'
  const blocks: Array<[string, CSSProperties]> = [
    ['canvas', { inset: 0, backgroundColor: colors.canvas }],
    // Title bar with the search box.
    [
      'titlebar',
      {
        left: 0,
        right: 0,
        top: 0,
        height: '14%',
        backgroundColor: colors.surface,
        boxShadow: 'inset 0 -1px 0 ' + border,
      },
    ],
    [
      'search',
      {
        left: '36%',
        right: '36%',
        top: '4%',
        height: '6%',
        borderRadius: 3,
        backgroundColor: colors.canvas,
      },
    ],
    // PR list, first row selected.
    [
      'sidebar',
      {
        left: 0,
        top: '14%',
        bottom: 0,
        width: '26%',
        backgroundColor: colors.surface,
        boxShadow: 'inset -1px 0 0 ' + border,
      },
    ],
    [
      'selected',
      {
        left: '3%',
        width: '20%',
        top: '20%',
        height: '11%',
        borderRadius: 3,
        backgroundColor: tint(colors.accent, 22, 'transparent'),
        boxShadow: 'inset 2px 0 0 ' + colors.accent,
      },
    ],
  ]
  for (let row = 0; row < 4; row += 1) {
    blocks.push([
      'pr' + row,
      {
        left: '6%',
        width: row % 2 ? '12%' : '15%',
        top: 23 + row * 17 + '%',
        height: '4%',
        borderRadius: 2,
        backgroundColor: line,
      },
    ])
  }
  // Diff: one removed line, two added lines.
  const widths = [26, 18, 22, 30, 14, 20]
  for (let row = 0; row < widths.length; row += 1) {
    const kind = row === 2 ? colors.error : row === 3 || row === 4 ? success : null
    blocks.push([
      'diff' + row,
      {
        left: '28%',
        right: '30%',
        top: 20 + row * 12 + '%',
        height: '10%',
        backgroundColor: kind ? tint(kind, 22, colors.codeBackground) : colors.codeBackground,
      },
    ])
    blocks.push([
      'code' + row,
      {
        left: '31%',
        width: widths[row] + '%',
        top: 23 + row * 12 + '%',
        height: '4%',
        borderRadius: 2,
        backgroundColor: line,
      },
    ])
  }
  // Didactic panel: a diagram card, text, and the accent button.
  blocks.push(
    [
      'panel',
      {
        right: 0,
        top: '14%',
        bottom: 0,
        width: '28%',
        backgroundColor: colors.surface,
        boxShadow: 'inset 1px 0 0 ' + border,
      },
    ],
    [
      'diagram',
      {
        right: '4%',
        width: '20%',
        top: '22%',
        height: '30%',
        borderRadius: 4,
        backgroundColor: colors.canvas,
        boxShadow: 'inset 0 0 0 1px ' + border,
      },
    ],
    [
      'node-a',
      {
        right: '13%',
        width: '6%',
        top: '28%',
        height: '9%',
        borderRadius: 2,
        backgroundColor: colors.accent,
        opacity: 0.8,
      },
    ],
    [
      'node-b',
      {
        right: '6%',
        width: '6%',
        top: '40%',
        height: '9%',
        borderRadius: 2,
        backgroundColor: colors.textMuted,
        opacity: 0.6,
      },
    ],
    [
      'text-a',
      {
        right: '4%',
        width: '20%',
        top: '60%',
        height: '4%',
        borderRadius: 2,
        backgroundColor: line,
      },
    ],
    [
      'text-b',
      {
        right: '8%',
        width: '16%',
        top: '68%',
        height: '4%',
        borderRadius: 2,
        backgroundColor: line,
      },
    ],
    [
      'button',
      {
        right: '4%',
        width: '12%',
        bottom: '8%',
        height: '10%',
        borderRadius: 3,
        backgroundColor: colors.accent,
      },
    ],
  )
  return blocks
}

const CLIP_PATHS = {
  left: 'polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)',
  right: 'polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)',
} as const

function WireframePane({
  colors,
  mode,
  clip,
}: {
  colors: ThemeColors
  mode: ThemeAppearance
  clip?: 'left' | 'right'
}): React.JSX.Element {
  return (
    <span
      className="absolute inset-0"
      style={clip === undefined ? undefined : { clipPath: CLIP_PATHS[clip] }}
    >
      {wireframeBlocks(colors, mode).map(([key, style]) => (
        <span key={key} className="absolute" style={style} />
      ))}
    </span>
  )
}

export function ThemeWireframe({
  panes,
  className = '',
}: {
  panes: ReadonlyArray<{ colors: ThemeColors; mode: ThemeAppearance; clip?: 'left' | 'right' }>
  className?: string
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={
        'relative block w-full overflow-hidden rounded-md border border-border ' + className
      }
    >
      {panes.map((pane) => (
        <WireframePane
          key={pane.clip ?? 'pane'}
          colors={pane.colors}
          mode={pane.mode}
          clip={pane.clip}
        />
      ))}
    </span>
  )
}
