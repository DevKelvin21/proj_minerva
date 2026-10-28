/**
 * `MINERVA_MOCK=1` means "mock SCM data" (the "shopwave" universe). It never
 * affects the AI layer. Kept dependency-free so the AI factory and its tests
 * can read it without pulling in the real providers.
 */
export function isMockScmMode(): boolean {
  return process.env.MINERVA_MOCK === '1'
}

/** Auth state a mock provider is forced into (tests and screenshots of signed-out states). */
export type MockAuthOverride = 'signed_in' | 'unauthenticated' | 'cli_unavailable'

const MOCK_AUTH_OVERRIDES: readonly MockAuthOverride[] = [
  'signed_in',
  'unauthenticated',
  'cli_unavailable',
]

/**
 * `MINERVA_MOCK_GH_AUTH` / `MINERVA_MOCK_AZURE_AUTH`: force a mock provider's
 * auth state. Ignored outside `MINERVA_MOCK=1` (never touches real sessions)
 * and for unknown values. `null` = no override (GitHub keeps the real `gh`
 * probe, the Azure mock stays signed in).
 */
export function mockAuthOverride(
  variable: 'MINERVA_MOCK_GH_AUTH' | 'MINERVA_MOCK_AZURE_AUTH',
): MockAuthOverride | null {
  if (!isMockScmMode()) return null
  const value = process.env[variable]
  return MOCK_AUTH_OVERRIDES.find((option) => option === value) ?? null
}

/**
 * `MINERVA_MOCK_INCOMING_COMMENT_MS`: in mock mode, a reviewer leaves a new
 * line comment on one of "my" PRs this many ms after startup (see
 * `MockGithubService.simulateIncomingComment`), so the activity inbox can be
 * exercised end to end without a real org. `null` = off (the default).
 */
export function mockIncomingCommentDelayMs(): number | null {
  return mockDelay('MINERVA_MOCK_INCOMING_COMMENT_MS')
}

/**
 * `MINERVA_MOCK_INCOMING_REVIEW_MS`: same idea for a vote: the required
 * reviewer of "my" api#482 requests changes (`simulateIncomingReview`).
 */
export function mockIncomingReviewDelayMs(): number | null {
  return mockDelay('MINERVA_MOCK_INCOMING_REVIEW_MS')
}

function mockDelay(variable: string): number | null {
  if (!isMockScmMode()) return null
  const raw = process.env[variable]
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
