import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AzureDevOpsClient,
  gitRepoUrl,
  isAllowedAzureUrl,
  orgApiUrl,
  paginateTopSkip,
  parseRetryAfter,
  type CredentialProvider,
} from './client'

const SECRET = 'Basic c2VjcmV0'

function creds(headers: string[] = [SECRET]) {
  let i = 0
  return {
    getAuthHeader: vi.fn<CredentialProvider['getAuthHeader']>(async () => ({
      header: headers[Math.min(i++, headers.length - 1)],
      source: 'env-pat' as const,
    })),
    invalidate: vi.fn<CredentialProvider['invalidate']>(),
  }
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  })
}

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

function fetchSeq(...responses: (Response | Error)[]): FetchMock {
  const fn = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  return fn as unknown as FetchMock
}

function sentHeaders(fetchMock: FetchMock, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>
}

function sentUrl(fetchMock: FetchMock, call = 0): URL {
  return fetchMock.mock.calls[call][0] as URL
}

describe('URL helpers', () => {
  it('refuses dot and empty segments instead of letting the URL parser resolve them', () => {
    for (const bad of ['.', '..', '']) {
      expect(() => orgApiUrl(bad)).toThrow(/Invalid Azure DevOps URL segment/)
      expect(() => orgApiUrl('Contoso', bad, '_apis')).toThrow(/Invalid Azure DevOps URL segment/)
      expect(() => gitRepoUrl('Contoso', 'Platform', bad, 'pullRequests')).toThrow(
        /Invalid Azure DevOps URL segment/,
      )
    }
    // Dots inside a name are fine (and never resolved: they are not whole segments).
    expect(new URL(orgApiUrl('Contoso', 'my..project')).pathname).toBe('/Contoso/my..project')
  })

  it('encodes segments and adds api-version', async () => {
    const f = fetchSeq(json({ ok: 1 }))
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    await client.json(
      'Contoso',
      gitRepoUrl('Contoso', 'Platform Team', 'repo-id', 'pullRequests', 7),
      {
        query: { 'searchCriteria.status': 'active', skipped: undefined },
      },
    )
    const url = sentUrl(f)
    expect(url.pathname).toBe(
      '/Contoso/Platform%20Team/_apis/git/repositories/repo-id/pullRequests/7',
    )
    expect(url.searchParams.get('api-version')).toBe('7.1')
    expect(url.searchParams.get('searchCriteria.status')).toBe('active')
    expect(url.searchParams.has('skipped')).toBe(false)
    expect(sentHeaders(f)).toMatchObject({
      Authorization: SECRET,
      'X-TFS-FedAuthRedirect': 'Suppress',
    })
  })

  it('isAllowedAzureUrl only lets the same org through on Azure hosts', () => {
    expect(isAllowedAzureUrl(new URL('https://dev.azure.com/contoso/_apis'), 'Contoso')).toBe(true)
    expect(isAllowedAzureUrl(new URL('https://vssps.dev.azure.com/Contoso/_apis'), 'Contoso')).toBe(
      true,
    )
    expect(isAllowedAzureUrl(new URL('https://contoso.visualstudio.com/_apis'), 'Contoso')).toBe(
      true,
    )
    expect(isAllowedAzureUrl(new URL('https://dev.azure.com/fabrikam/_apis'), 'Contoso')).toBe(
      false,
    )
    expect(isAllowedAzureUrl(new URL('https://evil.com/contoso'), 'Contoso')).toBe(false)
    expect(isAllowedAzureUrl(new URL('http://dev.azure.com/contoso'), 'Contoso')).toBe(false)
    expect(isAllowedAzureUrl(new URL('https://dev.azure.com.evil.com/contoso'), 'Contoso')).toBe(
      false,
    )
  })

  it('refuses to send to a foreign host', async () => {
    const f = fetchSeq()
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    await expect(
      client.json('Contoso', 'https://evil.example/contoso/_apis'),
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
    })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('auth and errors', () => {
  it('retries once after 401 with an invalidated credential', async () => {
    const f = fetchSeq(new Response('', { status: 401 }), json({ value: 1 }))
    const c = creds([SECRET, 'Basic bmV3'])
    const client = new AzureDevOpsClient({ credentials: c, fetch: f })
    expect(await client.json('Contoso', orgApiUrl('Contoso', '_apis', 'connectionData'))).toEqual({
      value: 1,
    })
    expect(c.invalidate).toHaveBeenCalledWith('Contoso', 'rejected')
    expect(sentHeaders(f, 1).Authorization).toBe('Basic bmV3')
  })

  it('maps a second 401 (and a 203 sign-in page) to UNAUTHENTICATED without leaking the header', async () => {
    const f = fetchSeq(new Response('', { status: 401 }), new Response('<html>', { status: 203 }))
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    const error = (await client
      .json('Contoso', orgApiUrl('Contoso', 'x'))
      .catch((e: Error) => e)) as Error
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', name: 'AzureApiError' })
    expect(JSON.stringify(error) + error.message + error.stack).not.toContain('c2VjcmV0')
  })

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [412, 'CONFLICT'],
    [500, 'UNKNOWN'],
  ])('maps %i to %s with the server message', async (status, code) => {
    const f = fetchSeq(json({ message: 'TF401019: nope', typeKey: 'X' }, { status }))
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    const error = (await client
      .json('Contoso', orgApiUrl('Contoso', 'x'))
      .catch((e: Error) => e)) as Error
    expect(error).toMatchObject({ code, status })
    expect(error.message).toContain('TF401019')
  })

  it('treats an HTML 200 as UNAUTHENTICATED', async () => {
    const f = fetchSeq(
      new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const c = creds()
    const client = new AzureDevOpsClient({ credentials: c, fetch: f })
    await expect(client.json('Contoso', orgApiUrl('Contoso', 'x'))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    expect(c.invalidate).toHaveBeenCalled()
  })

  it('maps fetch failures and timeouts to NETWORK', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    })
    const f = fetchSeq(new TypeError('fetch failed'), timeout)
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    await expect(client.json('Contoso', orgApiUrl('Contoso', 'x'))).rejects.toMatchObject({
      code: 'NETWORK',
    })
    await expect(client.json('Contoso', orgApiUrl('Contoso', 'x'))).rejects.toThrow(
      /did not answer in time/,
    )
  })
})

