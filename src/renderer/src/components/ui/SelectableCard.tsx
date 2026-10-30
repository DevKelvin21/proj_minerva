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

interface ActionCardProps extends CommonProps, Omit<ComponentPropsWithRef<'div'>, 'onClick'> {
  /** Opens the card's subject: a click anywhere on the card that is not another control. */
  onOpen: () => void
  /** Being fetched: the card ignores clicks (its `CardOpenButton` should be disabled too). */
  busy?: boolean
}

/**
 * A card with one main action AND other controls inside it (an author or a
 * tag that filters), so it cannot be one big button: buttons never nest.
 * Keyboard and screen readers get a real `CardOpenButton` (the title); a
 * mouse click anywhere else on the card that is not another control opens
 * it too. The open button's focus ring is drawn around the whole card
 * (`.card-host` in `styles.css`).
 */
export function ActionCard({
  onOpen,
  busy = false,
  selected = false,
  tone = 'default',
  padding = 'sm',
  className = '',
  children,
  ...rest
}: ActionCardProps): React.JSX.Element {
  return (
    <div
      {...rest}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) return
        const target = event.target instanceof Element ? event.target : null
        const control = target?.closest('button, a, input, select, textarea, [role="button"]')
        const other =
          control && event.currentTarget.contains(control) && !control.classList.contains('card-open')
        if (!other) onOpen()
      }}
      className={`card-host relative ${busy ? 'cursor-wait' : 'cursor-pointer'} ${cardClasses(
        { selected, tone, padding },
        className,
      )}`}
    >
      {children}
    </div>
  )
}

/**
 * The main control of an `ActionCard` (its title), and so the card's
 * accessible name. Its click bubbles to the card, which opens it, so it
 * takes no handler of its own.
 */
export function CardOpenButton({
  className = '',
  type = 'button',
  ...rest
}: ComponentPropsWithRef<'button'>): React.JSX.Element {
  return (
    <button
      type={type}
      className={`card-open min-w-0 text-left disabled:cursor-wait ${className}`}
      {...rest}
    />
  )
}
