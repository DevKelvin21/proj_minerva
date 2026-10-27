/**
 * Native confirmation for the actions a compromised renderer must not be able
 * to trigger alone (retarget, a new Azure organization). The dialog is drawn
 * by main, attached to the window that asked, so the user sees what main is
 * about to do (not what the renderer claims).
 *
 * Test hook: with `MINERVA_MOCK=1` AND `MINERVA_TEST_CONFIRM=accept|decline`
 * the dialog is skipped and that answer is used (e2e can't click a native
 * dialog). Outside mock mode the variable is ignored, so it can never turn a
 * real write into an unconfirmed one.
 */
import type { WebContents } from 'electron'

export interface ConfirmRequest {
  /** Short question, e.g. "Retarget PR #12?". */
  message: string
  /** Facts the user decides on (repo, title, branches). Untrusted parts are sanitized here. */
  detail: string
  /** Label of the affirmative button. Cancel is always the default. */
  confirmLabel: string
}

/** Answers `true` only when the user chose the affirmative button. */
export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>

/** The test answer, or `null` when the dialog must be shown (always `null` outside mock mode). */
export function testConfirmAnswer(env: NodeJS.ProcessEnv = process.env): boolean | null {
  if (env.MINERVA_MOCK !== '1') return null
  if (env.MINERVA_TEST_CONFIRM === 'accept') return true
  if (env.MINERVA_TEST_CONFIRM === 'decline') return false
  return null
}

const MAX_DETAIL_FIELD_CHARS = 200

/**
 * Untrusted text (a PR title, a branch name) for a dialog line: no control
 * characters or bidi overrides (they could visually reorder "old -> new"),
 * collapsed whitespace, capped length.
 */
export function dialogText(value: string, maxChars = MAX_DETAIL_FIELD_CHARS): string {
  const clean = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > maxChars ? clean.slice(0, maxChars - 1) + '…' : clean
}

export interface NativeConfirmDeps {
  env?: NodeJS.ProcessEnv
  /** Electron's dialog + window lookup; injected so unit tests never load Electron. */
  showMessageBox?: (
    sender: WebContents | null,
    options: Electron.MessageBoxOptions,
  ) => Promise<{ response: number }>
}

async function electronMessageBox(
  sender: WebContents | null,
  options: Electron.MessageBoxOptions,
): Promise<{ response: number }> {
  const { BrowserWindow, dialog } = await import('electron')
  const win = sender ? BrowserWindow.fromWebContents(sender) : null
  return win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options)
}

/** A `ConfirmFn` bound to the window of `sender` (the IPC caller). */
export function nativeConfirm(sender: WebContents | null, deps: NativeConfirmDeps = {}): ConfirmFn {
  return async (request) => {
    const scripted = testConfirmAnswer(deps.env ?? process.env)
    if (scripted !== null) return scripted
    const show = deps.showMessageBox ?? electronMessageBox
    const { response } = await show(sender, {
      type: 'question',
      buttons: [request.confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Minerva',
      message: request.message,
      detail: request.detail,
    })
    return response === 0
  }
}
