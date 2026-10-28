/** Shared look of the text-like fields (Input, TextArea, Select). */
export type FieldSize = 'xs' | 'sm' | 'md' | 'lg'

export const fieldTextClasses: Record<FieldSize, string> = {
  xs: 'text-[11px]',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
}

/** Padding of a plain field; Input with an icon and Select replace the horizontal part. */
export const fieldPaddingClasses: Record<FieldSize, { x: string; y: string }> = {
  xs: { x: 'px-1.5', y: 'py-0.5' },
  sm: { x: 'px-2', y: 'py-1' },
  md: { x: 'px-2', y: 'py-1' },
  lg: { x: 'px-2', y: 'py-1.5' },
}

/**
 * Border, background, focus and states. Focus paints the border plus a thin
 * ring in the accent (the global outline is dropped so it isn't doubled);
 * `aria-invalid` turns the border to the danger color.
 */
export const fieldBoxClass =
  'rounded-md border border-border bg-bg text-text outline-none transition-colors duration-150 ' +
  'placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent/40 ' +
  'aria-invalid:border-danger aria-invalid:focus:ring-danger/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'
