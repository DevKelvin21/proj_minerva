import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { MINERVA_EVENTS } from '../../shared/events'
import { createMainWindowOpener } from './main-window-opener'

function fakeWindow(options: { loading?: boolean; minimized?: boolean } = {}) {
  const loaded: Array<() => void> = []
  const win = {
    isDestroyed: () => false,
    isMinimized: () => options.minimized === true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isLoading: () => options.loading === true,
      send: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'did-finish-load') loaded.push(listener)
      }),
    },
  }
  const finishLoad = (): void => {
    for (const listener of loaded.splice(0)) listener()
  }
  return { win, finishLoad, asWindow: win as unknown as BrowserWindow }
}

describe('createMainWindowOpener', () => {
  it('brings an open window up and sends the item at once', () => {
    const { win, asWindow } = fakeWindow({ minimized: true })
    const create = vi.fn()
    const activateApp = vi.fn()
    const open = createMainWindowOpener({ find: () => asWindow, create, activateApp })
    open({ itemId: 'comment:a' })
    expect(create).not.toHaveBeenCalled()
    expect(activateApp).toHaveBeenCalled()
    expect(win.restore).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith(MINERVA_EVENTS.openActivity, {
      itemId: 'comment:a',
    })
  })

  it('creates the window when none exists and sends once it has loaded', () => {
    const { win, finishLoad, asWindow } = fakeWindow({ loading: true })
    const open = createMainWindowOpener({
      find: () => null,
      create: () => asWindow,
      activateApp: () => undefined,
    })
    open({ itemId: null })
    expect(win.webContents.send).not.toHaveBeenCalled()
    finishLoad()
    expect(win.webContents.send).toHaveBeenCalledWith(MINERVA_EVENTS.openActivity, {
      itemId: null,
    })
  })

  it('only brings the window up when there is nothing to open', () => {
    const { win, asWindow } = fakeWindow()
    const open = createMainWindowOpener({
      find: () => asWindow,
      create: vi.fn(),
      activateApp: () => undefined,
    })
    open()
    expect(win.show).toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
