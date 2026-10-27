import { defineConfig } from 'vitest/config'

/**
 * Vitest runs the pure-logic tests (diff parsers, file tree, language
 * inference, main-process modules) plus the pure helpers of the e2e harness
 * (`e2e/*.test.ts`; Playwright only picks up `*.spec.ts`). No DOM (jsdom) is
 * needed: those modules do not use React.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    environment: 'node',
  },
})
