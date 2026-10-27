# Evidence: calm review layout (PR feat/calm-review-layout, stacked on #14)

- `before-review-header.png`: `feat/title-bar-redesign` (cf6e0e8), dev app (`MINERVA_MOCK=1 MINERVA_MOCK_AI=1 npm run dev -- -- --remote-debugging-port=9222`), CDP capture via `scripts/screenshot-app.sh`.
- `before-diff-threads.png`: `main` at c14036d (old title bar too), same dev app: threads expanded inside the diff.
- `after-files-bar.png`, `after-files-bar-with-panel.png`, `after-diff-threads.png`: same dev app on the working tree that became 5c5a82f. The second shows the bar dropping to icons when the didactic panel narrows the center.
- `*-e2e.png`: Playwright on 5c5a82f, `npm run build && npx playwright test` (light theme, mock universe): Details popover (`provider-aware.spec.ts`), analysis tabs (`didactic.spec.ts`), tiled 1920x540 with the stack map under the bar (`stacks.spec.ts`).

This branch is deleted when the PR closes.
