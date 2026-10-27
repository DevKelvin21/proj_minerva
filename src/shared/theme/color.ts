/**
 * Strict color parsing and the color math behind themes.
 *
 * Theme colors come from untrusted places (imported theme files, VS Code
 * themes, Open VSX packages, hand-edited settings.json), and they end up as
 * CSS custom property values. So a value is never passed through: it is
 * parsed into numbers by the grammar below and re-printed in one canonical
 * form, `oklch(L C h)` or `oklch(L C h / a)`. Anything the parser does not
 * understand is rejected, which makes CSS injection through a color
 * impossible by construction.
 *
 * Accepted input: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`,
 * `hsl()`/`hsla()` (comma or space syntax), `oklch()`, `oklab()`,
 * `color(srgb|srgb-linear|display-p3 …)` and `transparent`. Named colors are
 * not accepted.
 *
 * The OKLCH/sRGB conversion, gamut mapping and contrast helpers are ported
 * from T3 Code (`apps/web/src/themePalette.ts`, https://github.com/pingdotgg/t3code),
 * MIT License, Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.
 * The parser is ours (T3 Code uses culori). Pure TypeScript: main uses it to
 * validate settings and the renderer to build palettes.
 */

export interface ThemeRgb {
  r: number
  g: number
  b: number
}

export interface ThemeOklch {
  L: number
  C: number
  h: number
}

export interface ParsedThemeColor {
  color: ThemeOklch
  alpha: number
}

/** Longest color string we even try to parse (real ones are < 40 chars). */
export const MAX_COLOR_LENGTH = 128

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?'
const NUMBER_RE = new RegExp('^' + NUMBER + '$', 'i')

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A bare number (`0.5`), never `NaN`/`Infinity`. */
function parseNumber(token: string): number | null {
  if (!NUMBER_RE.test(token)) return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

/** `50%` -> 0.5 * scale; `0.5` -> 0.5 (or the raw number when `percentScale` is the unit). */
function parseNumberOrPercent(token: string, percentScale: number): number | null {
  if (token.endsWith('%')) {
    const value = parseNumber(token.slice(0, -1))
    return value === null ? null : (value / 100) * percentScale
  }
  return parseNumber(token)
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1
  if (token.toLowerCase() === 'none') return 0
  const value = parseNumberOrPercent(token, 1)
  return value === null ? null : clamp(value, 0, 1)
}

function parseHue(token: string): number | null {
  if (token.toLowerCase() === 'none') return 0
  const match = /^(.*?)(deg|grad|rad|turn)?$/i.exec(token)
  if (!match) return null
  const value = parseNumber(match[1])
  if (value === null) return null
  switch ((match[2] ?? 'deg').toLowerCase()) {
    case 'grad':
      return value * 0.9
    case 'rad':
      return (value * 180) / Math.PI
    case 'turn':
      return value * 360
    default:
      return value
  }
}

/**
 * Splits the argument list of a CSS color function into channels and an
 * optional alpha: modern `a b c / alpha` or legacy `a, b, c[, alpha]`.
 */
function splitArguments(body: string): { channels: string[]; alpha?: string } | null {
  const trimmed = body.trim()
  if (trimmed.includes(',')) {
    if (trimmed.includes('/')) return null
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.some((part) => part.length === 0 || /\s/.test(part))) return null
    if (parts.length === 3) return { channels: parts }
    if (parts.length === 4) return { channels: parts.slice(0, 3), alpha: parts[3] }
    return null
  }
  const [channelPart, alphaPart, extra] = trimmed.split('/')
  if (extra !== undefined) return null
  const channels = channelPart.trim().split(/\s+/)
  if (channels.length !== 3 || channels.some((part) => part.length === 0)) return null
  if (alphaPart === undefined) return { channels }
  const alpha = alphaPart.trim()
  if (alpha.length === 0 || /\s/.test(alpha)) return null
  return { channels, alpha }
}

interface RgbaColor extends ThemeRgb {
  a: number
}

