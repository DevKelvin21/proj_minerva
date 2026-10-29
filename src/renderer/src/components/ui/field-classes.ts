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
 * Marks a control whose focus something else draws: `styles.css` drops the
 * global `:focus-visible` outline for it. Every field class below carries it.
 */
const FIELD_CONTROL = 'field-control outline-none'

const FIELD_FRAME =
  'rounded-md border border-border bg-bg transition-[border-color,box-shadow] duration-150'

/**
 * Border, background, focus and states. Focus turns the border to the focus
 * color with a soft ring around it that follows the radius; `aria-invalid`
 * keeps the border (and the ring) in the danger color.
 */
export const fieldBoxClass =
  `${FIELD_CONTROL} ${FIELD_FRAME} text-text placeholder:text-muted ` +
  'focus:border-focus focus:ring-3 focus:ring-focus/25 ' +
  'aria-invalid:border-danger aria-invalid:focus:border-danger aria-invalid:focus:ring-danger/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/**
 * A field box around several things (a bare control plus buttons, like the
 * chat composer): the same look, drawn while anything inside has focus.
 */
export const fieldFrameClass =
  `${FIELD_FRAME} focus-within:border-focus focus-within:ring-3 focus-within:ring-focus/25`

/**
 * A control with no box of its own, inside a `fieldFrameClass` or a row that
 * draws its focus (the command palette's search row).
 */
export const fieldBareClass =
  `${FIELD_CONTROL} bg-transparent text-text placeholder:text-muted ` +
  'disabled:cursor-not-allowed disabled:opacity-60'
