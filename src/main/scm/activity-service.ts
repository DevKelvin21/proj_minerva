/**
 * The activity inbox engine (`docs/plan-notifications.md`, step 1). The PR
 * watcher hands it every successful listing (`onListing`); it finds what is
 * new on the user's open PRs and keeps the inbox in `./activity-store.ts`.
 *
 * Which PRs: the open PRs of the watcher's listing, i.e. the provider's own
 * "involves me" set (GitHub `involves:@me`; Azure creator or reviewer).
 *
 * New comments. Threads (`getCommentThreads`) are only fetched with a reason,
 * at most `maxChecksPerTick` PRs per listing, `concurrency` at a time:
 * 1. the PR's `updatedAt` moved since its last check (GitHub bumps it on
 *    every comment, line comments included; Azure only on pushes and votes);
 * 2. the PR was never checked: its comments become the baseline SILENTLY
 *    (first launch, or a PR that just started to involve the user), the
 *    watcher's own rule against a flood of "new" on startup;
 * 3. providers whose `updatedAt` misses comments (Azure) re-check each PR
 *    once `pollIntervalMs` has passed, stalest first.
 * Comment ids are diffed against the ids known for the PR. The user's own
 * comments (`PrComment.isViewer`, matched by identity in main) never count.
 *
 * Orphans: every `orphanIntervalMs`, from the (cached) stacks result, the
 * orphan PRs the user authored. The item goes away once the PR is retargeted.
 *
 * Review events, from the listing itself (no extra calls): a reviewer's vote
 * that changed on one of MY PRs (approved, changes requested…), and a review
 * newly asked of me (added as reviewer, or re-requested after voting). Same
 * silent baseline the first time a PR is seen.
 *
 * Comment text is untrusted: `toPlainLine` flattens and caps every string
 * that ends up in an item; the renderer shows it as plain text.
 */
import {
  ACTIVITY_EXCERPT_MAX,
  type ActivityCommentItem,
  type ActivityItem,
  type ActivityOrphanItem,
  type ActivityReviewItem,
  type ActivityReviewRequestItem,
  type ActivityState,
  type MarkActivityReadRequest,
} from '../../shared/activity'
import {
  prKey,
  type RepoRef,
  type ReviewerVote,
  type ScmProviderId,
  type StackNode,
} from '../../shared/scm'
import type { CommentThread, GetStacksResult, PullRequestSummary } from '../../shared/types'
import type { ActivityData, ActivityStore, PrTrack, ReviewTrack } from './activity-store'
import { toScmError } from './errors'
import type { WatcherListResult } from './pr-watcher'

/** Providers whose PR `updatedAt` moves on every new comment (no polling needed). */
const UPDATED_AT_TRACKS_COMMENTS: Record<ScmProviderId, boolean> = {
  github: true,
  azure: false,
}

const DEFAULT_MAX_CHECKS_PER_TICK = 8
const DEFAULT_CONCURRENCY = 3
const DEFAULT_POLL_INTERVAL_MS = 3 * 60_000
const DEFAULT_ORPHAN_INTERVAL_MS = 5 * 60_000
/** Newest items kept. */
const MAX_ITEMS = 200
/** Read items older than this are dropped. */
const READ_ITEM_MAX_AGE_MS = 14 * 24 * 60 * 60_000
/** A PR not seen in any listing for this long is forgotten. */
const TRACK_MAX_AGE_MS = 30 * 24 * 60 * 60_000
const MAX_TITLE_LEN = 200
const MAX_LOGIN_LEN = 100
const MAX_PATH_LEN = 500
const MAX_BRANCH_LEN = 250
/** Provider ids longer than this are not real: the item is skipped. */
const MAX_ID_LEN = 300

export interface ActivityServiceDeps {
  store: ActivityStore
  getThreads: (repo: RepoRef, number: number) => Promise<CommentThread[]>
  /** The stacks result (cached by the stacks service). Absent = no orphan items. */
  getStacks?: () => Promise<GetStacksResult>
  /** Called after the state changed, with the items that were just added (maybe none). */
  onChange: (state: ActivityState, added: ActivityItem[]) => void
  now?: () => number
  maxChecksPerTick?: number
  concurrency?: number
  /** Re-check interval per PR for providers in `UPDATED_AT_TRACKS_COMMENTS` = false. */
  pollIntervalMs?: number
  orphanIntervalMs?: number
}

