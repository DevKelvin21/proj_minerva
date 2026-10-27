/**
 * `MINERVA_MOCK=1` means "mock SCM data" (the "shopwave" universe). It never
 * affects the AI layer. Kept dependency-free so the AI factory and its tests
 * can read it without pulling in the real providers.
 */
export function isMockScmMode(): boolean {
  return process.env.MINERVA_MOCK === '1'
}
