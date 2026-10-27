# Evidence: title bar redesign (PR feat/title-bar-redesign)

- `before-*.png`: `main` at c14036d, dev app (`MINERVA_MOCK=1 MINERVA_MOCK_AI=1 npm run dev -- -- --remote-debugging-port=9222`), captured over CDP with `scripts/screenshot-app.sh`.
- `after-review.png`, `after-home.png`, `after-accounts-menu.png`: same dev app on `feat/title-bar-redesign` (working tree that became cf6e0e8), CDP capture.
- `after-tiled-900.png`, `after-tiled-600.png`: the title bar strip at 900 and 600 px wide (CDP `Emulation.setDeviceMetricsOverride`).
- `after-palette-e2e.png`, `after-partial-light-e2e.png`: Playwright, `npx playwright test e2e/title-bar.spec.ts e2e/provider-aware.spec.ts` on cf6e0e8 (light theme for the second).

CDP captures show web contents only, so the native traffic lights are not in the images; the 92 px band on the left is where they sit.

This branch is deleted when the PR closes.
