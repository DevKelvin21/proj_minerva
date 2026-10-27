# CLAUDE.md — proj_minerva

## What it is

Electron app for reviewing Pull Requests **didactically**: a GitKraken-style diff plus an
AI agent that explains the _impact_ (C4 diagrams, new-endpoint docs with local try-it
snippets, schema changes + ER diagram, cloud infra). English UI with a Spanish translation (i18n, see "UI text / i18n"). Multi-provider source control:
**GitHub** via the `gh` CLI, **Azure DevOps** via the `az` CLI (stack view and comment-review UI in progress, see
`docs/plan-azure-devops.md`). Every feature must help the reviewer **understand** the
PR, not just see changed lines.

## Architecture

Three separate processes (`electron-vite` 5): `src/main/` (Node: windows, SCM calls,
AI CLIs, secrets, caches), `src/preload/` (`contextBridge`, small typed API, no
`nodeIntegration`, built as **CJS**), `src/renderer/` (React 19, strict TS, Tailwind v4
CSS-first, Zustand).

**Source control.** Contract in `src/shared/scm.ts` (`RepoRef` union, `repoKey`/`prKey`/
`sameRepo`, `ScmErrorCode`). Providers implement `ScmProvider` (`main/scm/provider.ts`),
found via `main/scm/registry.ts` (`forRepo`, `enabled`, `allSettled` fan-out); IPC channels
are `scm:*`. Errors cross IPC as a `[SCM:CODE]` message prefix (`shared/scm-errors.ts`):
branch on the code, never on message text. Rule for every provider: the renderer gets
unified patches built in main.
- GitHub (`main/scm/github/`): Octokit. Auth is the `gh` CLI only: `gh auth token
  --hostname …` feeds Octokit, validated against `GET /user`, one retry on 401. The
  token lives only in main's memory, never persisted or logged. `githubAccount` in
  settings (`null` = follow gh) is passed as `--user`. Never run `gh auth switch/logout`
  (the CLI session is the user's). The gh spawn uses the raw env, NOT
  `buildSanitizedSpawnEnv` (that strips `GH_TOKEN`; it is for AI CLIs).
- Azure DevOps (`main/scm/azure/`): `az` only supplies the credential (the PAT of
  `az devops login`, read via az's own Python keyring); data goes by REST from Node.
  Scope = `scm.azure` orgs/projects in settings.json (default: `az devops configure`);
  every per-repo call refuses orgs that are not configured. Patches are built from blobs
  under an aggregate budget (`diff-files.ts`). `updatedAt` is derived (see the header of
  `azure-provider.ts`).
- Provider-neutral in `main/scm/`: `snapshot-store`, `seen-store`, `pr-watcher`,
  `scm-settings` (enabled flags), `retarget` (re-validation before the only PR write),
  `stacks-service` (orphans via exact merged-by-source lookups). Composition root:
  `default-scm.ts`.
- `MINERVA_MOCK=1` = mock SCM: GitHub universe "shopwave" + Azure org "contoso" (the real
  `AzureScmProvider` over the in-memory `azure/fixtures/fake-server.ts`; writes stay in
  memory). It does not affect AI. NEVER test write paths against a real org.

**AI** runs through the user's own CLI sessions, no Minerva API keys: OpenCode (default;
`opencode serve` + `@opencode-ai/sdk`, exact-pinned to the CLI), Claude Code (Agent SDK),
Codex (`codex app-server`). Each analysis downloads a **snapshot of the repo at the PR
commit** and the model explores it with **read-only tools**. Jails: OpenCode
`OPENCODE_CONFIG_CONTENT` deny-by-default; Claude `tools: [Read,Grep,Glob]` +
`permissionMode: 'dontAsk'` + `settingSources: []`; Codex `sandbox: 'read-only'`.
- Provider/model precedence: settings.json > env `MINERVA_AI_PROVIDER`/`MINERVA_AI_MODEL`
  > default `opencode/big-pickle`. Model catalogs are dynamic (asked from each CLI,
  `main/ai/providers/*-model-catalog.ts`); `src/shared/ai-providers.ts` is only a fallback.
- Streaming: SSE in main + tagged section protocol (`@@@SECTION kind=…`,
  `@@@MERMAID…@@@END_MERMAID`, `@@@SNIPPET…`) parsed by `StreamSectionParser`, pushed
  via `onAnalysisProgress`. Do not return to monolithic JSON. 20-entry LRU analysis
  cache in main; prompts in `src/main/ai/prompts/`.
- Mermaid renders in the renderer (lazy, `securityLevel: 'strict'`); the AI writes
  Mermaid text, it does not draw.
- **Guided walkthrough** (CodeRabbit "Change Stack" style): the mandatory `walkthrough`
  section (2nd, after `summary`) groups the PR into cohorts of ordered layers via
  `@@@LAYER cohort="…" title="…" files="path:12-40,55;other.ts"` markers; the markdown and an
  optional `@@@MERMAID` after a marker belong to that layer. Ranges are NEW-file lines
  (OLD-file for deleted files); `section-mapper.ts` drops layers without title/files. The
  Files tab's third left-column mode (`fileTreeMode: 'layers'`, `LayerNavigator` +
  `LayerContextBar`, J/K keys) consumes it through `useWalkthrough` (same analysis as the
  didactic panel, no extra LLM call); unknown paths are listed as a warning, uncovered files
  under "Not covered by any layer".
