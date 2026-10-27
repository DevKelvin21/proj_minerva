# Evidence: sidebar resize + no closed didactic strip (feat/sidebar-resize)

All three: Playwright on 6cd9535, `npm run build && npx playwright test e2e/sidebar-queue.spec.ts` (light theme, mock universe, 1600x1000).

- `before-sidebar-default.png`: the "Queue" test, sidebar at its default 280px (the only width before this PR).
- `after-sidebar-resized.png`: the "Resize" test, sidebar dragged ~120px wider, pointer still on the handle.
- `after-panel-closed.png`: the "Didactic panel closed" test, review flush with the window's right edge.

This branch is deleted when the PR closes.
