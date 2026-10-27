# Evidence: sidebar review queue + folded rail (PR feat/sidebar-queue, stacked on #16)

- `before-sidebar-list.png`: `feat/title-bar-redesign` (cf6e0e8) dev app, the grouped PR list as the only list view (CDP capture via `scripts/screenshot-app.sh`).
- `*-e2e.png`: Playwright on 91cc38d, `npm run build && npx playwright test e2e/sidebar-queue.spec.ts` (light theme, mock universe).
- `after-*-dark.png`: dev app on the working tree that became 91cc38d (`MINERVA_MOCK=1 MINERVA_MOCK_AI=1 MINERVA_MOCK_GH_AUTH=signed_in npm run dev -- -- --remote-debugging-port=9222`, clean userData). Rows there still show +/- counts, dropped right after for queue rows.

This branch is deleted when the PR closes.
