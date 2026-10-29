# Evidence: input focus rings

Before/after screenshots for the PR that moves text-field focus onto the field box.

- Before: `main` at `5e625e9`. After: branch `claude/input-focus-rings-d2f214` at `277ed09`.
- Captured with a temporary Playwright spec (kept out of the repo) over the e2e harness (`e2e/fixtures.ts`:
  `MINERVA_MOCK=1 MINERVA_MOCK_AI=1`, isolated userData), viewport 1600×1000, Minerva theme in
  light and dark. Each field is focused with `locator.focus()` and the area around it is clipped.

```bash
npx electron-vite build && FOCUS_SHOTS_TAG=after npx playwright test e2e/zz-focus-shots.spec.ts
```

- `sheet-<mode>-review.png`: chat composer, general comment, line note for the AI, line comment,
  command palette, reply, retarget branch (and its invalid state).
- `sheet-<mode>-home.png`: feature name, repo filter, sidebar search.
- `sheet-<mode>-settings.png`: Azure organization, custom model, language select, theme color
  value, theme name, theme JSON paste, Open VSX search, theme file picker.
- `<field>-<mode>-<before|after>.png`: full-size palette, chat composer and sidebar search.

Delete this branch when the PR closes.
