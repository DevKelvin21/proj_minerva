/**
 * Persistence of the activity inbox (`docs/plan-notifications.md`):
 * `activity.json` in `userData`. Same rules as `./seen-store.ts`: the path is
 * resolved lazily (the app may not be `ready` at import), the read is
 * tolerant (missing, corrupt or another version = empty state, never a
 * throw), and the write is atomic (tmp + rename).
 *
 * It holds two things:
 * - per PR (`prKey`), the comment ids already known and when the PR was last
 *   checked, so a restart neither re-reports old comments nor floods;
 * - the inbox items themselves, with their read flag.
 * Pruning (caps, age) is the service's job; the store only loads and saves.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isActivityItem, type ActivityItem } from '../../shared/activity'

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

export interface ActivityData {
  prs: Map<string, PrTrack>
  items: ActivityItem[]
}

export interface ActivityStore {
  load(): ActivityData
  save(data: ActivityData): void
}

interface PersistedActivity {
  version: typeof ACTIVITY_STORE_VERSION
  prs: Record<string, PrTrack>
  items: ActivityItem[]
}

function emptyData(): ActivityData {
  return { prs: new Map(), items: [] }
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
        items: data.items,
      }
      const finalPath = filePath()
      const tmpPath = finalPath + '.tmp'
      writeFileSync(tmpPath, JSON.stringify(persisted) + '\n', 'utf-8')
      renameSync(tmpPath, finalPath)
    },
  }
}
