/**
 * In-memory stand-in for open-vsx.org (`MINERVA_MOCK_OPEN_VSX=1`, set by the
 * e2e fixture; also used by the unit tests). It answers the same URLs the
 * real client asks for, including a redirect to the download CDN, and serves
 * a real .vsix built here with a minimal "stored" zip writer, so the whole
 * install path (redirects, caps, checksum, zip checks, manifest match,
 * include chains) runs without touching the network.
 */
import { createHash } from 'node:crypto'
import type { FetchLike } from './open-vsx'

export interface FakeZipEntry {
  name: string
  data?: string | Buffer
  /** Unix mode (defaults to a regular 0644 file). */
  mode?: number
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A zip with every entry stored (no compression); enough for tests and the mock. */
export function buildStoredZip(entries: FakeZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf-8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

const NAMESPACE = 'minerva-fixtures'
const NAME = 'harbor-themes'
const VERSION = '1.0.0'
const FILE_BASE = 'https://open-vsx.org/api/' + NAMESPACE + '/' + NAME + '/' + VERSION + '/file/'
const CDN_BASE =
  'https://openvsx.eclipsecontent.org/' + NAMESPACE + '/' + NAME + '/' + VERSION + '/'

const MANIFEST = {
  publisher: NAMESPACE,
  name: NAME,
  displayName: 'Harbor Themes',
  version: VERSION,
  license: 'MIT',
  contributes: {
    themes: [
      { label: 'Harbor Light', uiTheme: 'vs', path: './themes/harbor-light.json' },
      { label: 'Harbor Dark', uiTheme: 'vs-dark', path: './themes/harbor-dark.json' },
    ],
  },
}

const HARBOR_BASE = {
  colors: {
    'editor.foreground': '#d6deeb',
    descriptionForeground: '#7f8ea3',
    'statusBar.background': 'url(https://example.invalid/x.png)',
  },
}

const HARBOR_DARK = {
  include: './harbor-base.json',
  colors: {
    'editor.background': '#0b1622',
    focusBorder: '#f78c6c',
    'button.background': '#f78c6c',
    'sideBar.background': '#08111b',
    'panel.border': '#1d3b53',
  },
}

const HARBOR_LIGHT = {
  colors: {
    'editor.background': '#fbfbfb',
    'editor.foreground': '#403f53',
    focusBorder: '#0b72b9',
    'sideBar.background': '#f0f0f0',
    'panel.border': '#d9d9d9',
  },
}

export function buildFakeVsix(manifest: object = MANIFEST, extra: FakeZipEntry[] = []): Buffer {
  return buildStoredZip([
    { name: 'extension.vsixmanifest', data: '<PackageManifest/>' },
    { name: 'extension/package.json', data: JSON.stringify(manifest) },
    { name: 'extension/themes/harbor-base.json', data: JSON.stringify(HARBOR_BASE) },
    { name: 'extension/themes/harbor-dark.json', data: '// dark\n' + JSON.stringify(HARBOR_DARK) },
    { name: 'extension/themes/harbor-light.json', data: JSON.stringify(HARBOR_LIGHT) },
    ...extra,
  ])
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * `fetch` for the fake registry. `options.vsix` swaps the package (tests use
 * it for hostile archives); `options.requests` records every URL asked for.
 */
export function createFakeOpenVsxFetch(
  options: { vsix?: Buffer; requests?: string[] } = {},
): FetchLike {
  const vsix = options.vsix ?? buildFakeVsix()
  const checksum = createHash('sha256').update(vsix).digest('hex')
  const detail = {
    namespace: NAMESPACE,
    name: NAME,
    displayName: 'Harbor Themes',
    description: 'A light and a dark harbor (Minerva test fixture).',
    version: VERSION,
    license: 'MIT',
    downloadCount: 4242,
    files: {
      download: FILE_BASE + NAMESPACE + '.' + NAME + '-' + VERSION + '.vsix',
      manifest: FILE_BASE + 'package.json',
      sha256: FILE_BASE + NAMESPACE + '.' + NAME + '-' + VERSION + '.sha256',
      icon: 'https://example.invalid/not-open-vsx.png',
    },
  }
  return async (url, init) => {
    options.requests?.push(url)
    const parsed = new URL(url)
    if (parsed.hostname === 'open-vsx.org' && parsed.pathname === '/api/-/search') {
      return json({
        extensions: [
          { namespace: NAMESPACE, name: NAME },
          { namespace: NAMESPACE, name: 'proprietary-theme' },
        ],
      })
    }
    if (
      parsed.hostname === 'open-vsx.org' &&
      parsed.pathname === '/api/' + NAMESPACE + '/' + NAME
    ) {
      return json(detail)
    }
    if (parsed.hostname === 'open-vsx.org' && parsed.pathname.endsWith('/proprietary-theme')) {
      return json({ ...detail, name: 'proprietary-theme', license: 'SEE LICENSE IN LICENSE.md' })
    }
    // Every file URL redirects to the CDN, like the real registry.
    if (parsed.hostname === 'open-vsx.org' && url.startsWith(FILE_BASE)) {
      return new Response(null, {
        status: 302,
        headers: { location: CDN_BASE + url.slice(FILE_BASE.length) },
      })
    }
    if (url.startsWith(CDN_BASE)) {
      const file = url.slice(CDN_BASE.length)
      if (file === 'package.json') return json(MANIFEST)
      if (file.endsWith('.sha256')) return new Response(checksum + '  package.vsix\n')
      if (file.endsWith('.vsix')) {
        return new Response(init.method === 'HEAD' ? null : new Uint8Array(vsix), {
          headers: { 'content-length': String(vsix.length) },
        })
      }
    }
    return json({ error: 'not found' }, 404)
  }
}
