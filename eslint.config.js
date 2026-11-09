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
    // One way into the icon set: a meaning from `components/ui/icons.ts`,
    // rendered by `<Icon icon={icons.retry} size="sm" />` (`ui/Icon.tsx`,
    // whose `IconSize` type also rules out pixel sizes and stroke widths).
    // The logos set is banned statically too: it adds ~7 MB (CLAUDE.md
    // gotcha 7); MermaidDiagram loads it with a dynamic `import()`, which
    // this rule does not see, and brand marks are copied into `ui/brand-marks.ts`.
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/components/ui/icons.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              message:
                "Use the icon registry: import { icons } from 'components/ui/icons' and render <Icon icon={icons.<meaning>} size=\"xs|sm|md|lg\" /> from 'components/ui/Icon'. If no meaning fits, add one key to icons.ts.",
            },
            {
              name: '@iconify-json/logos',
              message:
                'Never import the logos set statically (~7 MB, CLAUDE.md gotcha 7). Brand marks live in components/ui/brand-marks.ts.',
            },
          ],
          patterns: [
            {
              group: ['lucide-react/*', '@iconify-json/logos/*'],
              message: 'Use components/ui/icons.ts (UI icons) or components/ui/brand-marks.ts (brand marks).',
            },
          ],
        },
      ],
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
