import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import type { ChoiceSize } from './Checkbox'

const sizeClasses: Record<ChoiceSize, { text: string; track: string; thumb: string; on: string }> =
  {
    sm: { text: 'text-xs', track: 'h-4 w-7', thumb: 'h-3 w-3', on: 'translate-x-3' },
    md: { text: 'text-sm', track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'translate-x-4' },
  }

interface SwitchProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'role' | 'children' | 'onChange'
> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Visible label: names the switch and toggles it when clicked. */
  label: ReactNode
  hint?: ReactNode
  fieldSize?: ChoiceSize
}

/**
 * On/off for a setting that applies the moment it changes (no Save button;
 * inside a form with one, use a Checkbox). A `button role="switch"`, so Space
 * and Enter toggle it. `aria-disabled` keeps it focusable but inert (use it
 * while a save is in flight, instead of `disabled`, which drops the focus).
 * `className` goes to the wrapper; other native props and the `ref` go to
 * the button (its role, id and ARIA wiring are fixed).
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  fieldSize = 'sm',
  className = '',
  onClick,
  ...rest
}: SwitchProps): React.JSX.Element {
  const id = useId()
  const size = sizeClasses[fieldSize]
  const inert =
    rest.disabled === true || rest['aria-disabled'] === true || rest['aria-disabled'] === 'true'
  return (
    <div className={`flex items-start gap-2 text-text ${size.text} ${className}`}>
      <button
        {...rest}
        type="button"
        role="switch"
        id={id + 'switch'}
        aria-checked={checked}
        aria-labelledby={id + 'label'}
        aria-describedby={hint ? id + 'hint' : undefined}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented && !inert) onCheckedChange(!checked)
        }}
        className={`inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed ${
          size.track
        } ${checked ? 'bg-accent' : 'bg-border'}`}
      >
        <span
          aria-hidden
          className={`rounded-full transition-transform duration-150 ${size.thumb} ${
            checked ? `${size.on} bg-accent-fg` : 'translate-x-0 bg-muted'
          }`}
        />
      </button>
      <span className="min-w-0">
        <label id={id + 'label'} htmlFor={id + 'switch'} className="cursor-pointer">
          {label}
        </label>
        {hint && (
          <span id={id + 'hint'} className="block text-xs text-muted">
            {hint}
          </span>
        )}
      </span>
    </div>
  )
}
