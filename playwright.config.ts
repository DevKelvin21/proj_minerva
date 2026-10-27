import { defineConfig } from '@playwright/test'

/**
 * E2E con Playwright: cada test lanza la app CONSTRUIDA (out/) con GitHub e
 * IA mock y un userData aislado — ver `e2e/fixtures.ts` (spawn propio +
 * connectOverCDP, NO _electron: gotcha 10 de CLAUDE.md). Correr con
 * `npm run test:e2e` (hace el build antes). Única suite e2e desde 2026-07-25
 * (las smoke CDP legacy fueron retiradas al completar la migración).
 */
export default defineConfig({
  testDir: './e2e',
  // `*.test.ts` files in e2e/ are vitest unit tests of the harness helpers.
  testMatch: '**/*.spec.ts',
  // Red de seguridad de recursos: mata los `opencode serve` que se hayan
  // escapado (timeout de un test, SIGKILL al worker, crash de Electron). Cada
  // uno pesa ~300 MB; ver `e2e/global-teardown.ts`.
  globalTeardown: './e2e/global-teardown.ts',
  // La IA es mock (~1s) pero el análisis descarga snapshot + renderiza
  // mermaid lazy; margen amplio por test.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Una sola instancia de Electron a la vez: los tests comparten pantalla y
  // los lanzamientos concurrentes de la app se pelean por recursos gráficos.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
})
