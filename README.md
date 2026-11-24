# Evidence: Azure Files tab lists deleted files (fix/azure-files-null)

Commit: abdf42b (branch `claude/fix-azure-files-null-a72ba7`).

- `dev-app-files-tab.png`: dev app, mock Azure PR #103 (stacked, 3 of 3), Files tab with the
  added endpoint and two deleted files; the deleted stored procedure shows its removed lines.
  Command: `MINERVA_USER_DATA_DIR=<temp> MINERVA_MOCK=1 MINERVA_MOCK_AI=1 npm run dev -- -- --remote-debugging-port=9333`,
  then a CDP screenshot after opening #103 → Files → `sp_LegacyCheckoutSubmit.sql`.
- `e2e-azure-deleted-files.png`: attached by `e2e/azure-mock.spec.ts` ›
  "Azure: a stacked PR with deleted files lists every file and shows the removed lines" (`npm run test:e2e`).

Before the fix the same PR showed only: "Could not load the files: Cannot read properties of null (reading 'replace')".