function parseHex(value: string): RgbaColor | null {
  const hex = value.slice(1)
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null
  const expand = (part: string): number =>
    part.length === 1 ? Number.parseInt(part + part, 16) : Number.parseInt(part, 16)
  if (hex.length <= 4) {
    return {
      r: expand(hex[0]),
      g: expand(hex[1]),
      b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
    }
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  }
}

function parseRgbFunction(body: string): RgbaColor | null {
  const args = splitArguments(body)
  if (!args) return null
  const channels = args.channels.map((token) => parseNumberOrPercent(token, 255))
  const alpha = parseAlpha(args.alpha)
  if (channels.some((channel) => channel === null) || alpha === null) return null
  const [r, g, b] = channels as number[]
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: alpha }
}

function hslToRgb(h: number, s: number, l: number): ThemeRgb {
  const hue = ((h % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - chroma / 2
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

function parseHslFunction(body: string): RgbaColor | null {
  const args = splitArguments(body)
  if (!args) return null
  const hue = parseHue(args.channels[0])
  const saturation = parseNumberOrPercent(args.channels[1], 1)
  const lightness = parseNumberOrPercent(args.channels[2], 1)
  const alpha = parseAlpha(args.alpha)
  if (hue === null || saturation === null || lightness === null || alpha === null) return null
  // Bare numbers in modern hsl() are percentages (`hsl(120 50 50)`).
  const s = args.channels[1].endsWith('%') ? saturation : saturation / 100
  const l = args.channels[2].endsWith('%') ? lightness : lightness / 100
  return { ...hslToRgb(hue, clamp(s, 0, 1), clamp(l, 0, 1)), a: alpha }
}

function decodeGamma(value: number): number {
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  return sign * (abs <= 0.04045 ? abs / 12.92 : ((abs + 0.055) / 1.055) ** 2.4)
}

function encodeGamma(value: number): number {
  const clamped = clamp(value, 0, 1)
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
}

function parseColorFunction(body: string): RgbaColor | null {
  const match = /^\s*(srgb|srgb-linear|display-p3)\s+(.*)$/i.exec(body)
  if (!match) return null
  const args = splitArguments(match[2])
  if (!args || body.includes(',')) return null
  const channels = args.channels.map((token) => parseNumberOrPercent(token, 1))
  const alpha = parseAlpha(args.alpha)
  if (channels.some((channel) => channel === null) || alpha === null) return null
  const [red, green, blue] = channels as number[]
  const space = match[1].toLowerCase()
  if (space === 'srgb') return { r: red * 255, g: green * 255, b: blue * 255, a: alpha }
  const [lr, lg, lb] =
    space === 'srgb-linear' ? [red, green, blue] : [red, green, blue].map(decodeGamma)
  const linear =
    space === 'srgb-linear'
      ? [lr, lg, lb]
      : [
          1.2249401762805 * lr - 0.2249401762805 * lg,
          -0.042056961239 * lr + 1.042056961239 * lg,
          -0.0196375547643 * lr - 0.0786360655012 * lg + 1.0982736202656 * lb,
        ]
  const [r, g, b] = linear.map((channel) => encodeGamma(channel) * 255)
  return { r, g, b, a: alpha }
}

function parseOklchFunction(body: string): ParsedThemeColor | null {
  const args = splitArguments(body)
  if (!args || body.includes(',')) return null
  const lightness = parseNumberOrPercent(args.channels[0], 1)
  const chroma = parseNumberOrPercent(args.channels[1], 0.4)
  const hue = parseHue(args.channels[2])
  const alpha = parseAlpha(args.alpha)
  if (lightness === null || chroma === null || hue === null || alpha === null) return null
  return { color: { L: clamp(lightness, 0, 1), C: Math.max(0, chroma), h: hue }, alpha }
}

function parseOklabFunction(body: string): ParsedThemeColor | null {
  const args = splitArguments(body)
  if (!args || body.includes(',')) return null
  const lightness = parseNumberOrPercent(args.channels[0], 1)
  const a = parseNumberOrPercent(args.channels[1], 0.4)
  const b = parseNumberOrPercent(args.channels[2], 0.4)
  const alpha = parseAlpha(args.alpha)
  if (lightness === null || a === null || b === null || alpha === null) return null
  return {
    color: {
      L: clamp(lightness, 0, 1),
      C: Math.hypot(a, b),
      h: (Math.atan2(b, a) * 180) / Math.PI,
    },
    alpha,
  }
}

function fromRgba(color: RgbaColor | null): ParsedThemeColor | null {
  if (!color) return null
  return { color: themeRgbToOklch(color), alpha: clamp(color.a, 0, 1) }
}

/** Parses one color literal, or `null` for anything else (see the header for the grammar). */
export function parseThemeColor(value: unknown): ParsedThemeColor | null {
  if (typeof value !== 'string' || value.length > MAX_COLOR_LENGTH) return null
  const input = value.trim()
  if (input.toLowerCase() === 'transparent') return { color: { L: 0, C: 0, h: 0 }, alpha: 0 }
  if (input.startsWith('#')) return fromRgba(parseHex(input))
  const match = /^([a-z-]+)\(([^()]*)\)$/i.exec(input)
  if (!match) return null
  const [, name, body] = match
  let parsed: ParsedThemeColor | null
  switch (name.toLowerCase()) {
    case 'rgb':
    case 'rgba':
      parsed = fromRgba(parseRgbFunction(body))
      break
    case 'hsl':
    case 'hsla':
      parsed = fromRgba(parseHslFunction(body))
      break
    case 'color':
      parsed = fromRgba(parseColorFunction(body))
      break
    case 'oklch':
      parsed = parseOklchFunction(body)
      break
    case 'oklab':
      parsed = parseOklabFunction(body)
      break
    default:
      return null
  }
  if (!parsed) return null
  const { L, C, h } = parsed.color
  return [L, C, h, parsed.alpha].every(Number.isFinite) ? parsed : null
}

function formatThemeColorNumber(value: number, precision: number): string {
  const rounded = Math.abs(value) < 10 ** -precision / 2 ? 0 : value
  return rounded.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, '$1')
}

export function formatOklchThemeColor(color: ThemeOklch, alpha = 1): string {
  const normalizedHue = color.C < 0.0000005 ? 0 : ((color.h % 360) + 360) % 360
  const body =
    formatThemeColorNumber(color.L, 6) +
    ' ' +
    formatThemeColorNumber(color.C, 6) +
    ' ' +
    formatThemeColorNumber(normalizedHue, 3)
  return alpha < 1
    ? 'oklch(' + body + ' / ' + formatThemeColorNumber(alpha, 4) + ')'
    : 'oklch(' + body + ')'
}

/** The canonical `oklch(…)` form of any accepted color, or `null`. */
export function toCanonicalThemeColor(value: unknown): string | null {
  const parsed = parseThemeColor(value)
  return parsed ? formatOklchThemeColor(parsed.color, parsed.alpha) : null
}

export function isThemeColor(value: unknown): value is string {
  return toCanonicalThemeColor(value) !== null
}

/**
 * Exactly the canonical form `toCanonicalThemeColor` prints. Main uses it to
 * accept stored themes without re-parsing: the renderer always canonicalizes
 * before saving, so anything else is a hand edit or an attack.
 */
const CANONICAL_OKLCH_RE =
  /^oklch\((?:0|1|0\.\d{1,6}) (?:0|\d{1,2}(?:\.\d{1,6})?) (?:0|\d{1,3}(?:\.\d{1,3})?)(?: \/ (?:0|1|0\.\d{1,4}))?\)$/

export function isCanonicalThemeColor(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_OKLCH_RE.test(value)
}

export function themeRgbToHex(color: ThemeRgb): string {
  return (
    '#' +
    [color.r, color.g, color.b]
      .map((channel) =>
        Math.round(clamp(channel, 0, 255))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

/** `#rrggbb` (or `#rrggbbaa` when translucent) for a color, `null` if it does not parse. */
export function themeColorToHex(value: string): string | null {
  const parsed = parseThemeColor(value)
  if (!parsed) return null
  const opaque = themeRgbToHex(themeOklchToRgb(parsed.color))
  if (parsed.alpha >= 1) return opaque
  return (
    opaque +
    Math.round(parsed.alpha * 255)
      .toString(16)
      .padStart(2, '0')
  )
}

export function parseThemeRgbColor(value: string, fallback: ThemeRgb): ThemeRgb {
  const parsed = parseThemeColor(value)
  return parsed ? themeOklchToRgb(parsed.color) : fallback
}

export function themeRgbToThemeColor(color: ThemeRgb): string {
  return formatOklchThemeColor(themeRgbToOklch(color))
}

export function mixThemeRgbColors(base: ThemeRgb, overlay: ThemeRgb, amount: number): ThemeRgb {
  return {
    r: base.r + (overlay.r - base.r) * amount,
    g: base.g + (overlay.g - base.g) * amount,
    b: base.b + (overlay.b - base.b) * amount,
  }
}

export function themeRelativeLuminance(color: ThemeRgb): number {
  const linearize = (channel: number): number => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b)
}

/** At luminance 0.179 black and white text have the same contrast. */
export function isDarkRgb(color: ThemeRgb): boolean {
  return themeRelativeLuminance(color) < 0.179
}

export function themeContrastRatio(first: ThemeRgb, second: ThemeRgb): number {
  const a = themeRelativeLuminance(first)
  const b = themeRelativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearChannelToSrgb(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.round(clamp(c, 0, 1) * 255)
}

export function themeRgbToOklch(color: ThemeRgb): ThemeOklch {
  const r = srgbChannelToLinear(color.r)
  const g = srgbChannelToLinear(color.g)
  const b = srgbChannelToLinear(color.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI }
}

function oklchToLinearRgb({ L, C, h }: ThemeOklch): ThemeRgb {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const bb = C * Math.sin(hr)
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}

/** Lowers chroma (binary search) until the color fits in sRGB; hue and lightness stay. */
export function mapThemeOklchToSrgbGamut(color: ThemeOklch): ThemeOklch {
  const isInGamut = (C: number): boolean => {
    const linear = oklchToLinearRgb({ ...color, C })
    return [linear.r, linear.g, linear.b].every(
      (channel) => channel >= -0.0001 && channel <= 1.0001,
    )
  }
  if (isInGamut(color.C)) return color
  let low = 0
  let high = color.C
  const resolution = 0.000001
  const steps = Math.max(
    1,
    Math.ceil(Math.log2(Math.max(color.C, resolution)) - Math.log2(resolution)),
  )
  for (let step = 0; step < steps; step += 1) {
    const mid = (low + high) / 2
    if (isInGamut(mid)) low = mid
    else high = mid
  }
  return { ...color, C: low }
}

export function themeOklchToRgb(color: ThemeOklch): ThemeRgb {
  const linear = oklchToLinearRgb(mapThemeOklchToSrgbGamut(color))
  return {
    r: linearChannelToSrgb(linear.r),
    g: linearChannelToSrgb(linear.g),
    b: linearChannelToSrgb(linear.b),
  }
}

export function themeOklchToThemeColor(color: ThemeOklch): string {
  return formatOklchThemeColor(mapThemeOklchToSrgbGamut(color))
}

/** Moves only the lightness of `base` until it reaches `minContrast` against `against`. */
export function solveOklchLightness(
  base: ThemeOklch,
  against: ThemeRgb,
  minContrast: number,
  direction: 'lighter' | 'darker',
): ThemeOklch {
  let low = direction === 'lighter' ? base.L : 0
  let high = direction === 'lighter' ? 1 : base.L
  let candidate = { ...base }
  if (themeContrastRatio(themeOklchToRgb(candidate), against) >= minContrast) return candidate
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2
    candidate = { ...base, L: mid }
    const contrast = themeContrastRatio(themeOklchToRgb(candidate), against)
    if (contrast >= minContrast) {
      if (direction === 'lighter') high = mid
      else low = mid
    } else if (direction === 'lighter') low = mid
    else high = mid
  }
  return { ...base, L: direction === 'lighter' ? high : low }
}

/**
 * `color` itself when it already reads on `surface`; otherwise the same hue
 * moved lighter or darker until it does (returned as hex: the 8-bit value is
 * what the solver measured).
 */
export function readableThemeColorOn(color: string, surface: string, minContrast: number): string {
  const parsedColor = parseThemeColor(color)
  const parsedSurface = parseThemeColor(surface)
  if (!parsedColor || !parsedSurface) return color
  const surfaceRgb = themeOklchToRgb(parsedSurface.color)
  if (themeContrastRatio(themeOklchToRgb(parsedColor.color), surfaceRgb) >= minContrast) {
    return color
  }
  const direction = isDarkRgb(surfaceRgb) ? 'lighter' : 'darker'
  const solved = solveOklchLightness(parsedColor.color, surfaceRgb, minContrast, direction)
  return themeRgbToHex(themeOklchToRgb(solved))
}

export const THEME_LIGHT_FOREGROUND: ThemeRgb = { r: 255, g: 250, b: 255 }
export const THEME_DARK_FOREGROUND: ThemeRgb = { r: 36, g: 21, b: 35 }
export const THEME_WHITE_FOREGROUND: ThemeRgb = { r: 255, g: 255, b: 255 }
export const THEME_BLACK_FOREGROUND: ThemeRgb = { r: 0, g: 0, b: 0 }

/** Near-white or near-black, whichever reads better on `background`. */
export function readableThemeForeground(background: ThemeRgb): ThemeRgb {
  const lightContrast = themeContrastRatio(background, THEME_LIGHT_FOREGROUND)
  const darkContrast = themeContrastRatio(background, THEME_DARK_FOREGROUND)
  if (Math.max(lightContrast, darkContrast) >= 4.5) {
    return lightContrast >= darkContrast ? THEME_LIGHT_FOREGROUND : THEME_DARK_FOREGROUND
  }
  return themeContrastRatio(background, THEME_WHITE_FOREGROUND) >=
    themeContrastRatio(background, THEME_BLACK_FOREGROUND)
    ? THEME_WHITE_FOREGROUND
    : THEME_BLACK_FOREGROUND
}

/** `foreground` mixed toward `background` by up to `amount` while it keeps `minimumRatio`. */
export function readableThemeText(
  background: ThemeRgb,
  foreground: ThemeRgb,
  amount: number,
  minimumRatio: number,
): ThemeRgb {
  const softened = mixThemeRgbColors(foreground, background, amount)
  if (themeContrastRatio(softened, background) >= minimumRatio) return softened
  let readable = foreground
  let lower = 0
  let upper = amount
  for (let index = 0; index < 12; index += 1) {
    const candidateAmount = (lower + upper) / 2
    const candidate = mixThemeRgbColors(foreground, background, candidateAmount)
    if (themeContrastRatio(candidate, background) >= minimumRatio) {
      readable = candidate
      lower = candidateAmount
    } else {
      upper = candidateAmount
    }
  }
  return readable
}

const STANDARD_LIGHT_MUTED_CONTRAST = 4.705
const STANDARD_DARK_MUTED_CONTRAST = 5.082

export function standardMutedThemeText(background: ThemeRgb, foreground: ThemeRgb): ThemeRgb {
  const target = isDarkRgb(background)
    ? STANDARD_DARK_MUTED_CONTRAST
    : STANDARD_LIGHT_MUTED_CONTRAST
  return readableThemeText(background, foreground, 1, target)
}
