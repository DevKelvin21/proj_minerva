import { useId, type ReactNode } from 'react'

interface SettingsGroupProps {
  title: ReactNode
  /** One muted line under the title, for the group as a whole. */
  description?: ReactNode
  /** Controls at the right of the title (Create theme, Import…). */
  actions?: ReactNode
  testId?: string
  children: ReactNode
}

/**
 * A titled block of a Settings page: the title (an `h3`) over one card that
 * holds the group's rows, separated by hairlines.
 */
export function SettingsGroup({
  title,
  description,
  actions,
  testId,
  children,
}: SettingsGroupProps): React.JSX.Element {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-1.5 px-0.5">
        <div className="min-w-0 flex-1 basis-56">
          <h3 id={titleId} className="text-sm font-semibold text-text">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      <div className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border bg-panel">
        {children}
      </div>
    </section>
  )
}

interface SettingsRowProps {
  /** Name of the setting, left. */
  title: ReactNode
  /** One line of what it does, under the name. */
  description?: ReactNode
  /** The control, right (wraps under the text when the page is narrow). */
  control?: ReactNode
  /** Full-width content under the name and control (a list of cards, a slider…). */
  children?: ReactNode
  /** Points the title at a field (`htmlFor`), so clicking the name focuses it. */
  htmlFor?: string
  testId?: string
}

/** One setting: name and description on the left, its control on the right. */
export function SettingsRow({
  title,
  description,
  control,
  children,
  htmlFor,
  testId,
}: SettingsRowProps): React.JSX.Element {
  const Title = htmlFor ? 'label' : 'span'
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-2.5 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <Title htmlFor={htmlFor} className="text-sm font-medium text-text">
            {title}
          </Title>
          {description && <div className="text-xs leading-relaxed text-muted">{description}</div>}
        </div>
        {control && <div className="flex min-w-0 max-w-full items-center gap-2">{control}</div>}
      </div>
      {children}
    </div>
  )
}

/** Free content inside a group card, padded like a row (a notice, a footer with Save). */
export function SettingsCardBody({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return <div className={`min-w-0 px-4 py-3 ${className}`}>{children}</div>
}
