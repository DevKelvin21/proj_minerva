# Evidence: full-screen walkthrough + Ask AI on a line (PR feat/walkthrough-focus)

- `*-e2e.png`: Playwright on c97bbb0, `npm run build && npx playwright test` (light theme, mock universe, `MINERVA_MOCK_AI=1`). `before-layers-in-files-tab-e2e.png` is the layers view inside the normal review (`walkthrough.spec.ts`), which still exists; `after-focus-e2e.png` / `after-ask-ai-e2e.png` come from `walkthrough-focus.spec.ts`.
- `after-*-dark.png`: dev app on the working tree that became c97bbb0 (`MINERVA_MOCK=1 MINERVA_MOCK_AI=1 MINERVA_MOCK_GH_AUTH=signed_in npm run dev -- -- --remote-debugging-port=9222`, clean userData), CDP capture via `scripts/screenshot-app.sh`. The answer is the mock one.

This branch is deleted when the PR closes.
