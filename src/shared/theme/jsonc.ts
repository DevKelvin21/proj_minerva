/**
 * Minimal JSONC reader for VS Code theme files and extension manifests:
 * strips `//` and block comments, then trailing commas (both outside
 * strings), and hands the text to `JSON.parse`. No eval, no reviver. Size is
 * the caller's job (every caller caps the bytes before parsing).
 */

/** Walks `source`, copying string literals verbatim and letting `onCode` decide for everything else. */
function scan(source: string, onCode: (index: number) => { skip: number; emit: string }): string {
  let out = ''
  let index = 0
  while (index < source.length) {
    if (source[index] === '"') {
      const start = index
      index += 1
      while (index < source.length && source[index] !== '"') {
        index += source[index] === '\\' ? 2 : 1
      }
      index += 1
      out += source.slice(start, index)
      continue
    }
    const { skip, emit } = onCode(index)
    out += emit
    index += skip
  }
  return out
}

function stripComments(source: string): string {
  return scan(source, (index) => {
    if (source[index] === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      return { skip: (end === -1 ? source.length : end) - index, emit: '' }
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      return { skip: (end === -1 ? source.length : end + 2) - index, emit: ' ' }
    }
    return { skip: 1, emit: source[index] }
  })
}

function stripTrailingCommas(source: string): string {
  return scan(source, (index) => {
    if (source[index] === ',') {
      let next = index + 1
      while (next < source.length && /\s/.test(source[next])) next += 1
      if (source[next] === '}' || source[next] === ']') return { skip: 1, emit: '' }
    }
    return { skip: 1, emit: source[index] }
  })
}

export function stripJsonc(source: string): string {
  return stripTrailingCommas(stripComments(source))
}

/** Parses JSONC text; throws `SyntaxError` like `JSON.parse`. A leading BOM is ignored. */
export function parseJsonc(source: string): unknown {
  return JSON.parse(stripJsonc(source.replace(/^\uFEFF/, '')))
}