export interface ActivityService {
  /** Feeds one watcher listing. Single-flight: a listing that arrives mid-run is skipped. */
  onListing(result: WatcherListResult): Promise<void>
  get(): ActivityState
  markRead(req: MarkActivityReadRequest): ActivityState
}

// Control characters (C0, DEL, C1), soft hyphen, invisible format characters
// (zero-width, word joiner, BOM, Arabic/Mongolian marks), bidi overrides and
// isolates, and Unicode tags: all of them can hide text or make a line render
// in a misleading order. Written as escapes on purpose (no invisible literals).
const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}]/gu

/** One line of plain text: unsafe characters out, whitespace collapsed, capped with `…`. */
export function toPlainLine(text: string, max: number): string {
  const flat = text.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length <= max
    ? flat
    : chars
        .slice(0, max - 1)
        .join('')
        .trimEnd() + '…'
}

/** Runs `tasks` with at most `limit` in flight. */
async function runLimited(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++]
      await task()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

interface Due {
  pr: PullRequestSummary
  key: string
  /** Lower runs first: 0 = `updatedAt` moved, 1 = baseline, 2 = poll. */
  rank: number
  checkedAt: string
}

/** Which open PRs to check this tick, most useful first, capped. */
export function pickDue(
  open: readonly PullRequestSummary[],
  prs: ReadonlyMap<string, PrTrack>,
  now: number,
  pollIntervalMs: number,
  max: number,
): PullRequestSummary[] {
  const due: Due[] = []
  for (const pr of open) {
    const key = prKey(pr.repo, pr.number)
    const track = prs.get(key)
    if (!track) {
      due.push({ pr, key, rank: 1, checkedAt: '' })
    } else if (track.checkedUpdatedAt !== pr.updatedAt) {
      due.push({ pr, key, rank: 0, checkedAt: track.checkedAt })
    } else if (
      !UPDATED_AT_TRACKS_COMMENTS[pr.repo.provider] &&
      now - Date.parse(track.checkedAt) >= pollIntervalMs
    ) {
      due.push({ pr, key, rank: 2, checkedAt: track.checkedAt })
    }
  }
  due.sort((a, b) => a.rank - b.rank || a.checkedAt.localeCompare(b.checkedAt))
  return due.slice(0, max).map((entry) => entry.pr)
}

/**
 * The comments of `threads` that are new against `known` and not the user's,
 * as inbox items (exported for tests). `direct` = the user's own PR, or a
 * thread the user wrote in.
 */
export function newCommentItems(
  pr: PullRequestSummary,
  threads: readonly CommentThread[],
  known: ReadonlySet<string>,
): ActivityCommentItem[] {
  const key = prKey(pr.repo, pr.number)
  const isAuthor = pr.viewer?.isAuthor === true
  const items: ActivityCommentItem[] = []
  for (const thread of threads) {
    const participated = thread.comments.some((comment) => comment.isViewer === true)
    if (thread.id.length > MAX_ID_LEN) continue
    thread.comments.forEach((comment, index) => {
      if (known.has(comment.id) || comment.isViewer || comment.id.length > MAX_ID_LEN) return
      const item: ActivityCommentItem = {
        kind: 'comment',
        id: 'comment:' + key + ':' + comment.id,
        prKey: key,
        repo: pr.repo,
        number: pr.number,
        prTitle: toPlainLine(pr.title, MAX_TITLE_LEN),
        at: comment.createdAt,
        read: false,
        direct: isAuthor || participated,
        threadId: thread.id,
        commentId: comment.id,
        author: { login: toPlainLine(comment.author.login, MAX_LOGIN_LEN) },
        excerpt: toPlainLine(comment.bodyMarkdown, ACTIVITY_EXCERPT_MAX),
        isLineThread: thread.isLineThread,
        isReply: index > 0,
      }
      if (comment.author.displayName) {
        item.author.displayName = toPlainLine(comment.author.displayName, MAX_LOGIN_LEN)
      }
      // No `avatarUrl`: the inbox draws initials, and an unused URL is only risk.
      if (thread.path) item.path = toPlainLine(thread.path, MAX_PATH_LEN)
      if (thread.line !== undefined && thread.line > 0) item.line = thread.line
      if (thread.side) item.side = thread.side
      items.push(item)
    })
  }
  return items
}

