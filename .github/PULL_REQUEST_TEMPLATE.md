<!--
  Pull request template for proj_minerva. Delete sections that truly do not
  apply (a section deleted on purpose beats one filled with "N/A").
  Comments like this one do not show in the rendered PR.
-->

## Summary

<!--
  Two or three lines: WHAT changes and WHY, in product language.
  A reviewer should understand the impact without opening the diff.
  Guiding principle: the PR should TEACH the change, not just show it.
-->

## Changes

<!--
  Concrete list per area. Mention the file/module when it helps.
  Group by process, which is how the app is split (see CLAUDE.md).
-->

- **main** —
- **preload / IPC contract** —
- **renderer** —
- **infra / build / CI** —
- **docs** —

## Screenshots

<!--
  REQUIRED if the PR touches the UI. The DOM can say "visible" while the user
  sees an empty panel.

  Where to get them:
  - The Playwright suite already leaves one PNG per test in `test-results/`
    (it deletes them at the start of each run, so copy them first).
  - Running dev app: `scripts/screenshot-app.sh <out.png> [title-pattern]`.

  How to upload them without dragging files through the web UI: an ORPHAN
  evidence branch with the PNGs, embedded via raw.githubusercontent.com:

      git switch --orphan evidence-<slug>
      # copy the PNGs, write a README with the provenance
      git add -A && git commit -m "docs: visual evidence for <slug>"
      git push -u origin evidence-<slug>

  and in the PR body:

      <img src="https://raw.githubusercontent.com/DevKelvin21/proj_minerva/evidence-<slug>/e2e/<file>.png" width="430">

  Delete the branch when the PR closes. The branch README must say which
  command produced the screenshots and on which commit.

  Minerva is used TILED (half screen, a quarter), so if the change touches
  layout, include at least one tiled size besides the normal one.
-->

|                            | Before | After |
| -------------------------- | ------ | ----- |
| <!-- screen / state -->    |        |       |

**Touches UI?** <!-- Yes / No. If yes and there are no screenshots above, explain why. -->

## Key decisions (scope)

<!--
  What defines this PR's scope. For each decision: what was chosen, what was
  discarded and WHY. This avoids re-litigating the same thing in three months.
-->

| Decision | Discarded alternative | Reason |
| -------- | --------------------- | ------ |
|          |                       |        |

### Out of scope (decided, not forgotten)

<!--
  What is consciously NOT included. An explicit cut is a decision;
  a silent cut looks like an oversight.
-->

-

## Verification

<!-- Tick only what you actually RAN. An unrun check is worse than an empty one. -->

- [ ] `npm run verify` (typecheck + lint + tests) green
- [ ] `npm run test:e2e` green <!-- Linux without a display: npm run build && xvfb-run -a -s "-screen 0 1600x1000x24" npx playwright test -->
- [ ] Screenshots **looked at**, not just generated (if it touches UI)
- [ ] Exercised tiled at 960×540 (if it touches layout)
- [ ] Tested against real data, not only mocks <!-- if applicable: real PR, logged-in AI provider… -->

## Security boundary

<!-- See CLAUDE.md § Security boundary. If the PR touches none of this, delete the section. -->

- [ ] No secret crosses to the renderer (tokens and sessions live only in `main`)
- [ ] New IPC channels: typed in `src/shared/` **and** validated in `src/main/ipc/validators.ts`
- [ ] New push events: concrete preload method, hardcoded channel (never a generic `on(channel, cb)`)
- [ ] Untrusted content (diffs, PR titles, comments, external feeds) is treated as such when building prompts and rendering
- [ ] The PR snapshot stays read-only for the AI tools

## Breaking changes / migration

<!--
  Does it break anything for people who already have Minerva installed, or
  for persisted settings/cache? Say exactly what they need to do.
  If nothing breaks, write "None".
-->

## References

- Plan / design doc: <!-- e.g. docs/plan-azure-devops.md -->
- Issues:
