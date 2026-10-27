import { describe, expect, it } from 'vitest'
import {
  createOpenVsxClient,
  normalizePackagePath,
  OpenVsxError,
  readThemesFromVsix,
  trustedOpenVsxUrl,
} from './open-vsx'
import { buildFakeVsix, buildStoredZip, createFakeOpenVsxFetch } from './open-vsx-fake'

const EXTENSION = {
  id: 'minerva-fixtures.harbor-themes',
  namespace: 'minerva-fixtures',
  name: 'harbor-themes',
  displayName: 'Harbor Themes',
  version: '1.0.0',
  license: 'MIT',
}

describe('trustedOpenVsxUrl', () => {
  it('accepts only https on open-vsx.org and its CDN', () => {
    expect(trustedOpenVsxUrl('https://open-vsx.org/api/x')).not.toBeNull()
    expect(trustedOpenVsxUrl('https://openvsx.eclipsecontent.org/x.vsix')).not.toBeNull()
    expect(trustedOpenVsxUrl('http://open-vsx.org/api/x')).toBeNull()
    expect(trustedOpenVsxUrl('https://open-vsx.org.evil.example/api')).toBeNull()
    expect(trustedOpenVsxUrl('https://user:pw@open-vsx.org/api')).toBeNull()
    expect(trustedOpenVsxUrl('https://open-vsx.org:8443/api')).toBeNull()
    expect(trustedOpenVsxUrl('file:///etc/passwd')).toBeNull()
    expect(trustedOpenVsxUrl('/api/x', 'https://open-vsx.org/a')?.toString()).toBe(
      'https://open-vsx.org/api/x',
    )
  })
})

describe('normalizePackagePath', () => {
  it('keeps paths inside extension/', () => {
    expect(normalizePackagePath('./themes/a.json')).toBe('extension/themes/a.json')
    expect(normalizePackagePath('./base.json', 'extension/themes/a.json')).toBe(
      'extension/themes/base.json',
    )
    expect(normalizePackagePath('../x.json', 'extension/themes/a.json')).toBe('extension/x.json')
  })

  it.each(['../../etc/passwd', '/etc/passwd', 'C:\\x', 'a\0b'])('refuses %j', (path) => {
    expect(() => normalizePackagePath(path)).toThrow(OpenVsxError)
  })
})

describe('readThemesFromVsix', () => {
  it('reads both themes, resolves includes, keeps only importer colors', async () => {
    const themes = await readThemesFromVsix(buildFakeVsix(), EXTENSION)
    expect(themes.map((theme) => [theme.label, theme.type])).toEqual([
      ['Harbor Light', 'light'],
      ['Harbor Dark', 'dark'],
    ])
    const dark = themes[1]
    expect(dark.colors['editor.background']).toBe('#0b1622')
    expect(dark.colors['editor.foreground']).toBe('#d6deeb')
    expect(dark.colors['statusBar.background']).toBeUndefined()
  })

  it('refuses a package whose manifest does not match the listing', async () => {
    await expect(
      readThemesFromVsix(buildFakeVsix(), { ...EXTENSION, version: '9.9.9' }),
    ).rejects.toThrow(OpenVsxError)
  })

  it('refuses an archive with a parent-directory entry', async () => {
    const zip = buildStoredZip([
      { name: 'extension/package.json', data: '{}' },
      { name: 'extension/../../evil.json', data: '{}' },
    ])
    await expect(readThemesFromVsix(zip, EXTENSION)).rejects.toThrow(OpenVsxError)
  })

  it('never reads a theme through a symlink', async () => {
    const manifest = {
      publisher: 'minerva-fixtures',
      name: 'harbor-themes',
      version: '1.0.0',
      license: 'MIT',
      contributes: { themes: [{ label: 'Link', uiTheme: 'vs-dark', path: './link.json' }] },
    }
    const zip = buildStoredZip([
      { name: 'extension/package.json', data: JSON.stringify(manifest) },
      { name: 'extension/link.json', data: '/etc/passwd', mode: 0o120777 },
    ])
    await expect(readThemesFromVsix(zip, EXTENSION)).rejects.toThrow(OpenVsxError)
  })

  it('refuses an include cycle', async () => {
    const manifest = {
      publisher: 'minerva-fixtures',
      name: 'harbor-themes',
      version: '1.0.0',
      license: 'MIT',
      contributes: { themes: [{ label: 'Loop', uiTheme: 'vs-dark', path: './a.json' }] },
    }
    const zip = buildStoredZip([
      { name: 'extension/package.json', data: JSON.stringify(manifest) },
      { name: 'extension/a.json', data: JSON.stringify({ include: './b.json' }) },
      { name: 'extension/b.json', data: JSON.stringify({ include: './a.json' }) },
    ])
    await expect(readThemesFromVsix(zip, EXTENSION)).rejects.toThrow(OpenVsxError)
  })

  it('refuses an oversized theme file', async () => {
    const manifest = {
      publisher: 'minerva-fixtures',
      name: 'harbor-themes',
      version: '1.0.0',
      license: 'MIT',
      contributes: { themes: [{ label: 'Big', uiTheme: 'vs-dark', path: './big.json' }] },
    }
    const zip = buildStoredZip([
      { name: 'extension/package.json', data: JSON.stringify(manifest) },
      { name: 'extension/big.json', data: ' '.repeat(300 * 1024) },
    ])
    await expect(readThemesFromVsix(zip, EXTENSION)).rejects.toThrow(OpenVsxError)
  })
})

