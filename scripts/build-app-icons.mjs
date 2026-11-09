#!/usr/bin/env node
/**
 * Builds the app icons from the brand mark (`src/shared/brand-mark.ts`):
 *
 *   build/icon.svg   master (macOS layout), checked by src/main/brand-mark.test.ts
 *   build/icon.icns  macOS (iconutil, so this step runs on macOS only)
 *   build/icon.ico   Windows: 16–256 px, PNG entries
 *   build/icon.png   Linux: 1024 px
 *   build/tray.svg   macOS menu bar icon master, checked by the same test
 *   resources/tray/minervaTemplate.png, minervaTemplate@2x.png
 *                    the menu bar icon at 16 and 32 px: a black template image
 *                    (macOS recolors it), shipped via `extraResources`
 *
 * Each size is rendered on its own, with the mark's line heavier as the icon
 * shrinks (`appIconStroke`), instead of scaling one bitmap down.
 * electron-builder picks them up through `electron-builder.yml`.
 *
 * Run after changing the mark: `node scripts/build-app-icons.mjs` (Node 24
 * reads the .ts module directly); `--tray` rebuilds only the menu bar icon. Rendering uses Playwright with the installed
 * Google Chrome (`channel: 'chrome'`), falling back to Playwright's Chromium.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import {
  APP_ICON_INSET,
  appIconStroke,
  appIconSvg,
  TRAY_ICON_STROKE,
  trayIconSvg,
} from '../src/shared/brand-mark.ts'

const trayOnly = process.argv.includes('--tray')
const root = join(import.meta.dirname, '..')
const out = join(root, 'build')
const trayOut = join(root, 'resources', 'tray')
mkdirSync(out, { recursive: true })
mkdirSync(trayOut, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())

/** One PNG of `svg` (any viewBox), `pixels` square, on a transparent background. */
async function renderSvg(svg, pixels) {
  // A fresh page per size: resizing one page between shots can capture a stale frame.
  const page = await browser.newPage({ viewport: { width: pixels, height: pixels } })
  await page.setContent(
    '<html><body style="margin:0;background:transparent">' +
      svg.replace('<svg ', '<svg width="' + pixels + '" height="' + pixels + '" style="display:block" ') +
      '</body></html>',
  )
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: pixels, height: pixels } })
  await page.close()
  return png
}

// macOS menu bar: 16 pt, so 16 px and 32 px (@2x). The `Template` suffix makes
// Electron load it as a template image, and pick the @2x file on Retina.
const traySvg = trayIconSvg({ stroke: TRAY_ICON_STROKE })
writeFileSync(join(out, 'tray.svg'), traySvg + '\n')
writeFileSync(join(trayOut, 'minervaTemplate.png'), await renderSvg(traySvg, 16))
writeFileSync(join(trayOut, 'minervaTemplate@2x.png'), await renderSvg(traySvg, 32))
if (trayOnly) {
  await browser.close()
  console.log('build-app-icons: wrote build/tray.svg, resources/tray/minervaTemplate.png, @2x')
  process.exit(0)
}

writeFileSync(
  join(out, 'icon.svg'),
  appIconSvg({ inset: APP_ICON_INSET.mac, stroke: appIconStroke(1024) }) + '\n',
)

/** One PNG of the icon, `pixels` square, its line chosen for `points` (the size it is shown at). */
async function render(layout, pixels, points = pixels) {
  return renderSvg(appIconSvg({ inset: APP_ICON_INSET[layout], stroke: appIconStroke(points) }), pixels)
}

// macOS: an .iconset folder, then iconutil.
if (process.platform === 'darwin') {
  const iconset = join(out, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset)
  for (const points of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, 'icon_' + points + 'x' + points + '.png'), await render('mac', points))
    writeFileSync(
      join(iconset, 'icon_' + points + 'x' + points + '@2x.png'),
      await render('mac', points * 2, points),
    )
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(out, 'icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
} else {
  console.warn('build-app-icons: not on macOS, build/icon.icns left as it is (iconutil is macOS only)')
}

// Windows: an .ico whose entries are PNGs (supported since Vista).
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = []
for (const size of icoSizes) pngs.push(await render('square', size))
const header = Buffer.alloc(6 + 16 * pngs.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(pngs.length, 4)
let offset = header.length
pngs.forEach((png, i) => {
  const entry = 6 + 16 * i
  const size = icoSizes[i]
  header.writeUInt8(size >= 256 ? 0 : size, entry)
  header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
  header.writeUInt8(0, entry + 2)
  header.writeUInt8(0, entry + 3)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(png.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += png.length
})
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...pngs]))

// Linux: one large PNG; electron-builder makes the other sizes.
writeFileSync(join(out, 'icon.png'), await render('square', 1024))

await browser.close()
console.log(
  'build-app-icons: wrote build/icon.svg, icon.icns, icon.ico, icon.png, tray.svg and resources/tray/',
)
