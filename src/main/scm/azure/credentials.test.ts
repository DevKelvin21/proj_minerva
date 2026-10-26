import { describe, expect, it, vi } from 'vitest'
import {
  AzureCredentialSource,
  basicPatHeader,
  buildSpawnEnv,
  normalizeOrgUrlForKey,
  organizationName,
  parseEntraExpiry,
  pythonCandidatesFromLauncher,
  readAzDevopsDefaults,
  type AzureCredentialDeps,
  type ExecFileFn,
} from './credentials'

const HOME = '/home/u'
const AZ = '/opt/homebrew/bin/az'
const AZ_REAL = '/opt/homebrew/Cellar/azure-cli/2.90.0/bin/az'
const PY = '/opt/homebrew/Cellar/azure-cli/2.90.0/libexec/bin/python'
const WRAPPER =
  '#!/usr/bin/env bash\nAZ_INSTALLER=HOMEBREW ' + PY + ' -Im azure.cli "$@"\n'

function deps(overrides: {
  files?: Record<string, string>
  exec?: ExecFileFn
  env?: NodeJS.ProcessEnv
  executables?: string[]
  now?: () => number
}): AzureCredentialDeps {
  const files: Record<string, string> = {
    [AZ_REAL]: WRAPPER,
    ...overrides.files,
  }
  return {
    env: { PATH: '/opt/homebrew/bin', HOME, SECRET_THING: 'nope', ...overrides.env },
    platform: 'darwin',
    home: HOME,
    readText: async (path) => files[path] ?? null,
    isExecutable: (path) => (overrides.executables ?? [AZ, PY]).includes(path),
    realpath: (path) => (path === AZ ? AZ_REAL : path),
    execFile: overrides.exec ?? (async () => ({ stdout: '{}', stderr: '' })),
    now: overrides.now ?? (() => 1_000_000),
  }
}

function keyringExec(tokens: Record<string, string>, entra?: object): ExecFileFn & ReturnType<typeof vi.fn> {
  return vi.fn(async (file: string, args: string[]) => {
    if (file === PY) {
      const keys = args.slice(args.indexOf('-c') + 3)
      const key = keys.find((k) => tokens[k])
      return { stdout: JSON.stringify(key ? { key, token: tokens[key] } : {}) + '\n', stderr: '' }
    }
    if (file === AZ && args[0] === 'account') {
      if (!entra) throw new Error('Please run az login')
      return { stdout: JSON.stringify(entra), stderr: '' }
    }
    throw new Error('unexpected spawn ' + file)
  }) as ExecFileFn & ReturnType<typeof vi.fn>
}

describe('org naming', () => {
  it('normalizes like the extension', () => {
    expect(normalizeOrgUrlForKey('https://dev.azure.com/Contoso/Platform')).toBe('https://dev.azure.com/contoso')
    expect(normalizeOrgUrlForKey('https://Contoso.visualstudio.com/x')).toBe('https://contoso.visualstudio.com')
    expect(organizationName('https://dev.azure.com/Contoso/')).toBe('Contoso')
    expect(organizationName('https://contoso.visualstudio.com')).toBe('contoso')
    expect(organizationName('Contoso')).toBe('Contoso')
  })
})

describe('pythonCandidatesFromLauncher', () => {
  it('finds the Homebrew interpreter', () => {
    expect(pythonCandidatesFromLauncher(WRAPPER, AZ_REAL, 'darwin')).toEqual([PY])
  })

  it('expands $bin_dir in the Linux deb launcher', () => {
    const deb =
      '#!/usr/bin/env bash\nbin_dir=`cd "$(dirname "$BASH_SOURCE[0]")"; pwd`\npython_cmd=python3\n' +
      'if [ -f "$bin_dir/../../opt/az/bin/python3" ]; then\n  python_cmd="$bin_dir/../../opt/az/bin/python3"\nfi\n' +
      'AZ_INSTALLER=DEB "$python_cmd" -Im azure.cli "$@"\n'
    expect(pythonCandidatesFromLauncher(deb, '/usr/bin/az', 'linux')).toEqual(['/opt/az/bin/python3'])
  })

  it('uses a venv shebang', () => {
    const text = '#!/home/u/venv/bin/python3\nimport sys\n'
    expect(pythonCandidatesFromLauncher(text, '/home/u/venv/bin/az', 'linux')[0]).toBe('/home/u/venv/bin/python3')
  })

  it('handles the Windows az.cmd layout', () => {
    const cmd = '@IF EXIST "%~dp0\\..\\python.exe" (\n  "%~dp0\\..\\python.exe" -IBm azure.cli %*\n)'
    expect(pythonCandidatesFromLauncher(cmd, 'C:\\CLI2\\wbin\\az.cmd', 'win32')).toEqual(['C:\\CLI2\\python.exe'])
  })
})

