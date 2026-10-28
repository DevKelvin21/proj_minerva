import type { ComponentPropsWithRef, ReactNode } from 'react'
import {
  fieldBoxClass,
  fieldPaddingClasses,
  fieldTextClasses,
  type FieldSize,
} from './field-classes'

interface InputProps extends ComponentPropsWithRef<'input'> {
  fieldSize?: FieldSize
  /** Leading icon, decorative (the field still needs its own label). */
  icon?: ReactNode
  /** With `icon`: classes of the wrapper that holds both (width, flex). */
  containerClassName?: string
  mono?: boolean
}

/**
 * Text field in the shared field look. Every native prop and the `ref` go to
 * the `<input>`, so labels, `getByRole('textbox')` and focus work as before.
 */
export function Input({
  fieldSize = 'md',
  icon,
  containerClassName = '',
  mono = false,
  className = '',
  type = 'text',
  ...rest
}: InputProps): React.JSX.Element {
  const padding = fieldPaddingClasses[fieldSize]
  const classes = `${fieldBoxClass} ${fieldTextClasses[fieldSize]} ${padding.y} ${
    icon ? 'w-full pl-8 pr-2' : padding.x
  } ${mono ? 'font-mono' : ''} ${className}`
  if (!icon) return <input type={type} className={classes} {...rest} />
  return (
    <div className={`relative min-w-0 ${containerClassName}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 text-muted"
      >
        {icon}
      </span>
      <input type={type} className={classes} {...rest} />
    </div>
  )
}