function* walkStack(node: StackNode): Generator<StackNode> {
  yield node
  for (const child of node.children) yield* walkStack(child)
}

/** Orphan items for the open PRs the user authored (exported for tests). */
export function orphanItems(
  result: GetStacksResult,
  mine: ReadonlyMap<string, PullRequestSummary>,
  nowIso: string,
): ActivityOrphanItem[] {
  const items: ActivityOrphanItem[] = []
  for (const stack of result.stacks) {
    for (const node of walkStack(stack.root)) {
      const pr = mine.get(node.prKey)
      if (!node.orphan || !pr || node.state !== 'open') continue
      items.push({
        kind: 'orphan',
        id: 'orphan:' + node.prKey + ':' + node.orphan.parent.number,
        prKey: node.prKey,
        repo: node.repo,
        number: node.number,
        prTitle: toPlainLine(node.title, MAX_TITLE_LEN),
        at: nowIso,
        read: false,
        direct: true,
        parent: {
          number: node.orphan.parent.number,
          title: toPlainLine(node.orphan.parent.title, MAX_TITLE_LEN),
          mergedInto: toPlainLine(node.orphan.parent.mergedInto, MAX_BRANCH_LEN),
        },
        suggestedBase: toPlainLine(node.orphan.suggestedBase, MAX_BRANCH_LEN),
      })
    }
  }
  return items
}

/** The review state a listing shows for `pr` (exported for tests). */
export function reviewTrackOf(
  pr: PullRequestSummary,
  previous: ReviewTrack | undefined,
  nowIso: string,
): ReviewTrack {
  // Prototype-less: logins are keys.
  const votes: Record<string, ReviewerVote> = Object.create(null)
  if (pr.reviewers) {
    for (const reviewer of pr.reviewers) votes[reviewer.user.login] = reviewer.vote
  } else if (previous) {
    // A listing without reviewers keeps the last known votes.
    Object.assign(votes, previous.votes)
  }
  // Without the viewer relation the request is unknown: keep what we knew.
  const requested = pr.viewer
    ? !pr.viewer.isAuthor &&
      pr.viewer.reviewer !== null &&
      (pr.viewer.vote === undefined || pr.viewer.vote === 'none')
    : (previous?.requested ?? null)
  return { votes, requested, seenAt: nowIso }
}

function sameReviewState(a: ReviewTrack, b: ReviewTrack): boolean {
  const aKeys = Object.keys(a.votes)
  return (
    a.requested === b.requested &&
    aKeys.length === Object.keys(b.votes).length &&
    aKeys.every((login) => a.votes[login] === b.votes[login])
  )
}

/**
 * Review items between two listings of the same PR (exported for tests):
 * votes that changed to something on MY PR, and a request that just appeared.
 * `reviewers` absent = the listing did not report them: no vote is diffed.
 */
