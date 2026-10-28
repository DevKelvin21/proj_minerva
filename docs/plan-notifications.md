# Plan: activity inbox + notifications

Status (2026-10-28): steps 1–3 and the review events of step 4 done on `feat/activity-inbox`.
The "N new" chip in the review header is not built yet (see step 4). Verified: `npm run verify`, `npm run test:e2e`, and a live mock run where the scripted
comment reached `activity:get`. GitHub's PR `updatedAt` was checked against real data and does move
on line comments (microsoft/vscode#344792, #344785: `updatedAt` equals the last review comment).

## Goal

Tell the user when something on their PRs needs them: a new comment (on a line, on a file
or on the conversation), a review event, or an orphaned PR they own that needs a retarget.
It must stay calm: one quiet Inbox, a badge, and batched system notifications for what is
aimed at the user directly. Each item opens the review view right at that comment.

## What exists today, and why it is not enough

- **The PR watcher** (`main/scm/pr-watcher.ts`) polls `listPullRequests({ state: 'all' })`
  every 60 s and pushes `prListChanged`. The renderer only uses it to refetch lists.
- **GitHub's comment count misses line comments.** The list query reads
  `comments { totalCount }`, which counts conversation comments only, not review (line)
  comments. So `new_comments` never fires for the comments a reviewer leaves on code.
- **Azure reports no comment count** (`commentCount: null`) and its derived `updatedAt`
  does not move on comments (see the header of `azure/azure-provider.ts`).
- **Nothing alerts the user:** no dock badge, no system notification.
- **Deep links half-exist.** `openLineThread(path, line, threadId)` focuses a line thread,
  but `selectPr` clears that focus, and conversation threads have no focus path.
- **Orphans** are detected by `stacks-service` but only shown as a count on the Stacks tab,
  and ownership is not checked.

## Design

### 1. Activity engine (main)

`main/scm/activity-service.ts`, driven by the watcher (`onTick`, after every successful
listing). It tracks the **open PRs of the watcher listing**: the provider's own "involves
me" set (GitHub `involves:@me`: author, reviewer, commenter, mentioned; Azure: creator or
reviewer).

- **New comments.** Threads are fetched (`ScmProvider.getCommentThreads`) only when there is
  a reason:
  - GitHub: the PR's `updatedAt` moved since the last check (review comments bump it; checked).
  - Azure: `updatedAt` does not move on comments, so PRs are re-checked round-robin, the
    stalest first, each one at most every 3 minutes.
  - At most 6 PRs are checked per tick (3 at a time); the rest wait for the next tick.
  - Comment ids are diffed against the ids known for that PR (`activity.json`).
  - The user's own comments are skipped: `PrComment.isViewer`, matched by identity in main
    (GitHub `viewerDidAuthor`; Azure the `connectionData` identity id).
- **Orphans the user owns.** Every 5 minutes, from the cached `stacks-service` result: an
  orphan node whose PR the user authored (`viewer.isAuthor` in the watcher listing). The
  item goes away by itself once the PR is retargeted.
- **Review events** (step 4, built): reviewer votes and "asked to review me" are diffed
  between listings (persisted per PR in `activity.json`, silent baseline). A vote that
  changed on MY PR (approved, with suggestions, changes requested, rejected) and a review
  newly asked of me (added, or re-requested after voting; required = direct, optional = not)
  become items. An unknown identity (`viewer` absent) never fires a request once it
  resolves. No extra API calls.