- Detached didactic window: `#didactic/…` hash carrying the full `RepoRef` as validated
  base64url JSON (`shared/didactic-route.ts`); `main.tsx` reacts to `hashchange`.

### Security boundary (critical)

- Every secret (SCM tokens) lives only in `main`; AI CLI sessions stay in their own
  stores (`~/.claude`, `~/.codex`, `~/.local/share/opencode`).
- The **PR snapshot is hostile code**: never execute it. Only the jailed provider tools
  read it (no write/bash/network; symlinks filtered on extract).
- The preload exposes concrete functions (`window.minerva.*`), never raw `ipcRenderer`;
  one concrete method per push event.
- Main validates each channel's payload (`src/main/ipc/validators.ts`).
- Explicit CSP in `src/renderer/index.html`; `data:` is needed for Mermaid C4 sprites,
  `https:` for avatars/comment images.
- PR content (titles, diffs, comments) is **untrusted**: prompt injection when building
  prompts, no raw HTML when rendering (react-markdown).

## Layout

```
src/main/    index.ts, scm/ (provider.ts, registry.ts, github/, azure/,
             snapshot-store, seen-store, pr-watcher; github/ = Octokit + gh bridge), ai/ (prompts/,
             providers/, stream-parser, analysis-cache), ipc/ (handlers, validators),
             settings/, updater/, windows/
src/preload/ index.ts → window.minerva.*
src/shared/  ipc.ts (single contract), types.ts, scm.ts (+ scm-guards, scm-errors),
             ai-providers.ts, didactic-route.ts
src/renderer/src/  components/ hooks/ stores/ lib/
e2e/ Playwright suite · scripts/ screenshot + debug helpers · docs/ (archive/ = original
author's Spanish logs, not maintained)
```

## Conventions

- Strict TypeScript, no `any` without justification; IPC types in `src/shared/`.
- Components `PascalCase.tsx`; main/shared modules `kebab-case.ts`; small UI components,
  data logic in hooks/main.
- Reset per-entity state by **remounting with `key`** (lint forbids setState-in-effect).
- **Responsive**: the app is used tiled. Rules in `renderer/src/lib/layout.ts`;
  `useLayoutTier()` (window) for structure, `useElementWidth()` for intra-panel layout.
  New panels: `min-w-0` on flex containers, no fixed `shrink-0` widths without a clamp.