describe('AzureCredentialSource', () => {
  it('prefers AZURE_DEVOPS_EXT_PAT and never spawns', async () => {
    const exec = keyringExec({})
    const source = new AzureCredentialSource(deps({ env: { AZURE_DEVOPS_EXT_PAT: 'envpat' }, exec }))
    const auth = await source.getAuthHeader('Contoso')
    expect(auth).toEqual({ header: basicPatHeader('envpat'), source: 'env-pat' })
    expect(auth.header).toBe('Basic ' + Buffer.from(':envpat').toString('base64'))
    expect(exec).not.toHaveBeenCalled()
  })

  it('reads the az devops PAT with az\'s python, org key first, and caches it', async () => {
    const exec = keyringExec({ 'azdevops-cli: default': 'defaultpat' })
    const source = new AzureCredentialSource(deps({ exec }))
    const [a, b] = await Promise.all([source.getAuthHeader('Contoso'), source.getAuthHeader('contoso')])
    expect(a).toEqual({ header: basicPatHeader('defaultpat'), source: 'az-devops-pat' })
    expect(b).toEqual(a)
    await source.getAuthHeader('https://dev.azure.com/Contoso')
    expect(exec).toHaveBeenCalledTimes(1)

    const [file, args, options] = exec.mock.calls[0] as Parameters<ExecFileFn>
    expect(file).toBe(PY)
    expect(args[0]).toBe('-I')
    expect(args.slice(4)).toEqual([
      'azdevops-cli:https://dev.azure.com/contoso',
      'azdevops-cli:https://contoso.visualstudio.com',
      'azdevops-cli: default',
    ])
    expect(options.env.SECRET_THING).toBeUndefined()
    expect(options.env.HOME).toBe(HOME)
    expect(options.env.PATH).toBe('/opt/homebrew/bin')
    expect(options.timeout).toBeGreaterThan(0)
  })

  it('falls back to the extension file store', async () => {
    const file = '[azdevops-cli:https://dev.azure.com/contoso]\npersonal access token = filepat\n'
    const source = new AzureCredentialSource(
      deps({ files: { [HOME + '/.azure/azuredevops/personalAccessTokens']: file } }),
    )
    expect(await source.getAuthHeader('Contoso')).toEqual({
      header: basicPatHeader('filepat'),
      source: 'az-devops-pat',
    })
  })

  it('honors AZURE_DEVOPS_EXT_CONFIG_DIR for the file store', async () => {
    const file = '[azdevops-cli: default]\nPersonal Access Token = p2\n'
    const source = new AzureCredentialSource(
      deps({
        env: { AZURE_DEVOPS_EXT_CONFIG_DIR: '/cfg' },
        executables: [],
        files: { '/cfg/personalAccessTokens': file },
      }),
    )
    expect((await source.getAuthHeader('Contoso')).source).toBe('az-devops-pat')
  })

  it('uses the Entra token when there is no PAT and refreshes before expiry', async () => {
    let now = 1_000_000
    const exec = keyringExec({}, { accessToken: 'jwt', expires_on: (now + 3600_000) / 1000 })
    const source = new AzureCredentialSource(deps({ exec, now: () => now }))
    expect(await source.getAuthHeader('Contoso')).toEqual({ header: 'Bearer jwt', source: 'az-entra' })
    const spawns = exec.mock.calls.length
    await source.getAuthHeader('Contoso')
    expect(exec.mock.calls.length).toBe(spawns)
    now += 3600_000 - 60_000 // inside the refresh margin
    // The fake keeps returning the same (now near-expiry) token, so the
    // refreshed lookup rejects it; what matters is that it spawned again.
    await expect(source.getAuthHeader('Contoso')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(exec.mock.calls.length).toBeGreaterThan(spawns)
  })

  it('reports CLI_UNAVAILABLE without az, UNAUTHENTICATED with az but no credential', async () => {
    const noAz = new AzureCredentialSource(deps({ executables: [] }))
    await expect(noAz.getAuthHeader('Contoso')).rejects.toMatchObject({ code: 'CLI_UNAVAILABLE' })

    const noCred = new AzureCredentialSource(deps({ exec: keyringExec({}) }))
    const error = await noCred.getAuthHeader('Contoso').catch((e: Error) => e)
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect((error as Error).message).toContain('az devops login --organization https://dev.azure.com/Contoso')
  })

  it('skips a rejected PAT after invalidate(org, "rejected") and never leaks it in errors', async () => {
    const exec = keyringExec({ 'azdevops-cli: default': 'stalepat' })
    const source = new AzureCredentialSource(deps({ exec }))
    await source.getAuthHeader('Contoso')
    source.invalidate('Contoso', 'rejected')
    const error = (await source.getAuthHeader('Contoso').catch((e: Error) => e)) as Error
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(error.message).toContain('rejected')
    expect(error.message).not.toContain('stalepat')
    expect(error.message).not.toContain(basicPatHeader('stalepat'))
  })

  it('invalidate() with a plain refresh re-reads the store', async () => {
    const exec = keyringExec({ 'azdevops-cli: default': 'p' })
    const source = new AzureCredentialSource(deps({ exec }))
    await source.getAuthHeader('Contoso')
    source.invalidate()
    await source.getAuthHeader('Contoso')
    expect(exec).toHaveBeenCalledTimes(2)
  })
})

describe('helpers', () => {
  it('parseEntraExpiry handles both formats', () => {
    expect(parseEntraExpiry({ expires_on: 1700000000 })).toBe(1700000000000)
    expect(parseEntraExpiry({ expires_on: '1700000000' })).toBe(1700000000000)
    expect(parseEntraExpiry({ expiresOn: '2026-10-26 18:30:00.000000' })).toBe(
      new Date(2026, 9, 26, 18, 30, 0).getTime(),
    )
    expect(parseEntraExpiry({})).toBeNull()
  })

  it('buildSpawnEnv keeps only allow-listed vars', () => {
    const env = buildSpawnEnv({ HOME: '/h', PATH: '/p', AZURE_DEVOPS_EXT_PAT: 'x', GH_TOKEN: 'y' })
    expect(env).toEqual({ HOME: '/h', PATH: '/p' })
  })

  it('readAzDevopsDefaults reads config + organization_list', async () => {
    const result = await readAzDevopsDefaults(
      deps({
        files: {
          [HOME + '/.azure/azuredevops/config']:
            '[defaults]\norganization = https://dev.azure.com/Contoso\nproject = Platform Team\n',
          [HOME + '/.azure/azuredevops/organization_list']:
            'azdevops-cli: default\nazdevops-cli:https://dev.azure.com/contoso\nazdevops-cli:https://dev.azure.com/fabrikam\n',
        },
      }),
    )
    expect(result).toEqual({
      organization: 'Contoso',
      organizationUrl: 'https://dev.azure.com/Contoso',
      project: 'Platform Team',
      knownOrganizations: ['Contoso', 'fabrikam'],
    })
  })

  it('readAzDevopsDefaults tolerates missing files and env overrides', async () => {
    const result = await readAzDevopsDefaults(
      deps({ env: { AZURE_DEVOPS_EXT_DEFAULTS_ORGANIZATION: 'Fabrikam' } }),
    )
    expect(result).toEqual({
      organization: 'Fabrikam',
      organizationUrl: 'https://dev.azure.com/Fabrikam',
      knownOrganizations: ['Fabrikam'],
    })
  })
})
