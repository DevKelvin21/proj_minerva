interface ScrimProps {
  /** Called on a click on the scrim itself; omit for a backdrop that only dims. */
  onDismiss?: () => void
  /** Stacking class (`z-30` under a drawer); the scrim always fills its positioned parent. */
  className?: string
}

/**
 * The one backdrop behind dialogs and drawers: the theme's `scrim` token
 * (the canvas pushed toward black), never a hard-coded black. Decorative to
 * assistive tech: the layer above it carries the way out (Esc, a close button).
 */
export function Scrim({ onDismiss, className = '' }: ScrimProps): React.JSX.Element {
  return (
    <div
      aria-hidden
      data-testid="scrim"
      onClick={onDismiss}
      className={'app-no-drag absolute inset-0 bg-scrim/60 ' + className}
    />
  )
}
