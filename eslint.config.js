import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import eslintConfigPrettier from 'eslint-config-prettier'
import i18next from 'eslint-plugin-i18next'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.mjs', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Scripts de smoke test standalone (T4): usan `cond ? ok() : fail()` como
    // atajo de control de flujo en vez de if/else, a propósito.
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // UI text goes through `t()` (src/renderer/src/i18n): no literal text in
    // JSX, nor in the attributes users read (tooltips, labels, placeholders).
    files: ['src/renderer/src/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            include: ['title', 'aria-label', 'placeholder', 'alt', 'label', 'aria-description'],
          },
          words: {
            // Symbols, numbers, single glyphs and brand names are not text to translate.
            exclude: [
              '[0-9!-/:-@[-`{-~\\s·•…—–→←↑↓×✓✕⋯]+',
              '[A-Z_-]+',
              'Minerva',
              'GitHub',
              'Azure DevOps',
              // Decorative emoji (the defaults this list replaces included them).
              /^[\p{Extended_Pictographic}\s]+$/u,
            ],
          },
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  eslintConfigPrettier,
)
