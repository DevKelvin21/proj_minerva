import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, launchMinerva, closeMinerva, attachScreenshot } from './fixtures'

/**
 * The app PACKAGED by electron-builder, launched from the unpacked binary in
 * `dist/` (per OS, see `candidateBinaries`). The renderer loading from
 * `file://…app.asar…` is itself the proof that the packaged build runs
 * (main + preload + fixtures inside the asar) and not the dev server or `out/`.
 *
 * The binary is NOT built here (electron-builder takes minutes): the test
 * auto-skips when it is missing. To cover it, run `npm run dist:mac:dir`
 * (macOS) or `npm run dist:dir` (Linux) before the suite.
 */

/**
 * Where `electron-builder --<os> dir` leaves the unpacked app. The macOS folder
 * depends on the arch it was built for (`mac-arm64` on Apple Silicon, `mac` for
 * x64), so the candidates are tried in order. `PRODUCT_NAME` comes from
 * `electron-builder.yml` (`productName`); on Linux the executable is
 * `linux.executableName`.
 */
const PRODUCT_NAME = 'Minerva'

function candidateBinaries(): string[] {
  const dist = join(process.cwd(), 'dist')
  if (process.platform === 'darwin') {
    return ['mac-arm64', 'mac'].map((dir) =>
      join(dist, dir, PRODUCT_NAME + '.app', 'Contents', 'MacOS', PRODUCT_NAME),
    )
  }
  if (process.platform === 'win32') {
    return [join(dist, 'win-unpacked', PRODUCT_NAME + '.exe')]
  }
  return [join(dist, 'linux-unpacked', 'minerva')]
}

const PACKAGED_BINARY = candidateBinaries().find((path) => existsSync(path)) ?? candidateBinaries()[0]

/**
 * The version the PACKAGED app reports through `window.minerva.system.getVersion()`
 * (`minerva:getVersion` → `app.getVersion()`) must match `package.json` EXACTLY:
 * it is the only surface where Minerva shows its own version (the "Updates"
 * section of the Settings modal). Unpackaged, `app.getVersion()` returns
 * Electron's version (which is why the rest of the suite, `updater.spec.ts`,
 * never asserts a literal) — here it is safe because the binary is really packaged.
 */
const PACKAGE_JSON_VERSION = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version: string }
).version

// eslint-disable-next-line no-empty-pattern
test('the packaged app starts, exposes the preload and serves the fixtures from the asar', async ({}, testInfo) => {
  test.skip(
    !existsSync(PACKAGED_BINARY),
    'no packaged binary at ' + PACKAGED_BINARY + ' — run npm run dist:mac:dir (macOS) or npm run dist:dir (Linux) first',
  )

  const app = await launchMinerva(testInfo.outputPath('user-data'), {
    executable: PACKAGED_BINARY,
    args: [],
  })
  try {
    // Main window by hand (not mainWindow()): the renderer ORIGIN is checked
    // before waiting for content, which is the point of this spec.
    let window = app.context.pages().find((p) => !p.url().includes('#didactic'))
    if (!window) {
      window = await app.context.waitForEvent('page', { timeout: 15_000 })
    }
    await window.waitForLoadState('domcontentloaded')
    expect(window.url(), 'renderer served from the asar (not the dev server or out/)').toMatch(
      /^file:\/\/.*app\.asar.*index\.html/,
    )

    // CJS preload loaded: window.minerva exposed by contextBridge.
    expect(await window.evaluate(() => typeof window.minerva)).toBe('object')

    // The version reported over IPC matches package.json exactly.
    const reportedVersion = await window.evaluate(() => window.minerva.system.getVersion())
    expect(reportedVersion, 'getVersion() == package.json in the packaged binary').toBe(
      PACKAGE_JSON_VERSION,
    )

    // Mock PR list over IPC (main fixtures INSIDE the asar) + ping.
    await expect(window.getByText('apply-coupon').first()).toBeVisible({ timeout: 20_000 })
    await expect(window.getByText('Conectado').first()).toBeVisible()

    // Detail + Files tab (parsed diff + Shiki from the bundle).
    await window.getByText('Add refunds table and migration').first().click()
    await expect(window.getByText('#479').first()).toBeVisible()
    // The fixture's file name, not a loose regex: the PR title also contains
    // "refunds" and would mask a diff that fails to load.
    await window.getByText('Archivos').first().click()
    await expect(window.getByText('2026070401_create_refunds.sql').first()).toBeVisible()

    await attachScreenshot(window, testInfo, 'packaged-archivos-479')
  } finally {
    await closeMinerva(app)
  }
})
