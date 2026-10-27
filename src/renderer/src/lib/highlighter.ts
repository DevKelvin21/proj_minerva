/**
 * Syntax highlighting con Shiki para la vista de diff (T7).
 *
 * Decisiones:
 * - Singleton lazy: `createHighlighterCore` carga gramáticas/tema una sola
 *   vez, la primera vez que se pide highlighting; llamadas siguientes reusan
 *   la misma promesa.
 * - Se usa `shiki/core` + `createHighlighterCore` con imports estáticos por
 *   lenguaje (`@shikijs/langs/<lang>`) en vez del `createHighlighter` del
 *   paquete `shiki` a secas: ese último bundlea los ~200 lenguajes que trae
 *   Shiki de fábrica como chunks separados (el build de T7 los emitía todos,
 *   varios cientos de KB de más), aunque solo pasáramos 10 nombres — Rollup no
 *   puede tree-shakear el mapa interno de lenguajes soportados. Importando
 *   los módulos de gramática puntuales el bundle solo incluye lo que se usa.
 * - Motor de regex en JavaScript puro (`createJavaScriptRegexEngine`), no el
 *   de Oniguruma/WASM: evita tener que servir un asset `.wasm` extra desde el
 *   proceso renderer empaquetado y su instanciación async, a costa de un
 *   soporte de gramáticas ligeramente menos preciso en casos borde — aceptable
 *   para el set acotado de lenguajes que usamos aquí.
 * - Set de lenguajes acotado a los que realmente aparecen en diffs de este
 *   producto (ver `SUPPORTED_LANGS`); cualquier otra extensión cae a texto
 *   plano sin highlighting. La T21 sumó `dotenv`/`http`/`docker`/`diff`/
 *   `python` para cubrir los snippets didácticos (setup/endpoint) y los
 *   fences de Markdown compartido, reutilizando este mismo singleton y tema
 *   (`highlightCode` + `resolveSnippetLang` más abajo).
 * - **Limitación aceptada**: se resalta LÍNEA POR LÍNEA (`codeToTokensBase`
 *   sobre el contenido de una sola línea del diff), no el archivo completo.
 *   Esto es necesario porque un diff no tiene "el archivo completo" de forma
 *   directa (mezcla líneas old/new), pero significa que construcciones que
 *   dependen de contexto multilínea (comentarios de bloque `/* ... *\/`
 *   partidos entre líneas, template literals multilínea, etc.) no se
 *   tokenizan con precisión: cada línea se colorea como si fuera un
 *   fragmento aislado de código.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import githubDarkDefault from '@shikijs/themes/github-dark-default'
import githubLightDefault from '@shikijs/themes/github-light-default'
import type { CSSProperties } from 'react'
import typescript from '@shikijs/langs/typescript'
import tsx from '@shikijs/langs/tsx'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import sql from '@shikijs/langs/sql'
import css from '@shikijs/langs/css'
import html from '@shikijs/langs/html'
import markdown from '@shikijs/langs/markdown'
import yaml from '@shikijs/langs/yaml'
import bash from '@shikijs/langs/bash'
import dotenv from '@shikijs/langs/dotenv'
import http from '@shikijs/langs/http'
import docker from '@shikijs/langs/docker'
import diff from '@shikijs/langs/diff'
import python from '@shikijs/langs/python'
import toml from '@shikijs/langs/toml'

/**
 * Every token is colored for both appearances at once (Shiki's multi-theme
 * tokens): the span carries `--shiki-light` / `--shiki-dark` and `styles.css`
 * picks one by `data-appearance`, so switching themes never re-tokenizes.
 */
export const SHIKI_THEMES = { light: 'github-light-default', dark: 'github-dark-default' } as const

const SUPPORTED_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'json',
  'sql',
  'css',
  'html',
  'markdown',
  'yaml',
  'bash',
  'dotenv',
  'http',
  'docker',
  'diff',
  'python',
  'toml',
] as const

export type SupportedLang = (typeof SUPPORTED_LANGS)[number]

const LANG_MODULES: Record<SupportedLang, LanguageRegistration[]> = {
  typescript,
  tsx,
  javascript,
  json,
  sql,
  css,
  html,
  markdown,
  yaml,
  bash,
  dotenv,
  http,
  docker,
  diff,
  python,
  toml,
}

const EXTENSION_TO_LANG: Record<string, SupportedLang> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  sql: 'sql',
  css: 'css',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  // T21-bis: la vista de diff nunca resaltó archivos que la T21 sí cubría en
  // los fences/snippets didácticos — este mapa (por EXTENSIÓN de path) no se
  // actualizó junto con las gramáticas nuevas. Reportado por Edilson con un
  // PR real de Python que se veía plano.
  py: 'python',
  pyi: 'python',
  toml: 'toml',
  env: 'dotenv',
  http: 'http',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'docker',
}

/**
 * Infiere el lenguaje de shiki a partir del path. `null` si no hay soporte.
 * Primero por nombre de archivo completo (casos sin extensión útil:
 * `Dockerfile`, `.env`, `.env.example`), después por extensión.
 */
export function inferLanguage(path: string): SupportedLang | null {
  const basename = (path.split('/').pop() ?? path).toLowerCase()
  if (basename === 'dockerfile' || basename.startsWith('dockerfile.')) return 'docker'
  if (basename === '.env' || basename.startsWith('.env.')) return 'dotenv'

  const match = /\.([a-zA-Z0-9]+)$/.exec(basename)
  if (!match) return null
  return EXTENSION_TO_LANG[match[1]] ?? null
}

let highlighterPromise: Promise<HighlighterCore> | null = null

/** Singleton lazy del highlighter de shiki, con el tema y set de lenguajes acotados. */
export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDarkDefault, githubLightDefault],
      langs: SUPPORTED_LANGS.map((lang) => LANG_MODULES[lang]),
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

export interface HighlightToken {
  content: string
  light?: string
  dark?: string
}

/** Inline style for a token span (custom properties only; paired with the `shiki-token` class). */
export function tokenStyle(token: HighlightToken): CSSProperties | undefined {
  if (!token.light && !token.dark) return undefined
  return { '--shiki-light': token.light, '--shiki-dark': token.dark } as CSSProperties
}

export function tokenClass(token: HighlightToken): string | undefined {
  return token.light || token.dark ? 'shiki-token' : undefined
}

function toHighlightToken(token: {
  content: string
  variants: Record<string, { color?: string }>
}): HighlightToken {
  return {
    content: token.content,
    light: token.variants.light?.color,
    dark: token.variants.dark?.color,
  }
}

/**
 * Resalta una única línea de código de forma aislada (ver limitación en el
 * comentario de arriba del archivo). Si `lang` es `null` devuelve el
 * contenido tal cual, sin tokens de color.
 */
export async function highlightLine(
  content: string,
  lang: SupportedLang | null,
): Promise<HighlightToken[]> {
  if (!lang) return [{ content }]

  const highlighter = await getHighlighter()
  try {
    const tokenLines = highlighter.codeToTokensWithThemes(content, { lang, themes: SHIKI_THEMES })
    const tokens = tokenLines[0] ?? []
    if (tokens.length === 0) return [{ content }]
    return tokens.map(toHighlightToken)
  } catch {
    // Contenido no tokenizable (p. ej. gramática que no soporta el fragmento
    // aislado) — se degrada a texto plano en vez de romper la vista de diff.
    return [{ content }]
  }
}

/**
 * Resalta un bloque de código MULTILÍNEA completo (snippets didácticos,
 * fences de Markdown). A diferencia de `highlightLine`, aquí sí existe "el
 * archivo completo" del fragmento de forma directa (no es un diff mezclando
 * old/new línea a línea), así que se tokeniza todo de una sola vez con
 * `codeToTokensBase` y construcciones que dependen de contexto entre líneas
 * (comentarios de bloque partidos, etc.) se resuelven con precisión. Si
 * `lang` es `null` o el contenido no es tokenizable, degrada a texto plano:
 * una línea de entrada -> una línea de salida con un único token sin color.
 */
export async function highlightCode(
  code: string,
  lang: SupportedLang | null,
): Promise<HighlightToken[][]> {
  if (!lang) return toPlainLines(code)

  const highlighter = await getHighlighter()
  try {
    const tokenLines = highlighter.codeToTokensWithThemes(code, { lang, themes: SHIKI_THEMES })
    if (tokenLines.length === 0) return toPlainLines(code)
    return tokenLines.map((line) =>
      line.length === 0 ? [{ content: '' }] : line.map(toHighlightToken),
    )
  } catch {
    // Código raro que la gramática no puede tokenizar completo — se degrada
    // a texto plano en vez de romper el panel didáctico o el Markdown.
    return toPlainLines(code)
  }
}

function toPlainLines(code: string): HighlightToken[][] {
  return code.split('\n').map((line) => [{ content: line }])
}

/**
 * Mapa de lenguajes del dominio (snippets didácticos `curl`/`env`/`bash`/
 * `http`, más aliases comunes de fences de Markdown: `sh`, `py`, `dockerfile`,
 * etc.) a un `SupportedLang` de shiki. Reutiliza `EXTENSION_TO_LANG` (mismos
 * nombres que ya resuelve `inferLanguage` por extensión) y le suma los
 * aliases que no son extensión de archivo. Cualquier lenguaje desconocido
 * cae a `null` (texto plano), sin romper el render.
 */
const SNIPPET_LANG_ALIASES: Record<string, SupportedLang> = {
  ...EXTENSION_TO_LANG,
  typescript: 'typescript',
  javascript: 'javascript',
  jsonc: 'json',
  curl: 'bash',
  shell: 'bash',
  zsh: 'bash',
  env: 'dotenv',
  dotenv: 'dotenv',
  http: 'http',
  docker: 'docker',
  dockerfile: 'docker',
  diff: 'diff',
  py: 'python',
  python: 'python',
}

/** Resuelve el lenguaje de un snippet didáctico o de un fence de Markdown a un `SupportedLang`. */
export function resolveSnippetLang(language: string): SupportedLang | null {
  return SNIPPET_LANG_ALIASES[language.toLowerCase()] ?? null
}