describe('createOpenVsxClient (fake registry)', () => {
  it('searches, drops non-permissive licenses, and follows the CDN redirect', async () => {
    const requests: string[] = []
    const client = createOpenVsxClient(createFakeOpenVsxFetch({ requests }))
    const results = await client.search('harbor', 'downloadCount')
    expect(results.map((result) => result.id)).toEqual(['minerva-fixtures.harbor-themes'])
    // An icon outside open-vsx.org is not passed on.
    expect(results[0].iconUrl).toBeNull()
    expect(requests.some((url) => url.startsWith('https://openvsx.eclipsecontent.org/'))).toBe(true)
    expect(
      requests.every((url) =>
        /^https:\/\/(open-vsx\.org|openvsx\.eclipsecontent\.org)\//.test(url),
      ),
    ).toBe(true)
  })

  it('installs a package after checking its checksum', async () => {
    const client = createOpenVsxClient(createFakeOpenVsxFetch())
    const result = await client.install('minerva-fixtures', 'harbor-themes')
    expect(result.extension.displayName).toBe('Harbor Themes')
    expect(result.themes).toHaveLength(2)
  })

  it('refuses a package that does not match the published checksum', async () => {
    const good = createFakeOpenVsxFetch()
    const tampered = buildFakeVsix(undefined, [{ name: 'extension/extra.txt', data: 'x' }])
    const fetchTampered: typeof good = async (url, init) => {
      if (url.endsWith('.vsix')) return new Response(new Uint8Array(tampered))
      return good(url, init)
    }
    const client = createOpenVsxClient(fetchTampered)
    await expect(client.install('minerva-fixtures', 'harbor-themes')).rejects.toThrow(OpenVsxError)
  })

  it('refuses a redirect to another host', async () => {
    const good = createFakeOpenVsxFetch()
    const client = createOpenVsxClient(async (url, init) => {
      if (url.includes('/file/')) {
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })
      }
      return good(url, init)
    })
    await expect(client.install('minerva-fixtures', 'harbor-themes')).rejects.toThrow(OpenVsxError)
  })

  it('refuses an oversized search response', async () => {
    const client = createOpenVsxClient(
      async () =>
        new Response('x'.repeat(10), { headers: { 'content-length': String(10 * 1024 * 1024) } }),
    )
    await expect(client.search('x', 'relevance')).rejects.toThrow(OpenVsxError)
  })
})

describe('single flight', () => {
  it('refuses a second concurrent install', async () => {
    const client = createOpenVsxClient(createFakeOpenVsxFetch())
    const first = client.install('minerva-fixtures', 'harbor-themes')
    await expect(client.install('minerva-fixtures', 'harbor-themes')).rejects.toThrow(OpenVsxError)
    await expect(first).resolves.toMatchObject({ themes: expect.any(Array) })
    // Free again once the first one finished.
    await expect(client.install('minerva-fixtures', 'harbor-themes')).resolves.toBeDefined()
  })
})