export function reviewItems(
  pr: PullRequestSummary,
  previous: ReviewTrack,
  next: ReviewTrack,
  nowIso: string,
): (ActivityReviewItem | ActivityReviewRequestItem)[] {
  const key = prKey(pr.repo, pr.number)
  const base = {
    prKey: key,
    repo: pr.repo,
    number: pr.number,
    prTitle: toPlainLine(pr.title, MAX_TITLE_LEN),
    at: nowIso,
    read: false,
  }
  const items: (ActivityReviewItem | ActivityReviewRequestItem)[] = []
  if (pr.viewer?.isAuthor && pr.reviewers) {
    for (const reviewer of pr.reviewers) {
      const vote = reviewer.vote
      if (vote === 'none' || previous.votes[reviewer.user.login] === vote) continue
      const login = toPlainLine(reviewer.user.login, MAX_LOGIN_LEN)
      const item: ActivityReviewItem = {
        ...base,
        kind: 'review',
        id: 'review:' + key + ':' + login + ':' + vote + ':' + nowIso,
        direct: true,
        reviewer: { login },
        vote,
      }
      if (reviewer.user.displayName) {
        item.reviewer.displayName = toPlainLine(reviewer.user.displayName, MAX_LOGIN_LEN)
      }
      items.push(item)
    }
  }
  if (next.requested === true && previous.requested === false) {
    const required = pr.viewer?.reviewer === 'required'
    items.push({
      ...base,
      kind: 'review_request',
      id: 'request:' + key + ':' + nowIso,
      direct: required,
      required,
    })
  }
  return items
}

/** Newest first, read items past their age dropped, capped (exported for tests). */
export function pruneItems(items: readonly ActivityItem[], now: number): ActivityItem[] {
  return items
    .filter((item) => !item.read || now - Date.parse(item.at) < READ_ITEM_MAX_AGE_MS)
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, MAX_ITEMS)
}

function toState(items: readonly ActivityItem[]): ActivityState {
  return { items: [...items], unreadCount: items.filter((item) => !item.read).length }
}