describe('throttling and redirects', () => {
  it('sleeps through a short Retry-After and retries', async () => {
    const sleep = vi.fn(async () => {})
    const f = fetchSeq(
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
      json({ ok: true }),
    )
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f, sleep })
    expect(await client.json('Contoso', orgApiUrl('Contoso', 'x'))).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('gives up with RATE_LIMITED + retryAfterMs when the wait is too long', async () => {
    const f = fetchSeq(new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f, sleep: async () => {} })
    await expect(client.json('Contoso', orgApiUrl('Contoso', 'x'))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 120_000,
    })
  })

  it('drops the credential when a redirect leaves the allow-list', async () => {
    const f = fetchSeq(
      new Response(null, { status: 302, headers: { location: 'https://blobs.example.net/x' } }),
      new Response(Buffer.from('zip'), { status: 200 }),
    )
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    const bytes = await client.binary('Contoso', orgApiUrl('Contoso', 'blob'), { maxBytes: 10 })
    expect(bytes.toString()).toBe('zip')
    expect(sentHeaders(f, 0).Authorization).toBe(SECRET)
    expect(sentHeaders(f, 1).Authorization).toBeUndefined()
  })
})

describe('binary and downloads', () => {
  it('caps binary responses', async () => {
    const f = fetchSeq(new Response(Buffer.alloc(20), { status: 200 }))
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    await expect(
      client.binary('Contoso', orgApiUrl('Contoso', 'b'), { maxBytes: 10 }),
    ).rejects.toThrow(/larger than/)
  })

  it('streams downloads to disk and removes partial files over the cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'minerva-dl-'))
    try {
      const f = fetchSeq(
        new Response(Buffer.from('hello'), { status: 200 }),
        new Response(Buffer.alloc(64), { status: 200 }),
      )
      const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
      const ok = join(dir, 'ok.zip')
      expect(
        await client.download('Contoso', orgApiUrl('Contoso', 'z'), ok, { maxBytes: 10 }),
      ).toBe(5)
      expect(await readFile(ok, 'utf8')).toBe('hello')

      await expect(
        client.download('Contoso', orgApiUrl('Contoso', 'z'), join(dir, 'big.zip'), {
          maxBytes: 10,
        }),
      ).rejects.toThrow(/larger than/)
      expect(await readdir(dir)).toEqual(['ok.zip'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('pagination', () => {
  it('follows x-ms-continuationtoken', async () => {
    const f = fetchSeq(
      json({ value: [1, 2] }, { headers: { 'x-ms-continuationtoken': 'abc' } }),
      json({ value: [3] }),
    )
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    expect(await client.listContinuation<number>('Contoso', orgApiUrl('Contoso', 'r'))).toEqual([
      1, 2, 3,
    ])
    expect(sentUrl(f, 0).searchParams.has('continuationToken')).toBe(false)
    expect(sentUrl(f, 1).searchParams.get('continuationToken')).toBe('abc')
  })

  it('pages with $top/$skip until a short page', async () => {
    const f = fetchSeq(json({ value: [1, 2] }), json({ value: [3] }))
    const client = new AzureDevOpsClient({ credentials: creds(), fetch: f })
    expect(
      await client.listTopSkip<number>('Contoso', orgApiUrl('Contoso', 'p'), { pageSize: 2 }),
    ).toEqual([1, 2, 3])
    expect(sentUrl(f, 1).searchParams.get('$skip')).toBe('2')
  })

  it('paginateTopSkip respects maxItems', async () => {
    const pages = vi.fn(async (top: number) => Array.from({ length: top }, (_, i) => i))
    expect(await paginateTopSkip(pages, { pageSize: 4, maxItems: 6 })).toHaveLength(6)
    expect(pages).toHaveBeenLastCalledWith(2, 4)
  })

  it('parseRetryAfter', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000)
    expect(parseRetryAfter(null)).toBeNull()
  })
})
