# Plan: Azure DevOps + stacked PRs + PR chat

Status: analysis done (2026-10-26), nothing implemented yet.
Sources: three read-only agent reviews (GitHub coupling map, live `az` probe, architecture review).

## Verdict

Keep the core of the app. Rework three layers:

1. The source-control layer: GitHub-only today, needs to work for any provider.
2. The AI layer: one-shot today, needs sessions so you can chat about a PR.
3. The IPC plumbing: hand-written today, needs to come from schemas.

Delete the OAuth device flow and most of the process docs.

Health today: typecheck and lint are clean, and 759/759 unit tests pass. The e2e harness, the snapshot cache, the AI sandboxing and the release pipeline are good and stay.

## What we learned

### GitHub coupling is narrower than it looks

- Almost all of the GitHub-specific logic is in `src/main/github/real-service.ts` (815 LOC).
- What spreads wide is the repo shape `{owner, name, fullName}`, used in 34 files.
- The diff viewer, the comment UI, the AI prompts and the snapshot cache are already close to provider-neutral.
- The renderer only needs a unified patch per file (`DiffFile.patch`, parsed in `renderer/src/lib/diff-parser.ts`).
- Rule: **every provider hands the renderer unified patches, built in main.** With that rule, the diff UI needs no changes.

### Azure DevOps works here, with caveats (verified with read-only calls)

**Auth**
- `az account get-access-token` currently **fails**: the MSAL token cache is empty.
- `az repos` works only because of a PAT (personal access token) that `az devops login` saved in the Keychain.
- Plan: use the Microsoft Entra token from `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`. You need to run `az login` once.
- Keep the token in main's memory until shortly before it expires. Never read the PAT out of the Keychain.

**Speed**
- Each `az repos`/`az devops invoke` call takes 1–3 s, and one took 22 s.
- So use `az` **only to get the token**, then call REST from Node with `fetch`.

**Diffs**
- Azure returns no patch text, only blob ids for each changed file.
- We fetch the base and head blobs and build the patch locally with the `diff` npm package.

**Snapshot for the AI**
- The zip download of the repo at a commit works (`items?path=/&$format=zip`). Do not pass `recursionLevel=full` together with `path`: that returns a 400 error.
- The zip needs the same protections as today's tarball: size caps, no symlinks, no `..` paths.

**Retargeting**
- `az repos pr update` has no option to change the target branch.
- The only way is REST: `PATCH …/pullrequests/{id}` with `{"targetRefName": …}`. It needs the `vso.code_write` scope.
- Azure DevOps has no auto-retarget setting, so the app has to build it.

**Stacks are real in this org, and they span repos**
- One chain of branches repeats across 3 repos (Studio v2, CMS API, AI Orchestrator).
- PRs **12561, 12557 and 12495** are orphaned right now: their parent PR already completed into `main`.
- Their target branches still exist, so "branch deleted" is not a reliable signal.
- Main signal: a **completed** PR in the same repo whose `sourceRefName` equals my `targetRefName`.
- Suggested new target: that parent PR's `targetRefName`.

### AI layer: one-shot, triplicated

- Each provider throws its session away after the analysis:
  - Claude: `persistSession: false`.
  - Codex: one process per analysis.
  - OpenCode: a new session every time.
- All three CLIs support multi-turn sessions and interrupt, so chat means keeping sessions instead of discarding them.
- The three provider files (~500 LOC each) repeat the same pipeline. An orchestrator plus thin adapters (~150 LOC each) replaces them.
- The `@@@SECTION` streaming protocol is fine for the first structured analysis. Chat answers should be plain markdown, with Mermaid in code fences.

## Target architecture

```
shared/scm.ts         RepoRef = {provider:'github', owner, name} | {provider:'azure', org, project, name, repositoryId}
                      PrRef, repoKey(), prKey()
main/scm/provider.ts  ScmProvider { listPullRequests, getDetail, getFiles (always unified patch),
                      getThreads, postComment, writeSnapshot, retarget }
main/scm/github/      today's real-service + gh token bridge
main/scm/azure/       az token bridge + REST client + patch builder + zip snapshot
main/scm/stacks.ts    pure: PR list -> stack forest + orphan detection + retarget suggestion
main/scm/archive.ts   extractTarSafely / extractZipSafely (shared protections)
main/ai/session.ts    AiSession { send(turn), interrupt(), setModel(), dispose() } -> one event stream
main/ai/adapters/     claude-code | codex | opencode (transport + event mapping only)
shared/ipc-schema.ts  zod schema per channel -> validators, types and preload bindings generated
```

- IPC channels `github:*` become `scm:*`. The preload namespace follows the prefix, so this is mostly mechanical.
- The PR list fans out to every enabled provider with `allSettled`, so one failing provider doesn't blank the list.
- For Azure DevOps, the user picks orgs and projects in Settings, because `az` can't enumerate orgs cheaply.
- Retarget is the only new write action:
  - Main checks it again before sending (PR still active, new target exists).
  - The user confirms it in a dialog.
  - It is never automatic.

## Phases

| # | Phase | Size | Notes |
|---|---|---|---|
| 0 | Cleanup | S | Trim CLAUDE.md (27 KB → ~6 KB), archive `.agents/TASKS.md` (284 KB), fix the macOS dev loop (CDP screenshots, opencode sweep without `/proc`, `dist:mac`), delete the OAuth device flow (~800 LOC) |
| 1 | Provider-neutral SCM layer | M | `RepoRef` union, `scm:*` channels on zod schemas, provider registry, one `prKey()`, typed error codes, AI receives "PR context + snapshot dir" instead of a GitHub service |
| 2 | Azure DevOps provider (read) | L | az token bridge, REST client, local patch builder, zip snapshot, comment threads with status, reviewer votes, policies as "checks", mock fixtures + e2e |
| 3 | Stacks + retarget | M | Stack view in the sidebar (GitHub and Azure DevOps), cross-repo grouping by branch name, orphan badge, one-click retarget with confirm |
| 4 | AI sessions + chat | L | Session interface, chat tab in the didactic panel, interrupt, model switch, streamed tool activity |
| 5 | Renderer data layer | M | TanStack Query replaces ~16 hand-written fetch hooks (can fold into phase 1–2) |

## Open decisions

1. Fork or upstream: is this work going to `amiedygg/proj_minerva` or a fork?
2. Delete the OAuth escape hatch: recommended.
3. Code and docs language: today they are in Spanish. Switch to English?
4. `az login` once, so the app can get Entra tokens. Without it, the fallback is the slow per-call `az devops invoke`.
