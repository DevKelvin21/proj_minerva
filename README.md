# Visual evidence: feat/ui-shared-pieces

Screenshots from the Playwright suite (mock SCM + mock AI, 1600x1000).

- `after-*.png`: `npm run build && npx playwright test e2e/ai-chat.spec.ts e2e/activity-inbox.spec.ts`
  on commit 82163ee (branch `feat/ui-shared-pieces`).
- `before-*.png`: the same specs on `main` at 21570be; the `chat-use-as-menu`
  shot came from a temporary `attachScreenshot` added right after opening the menu.

Delete this branch when the PR closes.
