import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { placeMenu, rovingTarget, type MenuPlacement } from '../../lib/roving-focus'

export interface MenuItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  title?: string
  onSelect: () => void
}

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

interface MenuProps {
  /** Accessible name of the menu. */
  label: string
  items: readonly MenuItem[]
  /** Renders the trigger: spread the props on a button (`Button`, `IconButton`). */
  trigger: (props: MenuTriggerProps) => ReactNode
}

interface OpenState {
  placement: MenuPlacement
  /** Which item gets focus when the menu opens. */
  focus: 'first' | 'last'
}

/**
 * A menu button (WAI-ARIA APG): Enter, Space or Down open it on the first
 * item, Up on the last; arrows, Home and End move; Esc or Tab close it and
 * focus returns to the trigger; a click outside, a scroll or a resize close
 * it. The list is portaled to `body` with `position: fixed` next to the
 * trigger, so a scrolling container (the chat transcript) never clips it.
 * Picking an item returns focus to the trigger first, so the item's action
 * can move focus elsewhere (a composer it opens).
 */
export function Menu({ label, items, trigger }: MenuProps): React.JSX.Element {
  const [open, setOpen] = useState<OpenState | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const menuId = `${baseId}-menu`

  function show(focus: OpenState['focus']): void {
    const el = triggerRef.current
    if (!el) return
    setOpen({
      placement: placeMenu(el.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
      focus,
    })
  }

  function close(returnFocus: boolean): void {
    setOpen(null)
    if (returnFocus) triggerRef.current?.focus()
  }

  const isOpen = open !== null
  const focusTarget = open?.focus

  // Move focus into the menu once it is in the DOM.
  useEffect(() => {
    if (!focusTarget) return
    const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    if (!menuItems || menuItems.length === 0) return
    menuItems[focusTarget === 'first' ? 0 : menuItems.length - 1].focus()
  }, [focusTarget])

  // Dismiss on anything that would leave the fixed menu floating off its trigger.
  useEffect(() => {
    if (!isOpen) return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (menuRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true)
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target)) setOpen(null)
    }
    const onScroll = (event: Event): void => {
      if (!inside(event.target)) setOpen(null)
    }
    const onResize = (): void => setOpen(null)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [isOpen])

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const current = menuItems.findIndex((el) => el === event.target)
    const target = rovingTarget(event.key, Math.max(current, 0), menuItems.length, 'vertical')
    if (target === null) return
    event.preventDefault()
    menuItems[target].focus()
  }

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    id: triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': isOpen,
    'aria-controls': isOpen ? menuId : undefined,
    onClick: () => (isOpen ? close(false) : show('first')),
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        show(event.key === 'ArrowDown' ? 'first' : 'last')
      }
    },
  }

  return (
    <>
      {trigger(triggerProps)}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            data-no-drag
            onKeyDown={onMenuKeyDown}
            style={open.placement}
            className="fixed z-50 flex min-w-40 flex-col overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                title={item.title}
                onClick={() => {
                  close(true)
                  item.onSelect()
                }}
                className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-text hover:bg-border/60 focus:bg-border/60 focus:outline-none"
              >
                {item.icon && <span className="shrink-0 text-muted">{item.icon}</span>}
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
