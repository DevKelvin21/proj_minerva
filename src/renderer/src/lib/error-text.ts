import { decodeScmErrorMessage } from '../../../shared/scm-errors'

/** Electron's wrapper around a rejected `ipcRenderer.invoke`: noise for the user, and always English. */
const ELECTRON_WRAPPER_RE = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

/**
 * Display text of anything thrown by an IPC call: without Electron's wrapper
 * or the `[SCM:CODE]` marker, so only main's (already localized) message
 * reaches the screen. Branch on codes with `scmErrorCodeOf`, never on this text.
 */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return decodeScmErrorMessage(raw).message.replace(ELECTRON_WRAPPER_RE, '')
}
