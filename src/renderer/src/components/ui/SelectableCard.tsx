import type { ComponentPropsWithRef } from 'react'
import { CARD_BASE, CARD_PADDING, type CardPadding } from './card-classes'

interface CommonProps {
  /** Accent border: the card is the current one. The caller sets `aria-pressed`/`aria-current`. */
  selected?: boolean
  /** `warning` borders a card that needs attention (an orphaned PR). */
  tone?: 'default' | 'warning'
  padding?: CardPadding
}

type ButtonCardProps = CommonProps & ComponentPropsWithRef<'button'> & { href?: undefined }
type LinkCardProps = CommonProps & ComponentPropsWithRef<'a'> & { href: string }

function cardClasses({ selected, tone, padding }: Required<CommonProps>, extra: string): string {
  const border = selected
    ? 'border-accent bg-accent/10'
    : tone === 'warning'
      ? 'border-warning/50 bg-panel hover:border-accent/60'
      : 'border-border bg-panel hover:border-accent/60'
  // No `outline-none`: the theme's `:focus-visible` ring (styles.css) marks
  // keyboard focus, apart from the hover border.
  return `${CARD_BASE} ${CARD_PADDING[padding]} ${border} w-full text-left transition-colors duration-150 disabled:cursor-wait ${extra}`
}

/**
 * A whole card that is one button (or a link with `href`): keyboard
 * reachable, a focus ring distinct from hover, an accent border when
 * `selected`.
 */
export function SelectableCard(props: ButtonCardProps | LinkCardProps): React.JSX.Element {
  if (props.href !== undefined) {
    const { selected = false, tone = 'default', padding = 'sm', className = '', ...rest } = props
    return <a className={cardClasses({ selected, tone, padding }, className)} {...rest} />
  }
  const {
    selected = false,
    tone = 'default',
    padding = 'sm',
    className = '',
    type = 'button',
    ...rest
  } = props
  return (
    <button type={type} className={cardClasses({ selected, tone, padding }, className)} {...rest} />
  )
}
