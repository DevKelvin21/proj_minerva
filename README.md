# Evidence: activity inbox + notifications (feat/activity-inbox)

All five: Playwright on e5fe3ac, `npm run build && npx playwright test e2e/activity-inbox.spec.ts` (light theme, mock universe; the scripted reviewer comes from `MINERVA_MOCK_INCOMING_COMMENT_MS` / `MINERVA_MOCK_INCOMING_REVIEW_MS`).

- `inbox-unread.png`: 1600x1000, jrivas's new line comment on api#482 in the sidebar Inbox (unread dot, tab badge).
- `inbox-opened-at-line.png`: after clicking it: Files tab, `src/routes/carts.ts`, the thread at line 26 open and centered; the row is read.
- `inbox-tiled-960.png`: 960x540, the Inbox in the drawer after "Mark all read".
- `inbox-vote.png`: dkumar requests changes on api#482 (a vote row).
- `settings-notifications.png`: Settings → Notifications (level + badge).

This branch is deleted when the PR closes.
