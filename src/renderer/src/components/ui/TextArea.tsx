import type { ComponentPropsWithRef } from 'react'
import {
  fieldBoxClass,
  fieldPaddingClasses,
  fieldTextClasses,
  type FieldSize,
} from './field-classes'

const BARE_CLASS =
  'bg-transparent text-text outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60'

interface TextAreaProps extends ComponentPropsWithRef<'textarea'> {
  fieldSize?: FieldSize
  /**
   * No border, background or padding: the textarea sits inside a composite
   * field that draws them (and its focus, via `focus-within`).
   */
  bare?: boolean
  /** Grows with its content (`field-sizing: content`); cap it with a `max-h-*`. */
  autoGrow?: boolean
  mono?: boolean
}

/** Multi-line text field; every native prop and the `ref` go to the `<textarea>`. */
export function TextArea({
  fieldSize = 'md',
  bare = false,
  autoGrow = false,
  mono = false,
  className = '',
  ...rest
}: TextAreaProps): React.JSX.Element {
  const padding = fieldPaddingClasses[fieldSize]
  const box = bare ? BARE_CLASS : `${fieldBoxClass} ${padding.x} ${padding.y}`
  return (
    <textarea
      className={`min-w-0 ${box} ${fieldTextClasses[fieldSize]} ${
        autoGrow ? 'field-sizing-content' : ''
      } ${mono ? 'font-mono' : 'font-sans'} ${className}`}
      {...rest}
    />
  )
}
