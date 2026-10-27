import type { ReactNode } from 'react'

/** A keyboard key hint ("⌘K", "Esc"). Decorative: the action it names has its own label. */
export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd
      aria-hidden
      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded border border-b-2 border-border bg-bg px-1 font-mono text-[10px] font-semibold leading-none text-muted"
    >
      {children}
    </kbd>
  )
}