export function createActivityService(deps: ActivityServiceDeps): ActivityService {
  const now = deps.now ?? Date.now
  const maxChecks = deps.maxChecksPerTick ?? DEFAULT_MAX_CHECKS_PER_TICK
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const orphanIntervalMs = deps.orphanIntervalMs ?? DEFAULT_ORPHAN_INTERVAL_MS

  let data: ActivityData | null = null
  let running = false
  let lastOrphanCheck = Number.NEGATIVE_INFINITY

  const current = (): ActivityData => {
    data ??= deps.store.load()
    return data
  }

  const persist = (state: ActivityData): void => {
    try {
      deps.store.save(state)
    } catch (error) {
      // The in-memory state stays right; the next change retries the write.
      console.warn('[activity] could not save activity.json:', error)
    }
  }

  async function checkComments(
    state: ActivityData,
    open: readonly PullRequestSummary[],
    added: ActivityItem[],
  ): Promise<number> {
    const due = pickDue(open, state.prs, now(), pollIntervalMs, maxChecks)
    const tasks = due.map((pr) => async (): Promise<void> => {
      let threads: CommentThread[]
      try {
        threads = await deps.getThreads(pr.repo, pr.number)
      } catch (error) {
        // Left as it was: the PR is due again on the next listing.
        console.warn(
          '[activity] threads failed for',
          pr.repo.fullName,
          pr.number,
          toScmError(error).code,
        )
        return
      }
      const key = prKey(pr.repo, pr.number)
      const track = state.prs.get(key)
      if (track) {
        try {
          const fresh = newCommentItems(pr, threads, new Set(track.knownCommentIds))
          const existing = new Set(state.items.map((item) => item.id))
          for (const item of fresh) {
            if (existing.has(item.id)) continue
            state.items.push(item)
            added.push(item)
          }
        } catch (error) {
          // Malformed provider data: this PR's new comments are skipped (and
          // become known below), the rest of the listing goes on.
          console.warn(
            '[activity] could not read the comments of',
            pr.repo.fullName,
            pr.number,
            error,
          )
        }
      }
      state.prs.set(key, {
        knownCommentIds: threads.flatMap((thread) => thread.comments.map((comment) => comment.id)),
        checkedUpdatedAt: pr.updatedAt,
        checkedAt: new Date(now()).toISOString(),
      })
    })
    await runLimited(tasks, concurrency)
    return due.length
  }

  /**
   * Diffs every open PR's review state against the last listing (no API
   * calls). Returns whether any track changed (new PR, vote or request).
   */
  function checkReviews(
    state: ActivityData,
    open: readonly PullRequestSummary[],
    added: ActivityItem[],
  ): boolean {
    const nowIso = new Date(now()).toISOString()
    let changed = false
    for (const pr of open) {
      const key = prKey(pr.repo, pr.number)
      const previous = state.reviews.get(key)
      const next = reviewTrackOf(pr, previous, nowIso)
      if (!previous || !sameReviewState(previous, next)) changed = true
      if (previous) {
        for (const item of reviewItems(pr, previous, next, nowIso)) {
          state.items.push(item)
          added.push(item)
        }
      }
      state.reviews.set(key, next)
    }
    return changed
  }

  async function checkOrphans(
    state: ActivityData,
    open: readonly PullRequestSummary[],
    added: ActivityItem[],
  ): Promise<boolean> {
    if (!deps.getStacks || now() - lastOrphanCheck < orphanIntervalMs) return false
    lastOrphanCheck = now()
    let result: GetStacksResult
    try {
      result = await deps.getStacks()
    } catch (error) {
      console.warn('[activity] stacks failed:', toScmError(error).code)
      return false
    }
    const mine = new Map(
      open
        .filter((pr) => pr.viewer?.isAuthor === true)
        .map((pr) => [prKey(pr.repo, pr.number), pr]),
    )
    const found = orphanItems(result, mine, new Date(now()).toISOString())
    const foundIds = new Set(found.map((item) => item.id))
    // A provider whose stacks failed keeps its orphan items as they were.
    const failed = new Set(result.errors.map((error) => error.provider))
    const before = state.items.length
    state.items = state.items.filter(
      (item) => item.kind !== 'orphan' || failed.has(item.repo.provider) || foundIds.has(item.id),
    )
    let changed = state.items.length !== before
    const existing = new Set(state.items.map((item) => item.id))
    for (const item of found) {
      if (existing.has(item.id)) continue
      state.items.push(item)
      added.push(item)
      changed = true
    }
    return changed
  }

  return {
    async onListing(result) {
      if (running) return
      running = true
      try {
        const state = current()
        const ok = new Set(result.okProviders)
        const listed = result.items.filter((pr) => ok.has(pr.repo.provider))
        const open = listed.filter((pr) => pr.state === 'open')
        const added: ActivityItem[] = []
        const itemsBefore = state.items.length

        const checked = await checkComments(state, open, added)
        const reviewsChanged = checkReviews(state, open, added)
        const orphansChanged = await checkOrphans(state, open, added)

        // Forget closed/merged PRs, and PRs no listing has shown for a month.
        const listedState = new Map(listed.map((pr) => [prKey(pr.repo, pr.number), pr.state]))
        let forgotten = 0
        const forget = (key: string, lastSeen: string): boolean => {
          const listedAs = listedState.get(key)
          const stale = now() - Date.parse(lastSeen) > TRACK_MAX_AGE_MS
          return (
            (listedAs !== undefined && listedAs !== 'open') || (listedAs === undefined && stale)
          )
        }
        for (const [key, track] of state.prs) {
          if (forget(key, track.checkedAt)) {
            state.prs.delete(key)
            forgotten++
          }
        }
        for (const [key, track] of state.reviews) {
          if (forget(key, track.seenAt)) {
            state.reviews.delete(key)
            forgotten++
          }
        }
        state.items = pruneItems(state.items, now())
        const itemsChanged =
          added.length > 0 || orphansChanged || state.items.length !== itemsBefore
        // `seenAt` alone does not force a write; it rides along with the next one.
        if (checked > 0 || forgotten > 0 || reviewsChanged || itemsChanged) persist(state)
        if (itemsChanged) deps.onChange(toState(state.items), added)
      } finally {
        running = false
      }
    },
    get() {
      return toState(current().items)
    },
    markRead(req) {
      const state = current()
      const ids = 'ids' in req ? new Set(req.ids) : null
      let changed = false
      state.items = state.items.map((item) => {
        if (item.read || (ids && !ids.has(item.id))) return item
        changed = true
        return { ...item, read: true }
      })
      const next = toState(state.items)
      if (changed) {
        persist(state)
        deps.onChange(next, [])
      }
      return next
    },
  }
}
