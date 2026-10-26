// Cross-platform screenshot of a running Minerva window via the Chrome DevTools
// Protocol (Page.captureScreenshot). Works on macOS, Linux and Windows, needs no
// window manager tooling, and captures the rendered content even when the window
// is behind others or on another workspace.
//
// Start the app with a debugging port first:
//   npm run dev -- -- --remote-debugging-port=9222
//
// Usage: node scripts/screenshot-cdp.mjs [out.png] [title-or-url-pattern]
//   out.png   default: /tmp/minerva-cdp-shot.png
//   pattern   case-insensitive regex matched against the page title OR url.
//             Default: the main window (first page whose url has no #didactic).
//             Use "didactic" to capture the detached didactic window.
// Env: MINERVA_CDP_PORT (default 9222), MINERVA_CDP_HOST (default 127.0.0.1).
import { writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const host = process.env.MINERVA_CDP_HOST ?? '127.0.0.1'
const port = process.env.MINERVA_CDP_PORT ?? '9222'
const out = process.argv[2] ?? '/tmp/minerva-cdp-shot.png'
const pattern = process.argv[3]

function fail(message) {
  console.error(message)
  process.exit(1)
}

let targets
try {
  targets = await (await fetch(`http://${host}:${port}/json/list`)).json()
} catch (err) {
  fail(
    `Cannot reach CDP at ${host}:${port} (${err instanceof Error ? err.message : String(err)}). ` +
      'Start the app with: npm run dev -- -- --remote-debugging-port=' +
      port,
  )
}

const pages = targets.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
const matcher = pattern ? new RegExp(pattern, 'i') : null
const page = matcher
  ? pages.find((t) => matcher.test(t.title) || matcher.test(t.url))
  : pages.find((t) => !t.url.includes('#didactic'))
if (!page) {
  fail(
    `No page matches ${pattern ? `"${pattern}"` : 'the main window'}. Available: ` +
      (pages.map((t) => `"${t.title}" ${t.url}`).join(' | ') || '(none)'),
  )
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((resolve, reject) => (ws.on('open', resolve), ws.on('error', reject)))
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id
    pending.set(i, resolve)
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await send('Page.enable')
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (!shot.result?.data) {
  fail('No image data: ' + JSON.stringify(shot).slice(0, 300))
}
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log(out)
ws.close()
