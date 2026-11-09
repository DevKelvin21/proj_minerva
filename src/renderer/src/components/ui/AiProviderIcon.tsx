import { useId } from 'react'
import type { AiProviderId } from '../../../../shared/ai-providers'
import { ProviderMark } from './ProviderMark'
import { ICON_PX, ICON_STROKE, type IconSize } from './icons'

/** OpenCode has no mark in the logos set: a monospace lettermark instead. */
const OPENCODE_LETTERS = 'oc'

/**
 * The mark of an AI provider's CLI: Claude Code = Claude, Codex = OpenAI,
 * OpenCode = an "oc" lettermark in a rounded box. Decorative: it always sits
 * next to the provider's name (or inside a control that carries it).
 * Monochrome (`currentColor`) by default; `color` uses Claude's orange and
 * fills OpenCode's box, for Settings.
 */
export function AiProviderIcon({
  provider,
  size = 'sm',
  color = false,
  className = '',
}: {
  provider: AiProviderId
  size?: IconSize
  color?: boolean
  className?: string
}): React.JSX.Element {
  const classes = 'shrink-0 ' + className
  if (provider === 'claude-code') {
    return <ProviderMark mark="claude" size={size} color={color} className={classes} />
  }
  if (provider === 'codex') {
    return <ProviderMark mark="openai" size={size} color={color} className={classes} />
  }
  return <OpenCodeMark size={size} filled={color} className={classes} />
}

function OpenCodeMark({
  size,
  filled,
  className,
}: {
  size: IconSize
  filled: boolean
  className: string
}): React.JSX.Element {
  // `useId` can carry characters a `url(#…)` reference does not like.
  const maskId = 'oc-mark-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const px = ICON_PX[size]
  const letters = (
    <text
      x="8"
      y="10.6"
      textAnchor="middle"
      fontSize="7.5"
      fontWeight="700"
      className="font-mono"
      fill={filled ? 'black' : 'currentColor'}
    >
      {OPENCODE_LETTERS}
    </text>
  )
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
      data-provider-mark="opencode"
      className={className}
    >
      {filled ? (
        <>
          {/* Solid box with the letters cut out, so the panel shows through. */}
          <mask id={maskId}>
            <rect x="0" y="0" width="16" height="16" fill="white" />
            {letters}
          </mask>
          <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : (
        <>
          <rect
            x="1"
            y="1"
            width="14"
            height="14"
            rx="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={ICON_STROKE}
            vectorEffect="non-scaling-stroke"
          />
          {letters}
        </>
      )}
    </svg>
  )
}
