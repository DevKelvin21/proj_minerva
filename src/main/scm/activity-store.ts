/**
 * Persistence of the activity inbox (`docs/plan-notifications.md`):
 * `activity.json` in `userData`. Same rules as `./seen-store.ts`: the path is
 * resolved lazily (the app may not be `ready` at import), the read is
 * tolerant (missing, corrupt or another version = empty state, never a
 * throw), and the write is atomic (tmp + rename).
 *
 * It holds three things:
 * - per PR (`prKey`), the comment ids already known and when the PR was last
 *   checked, so a restart neither re-reports old comments nor floods;
 * - per PR, the reviewer votes and "asked to review me" of the last listing;
 * - the inbox items themselves, with their read flag.
 * Pruning (caps, age) is the service's job; the store only loads and saves.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isActivityItem, type ActivityItem } from '../../shared/activity'
import type { ReviewerVote } from '../../shared/scm'

const ACTIVITY_STORE_VERSION = 1

/** What the service remembers about one tracked PR. */
export interface PrTrack {
  /** Every comment id seen on the PR at the last successful check. */
  knownCommentIds: string[]
  /** The PR's `updatedAt` at that check (GitHub: unchanged = nothing to fetch). */
  checkedUpdatedAt: string
  /** When that check ran (ISO). Drives the round-robin re-checks. */
  checkedAt: string
}

/**
 * Review state of one PR at the last listing, diffed to find new votes on my
 * PRs and new review requests (no extra API calls: listings carry it).
 */
export interface ReviewTrack {
  /** Reviewer login -> vote. */
  votes: Record<string, ReviewerVote>
  /** I am asked to review and have not voted; `null` = unknown (identity not resolved). */
  requested: boolean | null
  /** When a listing last showed the PR (ISO). */
  seenAt: string
}

export interface ActivityData {
  prs: Map<string, PrTrack>
  reviews: Map<string, ReviewTrack>
  items: ActivityItem[]
}

export interface ActivityStore {
  load(): ActivityData
  save(data: ActivityData): void
}

interface PersistedActivity {
  version: typeof ACTIVITY_STORE_VERSION
  prs: Record<string, PrTrack>
  /** Absent in files written before review events. */
  reviews?: Record<string, ReviewTrack>
  items: ActivityItem[]
}

function emptyData(): ActivityData {
  return { prs: new Map(), reviews: new Map(), items: [] }
}

const VOTES: readonly ReviewerVote[] = [
  'approved',
  'approved_with_suggestions',
  'none',
  'changes_requested',
  'rejected',
]

function isReviewTrack(value: unknown): value is ReviewTrack {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.votes === 'object' &&
    v.votes !== null &&
    !Array.isArray(v.votes) &&
    Object.values(v.votes).every((vote) => VOTES.includes(vote as ReviewerVote)) &&
    (v.requested === null || typeof v.requested === 'boolean') &&
    typeof v.seenAt === 'string'
  )
}

function isPrTrack(value: unknown): value is PrTrack {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.knownCommentIds) &&
    v.knownCommentIds.every((id) => typeof id === 'string') &&
    typeof v.checkedUpdatedAt === 'string' &&
    typeof v.checkedAt === 'string'
  )
}

/** Parses the file's JSON; anything unexpected is dropped piece by piece, never thrown. */
function fromPersisted(value: unknown): ActivityData {
  if (typeof value !== 'object' || value === null) return emptyData()
  const v = value as Record<string, unknown>
  if (v.version !== ACTIVITY_STORE_VERSION) return emptyData()
  const data = emptyData()
  if (typeof v.prs === 'object' && v.prs !== null && !Array.isArray(v.prs)) {
    for (const [key, track] of Object.entries(v.prs)) {
      if (isPrTrack(track)) data.prs.set(key, track)
    }
  }
  if (typeof v.reviews === 'object' && v.reviews !== null && !Array.isArray(v.reviews)) {
    for (const [key, track] of Object.entries(v.reviews)) {
      if (isReviewTrack(track)) {
        // Prototype-less: logins are keys, and a `__proto__` login must stay data.
        data.reviews.set(key, { ...track, votes: Object.assign(Object.create(null), track.votes) })
      }
    }
  }
  if (Array.isArray(v.items)) data.items = v.items.filter(isActivityItem)
  return data
}

/** `filePath` is called on each load/save, so `app.getPath` stays lazy. */
export function createActivityStore(filePath: () => string): ActivityStore {
  return {
    load() {
      let raw: string
      try {
        raw = readFileSync(filePath(), 'utf-8')
      } catch {
        return emptyData()
      }
      try {
        return fromPersisted(JSON.parse(raw))
      } catch (error) {
        console.warn('[activity-store] activity.json could not be parsed, ignoring it:', error)
        return emptyData()
      }
    },
    save(data) {
      const persisted: PersistedActivity = {
        version: ACTIVITY_STORE_VERSION,
        prs: Object.fromEntries(data.prs),
        reviews: Object.fromEntries(data.reviews),
        items: data.items,
      }
      const finalPath = filePath()
      const tmpPath = finalPath + '.tmp'
      writeFileSync(tmpPath, JSON.stringify(persisted) + '\n', 'utf-8')
      renameSync(tmpPath, finalPath)
    },
  }
}
