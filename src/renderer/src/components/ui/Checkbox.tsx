import type { ComponentPropsWithRef, ReactNode } from 'react'

export type ChoiceSize = 'sm' | 'md'

/** Label text size, and the nudge that lines the box up with the label's first line. */
const sizeClasses: Record<ChoiceSize, { text: string; box: string }> = {
  sm: { text: 'text-xs', box: 'mt-0.5' },
  md: { text: 'text-sm', box: 'mt-1' },
}

const INPUT_CLASS =
  'shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed aria-disabled:cursor-not-allowed'

interface ChoiceProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size'> {
  /** Visible label; it wraps the input, so it is also the accessible name. */
  label?: ReactNode
  /** Muted second line under the label (inside it, so clicking it toggles too). */
  hint?: ReactNode
  fieldSize?: ChoiceSize
}

/**
 * Native checkbox or radio painted in the theme accent instead of the OS
 * blue. With `label`, `className` goes to the wrapping `<label>` (layout);
 * without one, to the input. Native props and the `ref` go to the `<input>`.
 */
function Choice({
  type,
  label,
  hint,
  fieldSize = 'sm',
  className = '',
  ...rest
}: ChoiceProps & { type: 'checkbox' | 'radio' }): React.JSX.Element {
  const size = sizeClasses[fieldSize]
  if (label === undefined) {
    return <input type={type} className={`${INPUT_CLASS} ${className}`} {...rest} />
  }
  return (
    <label
      className={`flex items-start gap-2 text-text has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${size.text} ${className}`}
    >
      <input type={type} className={`${INPUT_CLASS} ${size.box}`} {...rest} />
      <span className="min-w-0">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

export function Checkbox(props: ChoiceProps): React.JSX.Element {
  return <Choice type="checkbox" {...props} />
}

/** One radio; group them in a `<fieldset>` with a `<legend>` and a shared `name`. */
export function Radio(props: ChoiceProps): React.JSX.Element {
  return <Choice type="radio" {...props} />
}