- **No flood.** The first time a PR is seen, its comments become the baseline silently (the
  watcher's own rule). That covers first launch and newly involved PRs.
- **Direct vs. everything.** An item is `direct` when it is on the user's own PR, or a
  reply in a thread the user already wrote in. Everything else is "everything" level.

Each comment item carries what a deep link needs (PR key, thread id, comment id, file,
line, side) plus author, time and a short excerpt. Comment text is **untrusted**: main
flattens it to one line, strips control characters and caps it (160 chars); the renderer
shows it as plain text, never Markdown.

State: `activity.json` in `userData` (atomic write, tolerant read, versioned): per-PR known
comment ids + last check, and the items (newest 200 kept; read items older than 14 days
are dropped).

IPC: `activity:get` (the full state) and `activity:markRead` (`ids`, or `all`), both
validated; push `activityChanged` with the full state (like the updater), so a late window
never rebuilds anything.

### 2. Inbox in the sidebar

A fourth sidebar tab next to Queue, Repos and Stacks, grouped by PR:

```
Inbox                         Mark all read
─────────────────────────────────────────────
● #142 Add billing webhooks      shopwave/api
   ana · src/billing/hook.ts:48   2h
   "Should this retry on 409?"
   ana · conversation             2h
  #138 Refactor auth middleware
   ⚠ Base branch was merged. Retarget →
```

- Unread = a small accent dot. No bold color blocks; read items fade.
- Click a line comment: the PR opens on the Files tab, file selected, thread open and
  centered. Any other comment (conversation, file-level, outdated): the Conversation tab
  with the thread highlighted. An orphan: the PR itself, whose header already shows the
  orphan warning and the one-click retarget.
- New store action `openPrAt(pr, target)` selects the PR and arms the focus together
  (`selectPr` alone clears it). New focus path for conversation threads.
- Read when opened from the Inbox, per PR (✓✓ on its header), or with "Mark all read".
  (Marking read when a thread merely scrolls into view in the review was left out: too easy
  to clear something without reading it.)
- Opening an item for a PR that is already open refetches its threads first
  (`threadsRefreshToken`), so a comment that arrived after the PR was opened is there to
  land on. Focus requests wait for their thread instead of giving up.
- The collapsed rail shows the same unread count.

### 3. Notifications

- Dock / taskbar badge with the unread count (`app.setBadgeCount`). On by default; set at
  startup from the saved inbox.
- System notifications only for `direct` items, one per tick ("3 new comments on 2 PRs"),
  only while the window is not focused. Clicking one focuses the app and opens the item.
- Settings → Notifications: Off / Direct only (default) / Everything, plus the badge toggle
  (`settings.json` `notifications`, `settings:get|setNotifications`).
- Rules live in `main/notifications/activity-notifier.ts` (pure, unit-tested); a click
  pushes `openActivity` to the main window only (one item opens at its thread, a batch
  opens the Inbox). The native notification and the dock badge themselves are not covered
  by e2e (no way to observe them over CDP).
- macOS build is unsigned: the first notification may prompt for permission, and dev builds
  show as "Electron". The badge works regardless.

### 4. Extras

- Review-event items (votes diff): built.
- Not built yet: an "N new" chip in the PR header that steps through unread threads (`N`).
  The Inbox already deep-links to each thread, so this is a convenience, left for a
  follow-up.

## Decisions (2026-10-28, defaults accepted)

- Tracked PRs: mine, ones I review, and threads I commented in (the provider's involves set).
- The Inbox lives in the sidebar, not a title bar popover.
- System notifications default to "Direct only".

## Known limits

- GitHub threads come from `reviewThreads(first: 100)` / `comments(first: 100)` (the same
  query the review view uses): comments past the first 100 of a PR are not seen.
- A comment edited later is not reported again (ids only).
- Azure comments arrive with up to ~3 minutes of delay per PR (round-robin).

## Build order

1. **Engine** (main): `isViewer`, activity store + service, watcher hook, IPC + preload,
   mock incoming comment (`MINERVA_MOCK_INCOMING_COMMENT_MS`), unit tests.
2. **Inbox UI**: sidebar tab, rail badge, `openPrAt`, conversation thread focus, en + es
   strings, e2e at tiled sizes.
3. **Notifications**: badge, batched system notifications, Settings section.
4. **Extras**: review events (built); "new since you looked" chip (follow-up).