- Network/AI errors: visible loading and error state, never a silent throw. Show IPC errors
  with `errorText()` (`renderer/src/lib/error-text.ts`: drops Electron's wrapper and `[SCM:CODE]`).

### Themes (Settings → Appearance)

- Ported from T3 Code (MIT, `THIRD_PARTY_NOTICES.md`): T3 Code's color roles and built-in
  palettes plus a Minerva palette (the default). Pure engine in `src/shared/theme/`
  (strict color parser `color.ts`, `themes.ts`, `appearance.ts` = settings shape/validation/
  resolution, `library.ts`, VS Code import). Saved in settings.json `appearance` via
  `settings:getAppearance`/`setAppearance` + `appearanceChanged` push (like language); main
  syncs `nativeTheme.themeSource` and window backgrounds (`main/theme/appearance-service.ts`).
- **Never hard-code a color in the renderer.** Use the Tailwind tokens (`bg-bg`, `bg-panel`,
  `text-text`, `text-muted`, `border-border`, `bg-code-bg`, `text-accent`, `text-accent-fg`
  on accent fills, `text-success|danger|warning|merged|info`, `bg-diff-add|del`); they point
  at `--theme-*` vars set on `<html>` (`styles.css`). Light/dark-only CSS keys off
  `:root[data-appearance]`. Shiki tokens carry both colors (`tokenClass`/`tokenStyle`).
  Mermaid re-renders with `theme/mermaid-theme.ts`; C4's hard-coded `#444444` is recolored.
- Every theme color is untrusted: it must pass `toCanonicalThemeColor` (renderer) /
  `isCanonicalThemeColor` (main validator) before it becomes a CSS value.
- No flash on boot: `public/theme-boot.js` (classic same-origin script, no CSP change)
  re-applies the localStorage boot cache; settings.json stays the source of truth.
  `styles.css` defaults must equal the Minerva theme (unit test).
- Open VSX: network + .vsix parsing in main only (`main/theme/open-vsx.ts`: open-vsx.org and
  its CDN, byte caps, sha256, in-memory zip checks). `MINERVA_MOCK_OPEN_VSX=1` (set by the
  e2e fixture) serves an in-memory registry; e2e never hits the network.

### UI text / i18n

- English is the default; Spanish is the translation. The language lives in settings.json
  (`language`, absent = `en`), set via `settings:setLanguage`; main pushes `languageChanged`
  to every window (main + detached didactic) and each window boots with `settings:getLanguage`.
- **Renderer**: every user-visible string goes through `t()` (`react-i18next`), including
  `title`/`aria-label`/`placeholder` and error/empty states. Add the key to
  `renderer/src/i18n/locales/en.ts` (source of truth, nested by area) AND `es.ts` (typed
  `MessageShape<typeof en>`: a missing key is a typecheck error; `locales.test.ts` checks it
  at runtime too). Plurals `key_one`/`key_other` + `{ count }`, `{{name}}` interpolation,
  `<Trans>` for inline markup; never concatenate translated fragments. Dates/lists via `Intl`
  with `useLocale().locale`. Lint `i18next/no-literal-string` flags literal JSX text.
  Spanish is neutral Latin American "tú" (no voseo).
- **Main**: text the user sees (native dialogs, error messages, window titles, activity
  labels) goes through `mt(key, vars)` from `main/i18n` (`locales/en.ts` + `es.ts`, same
  typing). Error codes (`[SCM:CODE]`) never change; dev log lines stay untranslated.
- **AI**: `buildAnalyzeSystemPrompt(language)` (English instructions) asks for output in the
  UI language captured at analysis start; `DidacticAnalysis.language` records it and the
  didactic panel offers to regenerate when it differs. Mock AI: `fixtures.ts` (en) and
  `fixtures.es.ts` (es).

## Hard gotchas

1. Preload must stay **CJS** (`sandbox: true` rejects ESM); set in `electron.vite.config.ts`.
2. In main use `import.meta.dirname`, never `__dirname` (`vite:esm-shim` corrupts the bundle).
3. No **backticks** as delimiters in long main strings (same plugin regex); concatenate quotes.
4. Electron binary missing after install: `node node_modules/electron/install.js`.
5. Kill the app with `pkill -f "[e]lectron"` alone in its own command (in a compound command it can kill your shell, exit 144).
6. `architecture-beta` `[Label]`s accept only letters, digits and spaces.
7. Mermaid icon packs load via dynamic `import()` in `MermaidDiagram.tsx` (static import of `@iconify-json/logos` adds ~7 MB); packs are local because CSP is `connect-src 'self'`.
8. The mock snapshot is cached on disk by `headSha`: after editing `fixtures-snapshot.ts`, delete the `userData/snapshots/` entry and restart the app.
9. **E2E: never `_electron.launch`** (`close()` hangs, playwright#39248). `e2e/fixtures.ts` spawns Electron with `--remote-debugging-port=0` and uses `connectOverCDP`.
10. Measure nodes with the callback ref of `useElementWidth`, not `useRef` + `useEffect([])` (early returns leave the ref null).
11. A `detached: true` child outlives its parent: register its pid in the same tick as `spawn` and make async work before it cancelable (`opencode-runtime.ts`), or quitting during startup leaks a ~300 MB `opencode serve`. Every launch starts one, even with `MINERVA_MOCK_AI=1`; `e2e/opencode-sweep.ts` reaps test orphans only (never the user's opencode) and logs if it finds any. After fixing main, rebuild `dist/` (`npm run build` does not).
12. Electron-hosted terminals (VS Code, T3 Code) export `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node and die on `import … from 'electron'`: `unset` it before `npm run dev` (the e2e fixture strips it).
13. Resize windows in tests with `setViewport` in `e2e/fixtures.ts` (CDP `Emulation.setDeviceMetricsOverride`), not `page.setViewportSize()`.

## Commands

- `npm run dev` (hot reload; main changes restart) · add `-- -- --remote-debugging-port=9222` for CDP.
- `npm run build | typecheck | lint | test`; `npm run verify` = typecheck + lint + test (the CI `checks` gate).
- `npm run test:e2e` — build + Playwright (built app, mocks, isolated userData per test).
- `MINERVA_MOCK=1` mock PRs + real AI · `MINERVA_MOCK=1 MINERVA_MOCK_AI=1` fully deterministic.
- `MINERVA_MOCK_OPEN_VSX=1` in-memory Open VSX registry for theme search/install.
- `MINERVA_MOCK_GH_AUTH` / `MINERVA_MOCK_AZURE_AUTH` = `signed_in|unauthenticated|cli_unavailable`
  (mock only): force a provider's auth state. The `gh` probe is real even in mock mode, so e2e
  that assert GitHub's header/sign-in state must set `MINERVA_MOCK_GH_AUTH` (`provider-aware.spec.ts`).
- `MINERVA_MOCK_UPDATER=1|notify|error` scripted updater UI · `MINERVA_UPDATER=off` kill switch (e2e default).
- Packaging: `npm run dist:mac:dir` / `dist:mac`, `dist:dir` / `dist` (Linux).

**Updater:** two engines by capability (`src/main/updater/capability.ts`). `auto` (Windows,
writable AppImage) = `electron-updater` on the fork's GitHub releases (`RELEASE_OWNER` in
`src/main/updater/config.ts` must match `publish` in `electron-builder.yml`). `notify` (macOS,
unsigned; Linux without a writable AppImage) never loads `electron-updater`: it compares
`app.getVersion()` against the GitHub releases REST API (`release-feed.ts`, via `net.fetch`)
because electron-updater demands `latest-<platform>.yml` even to compare versions, and on a
repo with **zero releases** GitHub's `releases.atom` silently lists tags instead (the fork's
inherited `v0.2.1` ⇒ a raw 404 dump in Settings, v0.8.1). Every error crosses IPC through
`updaterErrorMessage` (`error-message.ts`): one translated/first line, never headers or a
stack. Unpackaged ⇒ disabled; release notes are never rendered; the release URL is built in
main from a semver-validated version. The fork needs at least one published release (push a
`v<package.json version>` tag; `release.yml` refuses to publish a draft missing any of the
three manifests).

## Verification (before calling anything done)

1. `npm run verify` green.
2. `npm run test:e2e` green. Wait for unambiguous signals, assert **content** (not just
   URLs/rects; `toBeVisible` needs a real box), and for layout changes exercise tiled sizes
   with `setViewport` (`responsive.spec.ts`). `packaged.spec.ts` auto-skips without a
   packaged binary: run `dist:mac:dir` (or `dist:dir`) first, never trust a stale one.
3. **Look at a screenshot.** Playwright PNGs land in `test-results/` (wiped each run). For
   the dev app: `scripts/screenshot-app.sh /tmp/shot.png [title-or-url-regex]`, then read it.
4. PR screenshots are embedded, not described: orphan `evidence-<slug>` branch with PNGs
   and a README (command + commit), linked via raw.githubusercontent.com, deleted on close.

### Dev app on macOS

```bash
MINERVA_MOCK=1 MINERVA_MOCK_AI=1 \
  npm run dev -- -- --remote-debugging-port=9222 > /tmp/minerva-dev.log 2>&1 &
curl -s http://127.0.0.1:9222/json/list   # wait ~10–15 s for a "page" target
scripts/screenshot-app.sh /tmp/shot.png   # "didactic" as 2nd arg = detached window
pkill -f "[e]lectron"                     # own command (gotcha 5)
```

`screenshot-app.sh` captures over CDP (`scripts/screenshot-cdp.mjs`, `MINERVA_CDP_PORT`);
on Linux + Hyprland it uses native capture unless `MINERVA_SCREENSHOT=cdp`.
**Linux/CI:** without a display run `npm run build && xvfb-run -a -s "-screen 0
1600x1000x24" npx playwright test`. `opencode-sweep.ts` supports Linux (`/proc`) and macOS (`ps`).

## Working with agents

Verify every delegated change yourself: typecheck, lint, unit tests, e2e, and look at the
screenshots. An agent saying "done" is not verification. Record new hard gotchas here.
