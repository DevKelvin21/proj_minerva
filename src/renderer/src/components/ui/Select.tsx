import type { ComponentPropsWithRef } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  fieldBoxClass,
  fieldPaddingClasses,
  fieldTextClasses,
  type FieldSize,
} from './field-classes'

interface SelectProps extends ComponentPropsWithRef<'select'> {
  fieldSize?: FieldSize
  /** Classes of the wrapper that holds the select and its chevron (width, flex). */
  containerClassName?: string
}

/**
 * Native `<select>` (keyboard, `selectOption` and the OS popup unchanged)
 * with the OS arrow swapped for a themed chevron. Native props and the `ref`
 * go to the `<select>`.
 */
export function Select({
  fieldSize = 'md',
  containerClassName = '',
  className = '',
  children,
  ...rest
}: SelectProps): React.JSX.Element {
  const padding = fieldPaddingClasses[fieldSize]
  return (
    <div className={`relative inline-flex min-w-0 ${containerClassName}`}>
      <select
        className={`w-full min-w-0 cursor-pointer appearance-none pl-2 pr-7 ${fieldBoxClass} ${fieldTextClasses[fieldSize]} ${padding.y} ${className}`}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={fieldSize === 'xs' || fieldSize === 'sm' ? 12 : 14}
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  )
}
