# 🦉 Minerva

> Review Pull Requests and **actually understand them** before you approve.

Minerva is a desktop app (Electron) for reviewing Pull Requests **didactically**. Next to
the classic GitKraken-style diff, an AI agent explains the _impact_ of the change:
architecture diagrams, docs for new endpoints with a way to try them locally, and how
database tables evolve, with an ER diagram.

The goal: whoever approves a PR does it **understanding** what they approve.

_Originally created by Edilson ([amiedygg](https://github.com/amiedygg)). This fork is
maintained by Kelvin Rojas ([DevKelvin21](https://github.com/DevKelvin21))._

---

## ✨ Features

### PR review
- 🔐 **GitHub through your own `gh` CLI**: nothing to authorize per team, and if `gh` has
  several accounts you pick which one Minerva uses (without touching your terminal's
  active account). Azure DevOps through the `az` CLI is on the way (see Roadmap).
- 📋 Open PRs across every repo you can access, with filters, search, unread markers and
  a background watcher.
- 💬 Read comment threads (PR-level and line-level) and **comment** from the app.
- ✅ CI/check status, reviewers and approval state.

### Diff view
- 🌳 File tree with **list / tree / auto** toggle.
- ↔️ **Split** and **inline** views, syntax highlighting, optional word wrap, file-to-file
  navigation.
- 📐 Responsive for tiled windows: half and quarter screens work.

### Didactic AI panel (the differentiator)
- 🏛️ **C4 diagrams (Mermaid)** showing how the PR affects the architecture.
- 🔌 **New endpoints**: generated docs plus curl / HTTPie / `.http` snippets to try them locally.
- 🗃️ **Schema changes**: new tables and fields, with an `erDiagram`.
- ☁️ **Cloud infrastructure**: if the repo declares AWS/Cloudflare IaC (Terraform, CDK, SAM,
  serverless.yml, wrangler…), an `architecture-beta` diagram of the system and what the PR touches.
- 📚 **Didactic summary**: what changed, why it matters, risks, what to look at closely.
- ⚡ **Streaming**: the analysis appears live, section by section.
- 🤖 **Multi-provider AI**: Claude Code, Codex or OpenCode, chosen in Settings. The agent
  explores a read-only snapshot of the repo at the PR's commit. Minerva holds no API keys:
  it uses the session you already authenticated with each provider's CLI.
- 🪟 **Detachable window** with a **Re-analyze** button to compare models, and a lightbox
  with zoom/pan for diagrams.

---

## 📋 Requirements

- **Node.js 22+** (what CI uses) and npm.
- **[`gh` CLI](https://cli.github.com/)**, logged in: `gh auth login`.
- **For Azure DevOps** (in progress): the [`az` CLI](https://learn.microsoft.com/cli/azure/)
  with the `azure-devops` extension (`az extension add --name azure-devops`), then
  `az login` / `az devops login`. Configure the CLI once by hand; Minerva reads that session.
- **At least one AI CLI**, logged in: `claude login` (Claude Code), `codex login` (Codex) or
  `opencode auth login` (OpenCode, which also reaches OpenRouter, Anthropic, OpenAI…).
  Without any, the didactic panel falls back to a mock.

## 🚀 Getting started

```bash
npm install
# if the Electron binary did not download: node node_modules/electron/install.js

npm run dev                        # real GitHub through gh
MINERVA_MOCK=1 npm run dev         # demo: mock PRs ("shopwave") + real AI if a CLI is logged in

npm run verify                     # typecheck + lint + unit tests
npm run build                      # production build
```

### Environment flags

| Flag | Effect |
|------|--------|
| `MINERVA_MOCK=1` | Mock source-control data (universe "shopwave", 8 PRs). Does not affect AI. |
| `MINERVA_MOCK_AI=1` | Force the mock AI regardless of provider (deterministic demos and e2e). |
| `MINERVA_MOCK_UPDATER=1\|notify\|error` | Scripted auto-updater states, to exercise that UI unpackaged. |
| `MINERVA_UPDATER=off` | Kill switch for the auto-updater (the e2e default). |
| `MINERVA_AI_PROVIDER` / `MINERVA_AI_MODEL` | Default AI provider/model when Settings has none (default `opencode/big-pickle`). |

The AI provider and model are changed in the app (⚙️ Settings). Precedence: Settings > env > default.

---

## 🧪 Development and verification

- **Unit tests**: `npm test` (vitest).
- **E2E** (Playwright, `e2e/`): `npm run test:e2e` builds the app and runs it with mock data
  and an isolated userData per test. On Linux without a display:
  `npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test`.
- **Visual check**: start the app with CDP and capture it, then look at the image:
  ```bash
  MINERVA_MOCK=1 MINERVA_MOCK_AI=1 npm run dev -- -- --remote-debugging-port=9222
  scripts/screenshot-app.sh /tmp/shot.png     # works on macOS and Linux (CDP)
  ```
- Working conventions, architecture and gotchas: [`CLAUDE.md`](CLAUDE.md).

### Packaging

- macOS: `npm run dist:mac` (DMG + zip, arm64 and x64); `npm run dist:mac:dir` builds only the
  unpacked `.app` under `dist/mac-arm64/`, faster for testing (`e2e/packaged.spec.ts` uses it).
- Linux: `npm run dist` (AppImage) / `npm run dist:dir`. Windows is built in CI (NSIS).
- **Releases** are built by `.github/workflows/release.yml` on tag push (AppImage, NSIS, DMG/zip)
  and attached to a draft release on the fork, published once all three OSes uploaded. Binaries are
  **unsigned**: macOS Gatekeeper may say "Minerva is damaged"; the app is fine. Remove the
  quarantine flag with `xattr -cr /Applications/Minerva.app`.
- **Auto-update** uses the fork's GitHub releases. It is real on the Linux AppImage and Windows;
  on macOS (no Developer ID yet) Minerva tells you a new version exists and links to the release.
  Downloads always need your confirmation and install on quit.
- The AI CLIs are **not bundled**: Minerva calls the ones on your machine. The
  `claude-agent-sdk` native binaries are excluded from the package (see `electron-builder.yml`).

---

## 🗺️ Roadmap

Done: Electron + React scaffold, GitHub through `gh` (multi-account), PR list with
filters/watcher/unread, GitKraken-style diff, comments (read/write, Markdown), the whole
didactic panel (summary, C4, endpoints, schema + ER, run-it-locally, cloud infra), streaming,
detachable window with analysis cache, three AI providers with dynamic model catalogs,
agentic read-only analysis over a repo snapshot, tiled-window layout, auto-updater,
multi-OS releases.

Next (see [`docs/plan-azure-devops.md`](docs/plan-azure-devops.md)):

- [ ] **Azure DevOps provider** (read first): `az` token bridge, REST client, local patch
      builder, comment threads, reviewers and policies. Needs the provider-neutral source-control
      layer (`scm:*` channels, `RepoRef` union) underneath.
- [ ] **Stacked PRs and retarget**: stack view in the sidebar, orphan detection when a parent PR
      completes, one-click retarget with confirmation (GitHub and Azure DevOps).
- [ ] **Comment review workflow**: work through threads, mark resolved, reply in place.
- [ ] **AI chat about a PR**: multi-turn sessions in the didactic panel, with interrupt and model switch.
- [ ] **English UI / i18n**: the UI strings are still Spanish.

---

## 📄 License

Not defined yet.

_Named after **Minerva**, Roman goddess of wisdom, because reviewing code should teach you something._

Design references:
[GitKraken diffs](https://help.gitkraken.com/gitkraken-desktop/diff/),
[pull requests](https://help.gitkraken.com/gitkraken-desktop/pull-requests/),
[interface layout](https://help.gitkraken.com/gitkraken-desktop/interface/).

Historical logs from the original author live in [`docs/archive/`](docs/archive/) (Spanish, unmaintained).
