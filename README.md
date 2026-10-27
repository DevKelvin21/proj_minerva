# Evidence: fix/updater-mac-manifest

Screenshots for the PR that fixes the raw `latest-mac.yml` 404 dump in Settings → Updates.
Orphan branch, deleted when the PR closes.

- Fix commit: `5037eaa` (branch `fix/updater-mac-manifest`)
- Command: `unset ELECTRON_RUN_AS_NODE && npm run test:e2e` (Playwright attachments from `e2e/updater.spec.ts`)
- App: built `dist/`, `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`, `MINERVA_MOCK_UPDATER=error|notify`

| File | What it shows |
| --- | --- |
| `updater-error.png` | `MINERVA_MOCK_UPDATER=error`: the real v0.8.1 HttpError dump sanitized to one line + Retry |
| `updater-notify.png` | `MINERVA_MOCK_UPDATER=notify`: macOS notify-only with "View the release" |
