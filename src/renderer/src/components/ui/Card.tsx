import type { HTMLAttributes } from 'react'
import { CARD_BASE, CARD_PADDING, type CardPadding } from './card-classes'

/** `panel` is a card on the canvas; `inset` groups other cards (a stack on the board). */
export type CardTone = 'panel' | 'inset'

const toneClasses: Record<CardTone, string> = {
  panel: 'border-border bg-panel',
  inset: 'border-border bg-bg/40',
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li'
  padding?: CardPadding
  tone?: CardTone
}

/** A static panel surface. For a clickable one use `SelectableCard`. */
export function Card({
  as: Element = 'div',
  padding = 'md',
  tone = 'panel',
  className = '',
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <Element
      className={`${CARD_BASE} ${CARD_PADDING[padding]} ${toneClasses[tone]} ${className}`}
      {...rest}
    />
  )
}
