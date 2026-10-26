/**
 * Azure DevOps credential bridge. Minerva needs zero auth setup of its own:
 * it reuses what the user already configured in the Azure CLI.
 *
 * Chain, first hit wins (per organization):
 *   a. `AZURE_DEVOPS_EXT_PAT` env var (same variable the `az devops` extension honors).
 *   b. The PAT saved by `az devops login`. The extension stores it with Python
 *      `keyring` (service `azdevops-cli:<normalized org url>` or
 *      `azdevops-cli: default`, user `Personal Access Token`), with a plain
 *      INI file fallback (`personalAccessTokens`) on Linux. We read it with
 *      az's OWN bundled Python running a fixed inline script: on macOS the
 *      Keychain item was created by that same binary, so reading it does not
 *      pop a Keychain dialog (calling `/usr/bin/security` would).
 *   c. A Microsoft Entra token from `az account get-access-token` (needs `az login`).
 *
 * PAT -> `Basic base64(":" + pat)`; Entra -> `Bearer <token>`.
 *
 * Security rules (binding):
 * - The credential lives ONLY in this process's memory. It is never logged,
 *   persisted, put in an error message, or sent to the renderer.
 * - We never run anything that mutates the user's CLI state: no `az login`,
 *   `az logout`, `az devops login/logout`, `az devops configure`, or
 *   `az extension` changes. Only the two read-only calls above.
 * - Spawns use `execFile` (no shell), a timeout, and an allow-listed env.
 */
import { execFile as execFileCb } from 'node:child_process'
import { accessSync, constants as fsConstants, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve, win32 } from 'node:path'
import { promisify } from 'node:util'
import { AzureScmError } from './errors'

export type AzureCredentialKind = 'env-pat' | 'az-devops-pat' | 'az-entra'

export interface AzureAuthHeader {
  /** Full `Authorization` header value. Main-process memory only. */
  header: string
  source: AzureCredentialKind
}

export interface ExecResult {
  stdout: string
  stderr: string
}

export type ExecFileFn = (
  file: string,
  args: string[],
  options: {
    timeout: number
    env: NodeJS.ProcessEnv
    cwd: string
    maxBuffer: number
    windowsHide: boolean
  },
) => Promise<ExecResult>

export interface AzureCredentialDeps {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  execFile?: ExecFileFn
  /** Returns file contents, or `null` when missing/unreadable. */
  readText?: (path: string) => Promise<string | null>
  /** True when `path` is an existing, executable regular file. */
  isExecutable?: (path: string) => boolean
  realpath?: (path: string) => string
  now?: () => number
}

/** Azure DevOps resource id for Entra tokens (fixed, public). */
export const AZURE_DEVOPS_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798'

/** JWT-ish charset: anything else (CR/LF/NUL) could end up echoed in a header error. */
const ENTRA_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]+$/

const PAT_USERNAME = 'Personal Access Token'
const DEFAULT_CREDENTIAL_KEY = 'azdevops-cli: default'
const KEY_PREFIX = 'azdevops-cli:'

const KEYRING_TIMEOUT_MS = 15_000
/** `az account get-access-token` was seen taking 22 s on a cold start. */
const ENTRA_TIMEOUT_MS = 45_000
/** Refresh Entra tokens this long before they expire. */
const ENTRA_REFRESH_MARGIN_MS = 5 * 60 * 1000
const MAX_SPAWN_OUTPUT = 1024 * 1024

/**
 * Env vars a child may see. Everything else (including other secrets in the
 * app's environment) is dropped. Proxy/CA vars matter on corporate networks;
 * DBUS/XDG let Linux `keyring` reach the Secret Service.
 */
const SPAWN_ENV_ALLOWLIST = [
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'AZURE_CONFIG_DIR',
  'AZURE_EXTENSION_DIR',
  'AZURE_DEVOPS_EXT_CONFIG_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'REQUESTS_CA_BUNDLE',
  'SSL_CERT_FILE',
  // Windows
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ComSpec',
  'PATHEXT',
] as const

/**
 * Fixed inline script run with az's bundled Python (`-I`: isolated mode, no
 * PYTHON* env, no user site, no cwd on sys.path). argv[1] = extension dir,
 * argv[2..] = keyring service names to try in order. Prints one JSON object
 * on stdout; NEVER prints the token anywhere else. Mirrors
 * `CredentialStore._initialize_keyring` (built-in backends only).
 */
const KEYRING_SCRIPT = [
  'import sys, json',
  'sys.path.append(sys.argv[1])',
  'try:',
  '    import keyring',
  '    import keyring.core',
  "    keyring.core.init_backend(lambda b: b.__module__.startswith('keyring.backends.') and 'chain' not in b.__module__)",
  'except Exception:',
  "    print(json.dumps({'error': 'no-keyring'}))",
  '    sys.exit(0)',
  'for key in sys.argv[2:]:',
  '    try:',
  "        token = keyring.get_password(key, '" + PAT_USERNAME + "')",
  '    except Exception:',
  '        token = None',
  '    if token:',
  "        print(json.dumps({'key': key, 'token': token}))",
  '        sys.exit(0)',
  'print(json.dumps({}))',
].join('\n')

// ---------------------------------------------------------------------------
// Organization naming
// ---------------------------------------------------------------------------

/** `Contoso`, `https://dev.azure.com/Contoso/`, `https://contoso.visualstudio.com` -> `Contoso`/`contoso`. */
export function organizationName(orgOrUrl: string): string {
  const trimmed = orgOrUrl.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '')
  const url = new URL(trimmed)
  const host = url.hostname.toLowerCase()
  if (host.endsWith('.visualstudio.com')) return host.slice(0, -'.visualstudio.com'.length)
  const first = url.pathname.split('/').find((segment) => segment.length > 0)
  if (!first) throw new AzureScmError('UNKNOWN', 'Not an Azure DevOps organization URL: ' + trimmed)
  return decodeURIComponent(first)
}

export function organizationUrl(orgOrUrl: string): string {
  return 'https://dev.azure.com/' + encodeURIComponent(organizationName(orgOrUrl))
}

/** Port of the extension's `normalize_url_for_key` (`_credentials.py`). */
export function normalizeOrgUrlForKey(url: string): string {
  const parsed = new URL(url)
  let normalized = parsed.protocol.toLowerCase() + '//' + parsed.host.toLowerCase()
  const path = parsed.pathname.toLowerCase()
  if (path && path !== '/' && !url.toLowerCase().includes('visualstudio.com')) {
    normalized += '/' + path.split('/')[1]
  }
  return normalized
}

// ---------------------------------------------------------------------------
// Config locations and defaults
// ---------------------------------------------------------------------------

export interface AzConfigPaths {
  /** `$AZURE_CONFIG_DIR` or `~/.azure` */
  cliConfigDir: string
  /** `$AZURE_DEVOPS_EXT_CONFIG_DIR` or `<cliConfigDir>/azuredevops` */
  devopsConfigDir: string
  /** `$AZURE_EXTENSION_DIR/azure-devops` or `<cliConfigDir>/cliextensions/azure-devops` */
  devopsExtensionDir: string
}

export function azConfigPaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): AzConfigPaths {
  const cliConfigDir = env.AZURE_CONFIG_DIR || join(home, '.azure')
  return {
    cliConfigDir,
    devopsConfigDir: env.AZURE_DEVOPS_EXT_CONFIG_DIR || join(cliConfigDir, 'azuredevops'),
    devopsExtensionDir: join(
      env.AZURE_EXTENSION_DIR || join(cliConfigDir, 'cliextensions'),
      'azure-devops',
    ),
  }
}

/** Minimal INI reader (Python `configparser` subset: sections, `k = v` / `k: v`, `#`/`;` comments). */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const section = /^\[(.+)\]$/.exec(line)
    if (section) {
      current = new Map()
      sections.set(section[1], current)
      continue
    }
    const kv = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line)
    // configparser lowercases option names by default.
    if (kv && current) current.set(kv[1].toLowerCase(), kv[2])
  }
  return sections
}

export interface AzDevopsDefaults {
  /** Organization NAME (e.g. `Contoso`), from `az devops configure --defaults`. */
  organization?: string
  organizationUrl?: string
  project?: string
  /** Organization names with a stored `az devops login` credential, plus the default one. */
  knownOrganizations: string[]
}

async function defaultReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Reads `az devops configure --defaults` and the stored-login list. Read-only;
 * never fails (missing files give empty results). Honors knack's env
 * overrides (`AZURE_DEVOPS_EXT_DEFAULTS_ORGANIZATION` / `..._PROJECT`).
 */
export async function readAzDevopsDefaults(
  deps: AzureCredentialDeps = {},
): Promise<AzDevopsDefaults> {
  const env = deps.env ?? process.env
  const readText = deps.readText ?? defaultReadText
  const paths = azConfigPaths(env, deps.home ?? homedir())

  const config = parseIni((await readText(join(paths.devopsConfigDir, 'config'))) ?? '')
  const defaults = config.get('defaults')
  const orgSetting =
    env.AZURE_DEVOPS_EXT_DEFAULTS_ORGANIZATION || defaults?.get('organization') || ''
  const project = env.AZURE_DEVOPS_EXT_DEFAULTS_PROJECT || defaults?.get('project') || ''

  const result: AzDevopsDefaults = { knownOrganizations: [] }
  const seen = new Set<string>()
  const addKnown = (name: string): void => {
    if (!name || seen.has(name.toLowerCase())) return
    seen.add(name.toLowerCase())
    result.knownOrganizations.push(name)
  }

  if (orgSetting) {
    try {
      result.organization = organizationName(orgSetting)
      result.organizationUrl = organizationUrl(orgSetting)
      addKnown(result.organization)
    } catch {
      // Malformed default: ignore, like a missing one.
    }
  }
  if (project) result.project = project

  const orgList = (await readText(join(paths.devopsConfigDir, 'organization_list'))) ?? ''
  for (const line of orgList.split(/\r?\n/)) {
    const key = line.trim()
    if (!key.startsWith(KEY_PREFIX) || key === DEFAULT_CREDENTIAL_KEY) continue
    try {
      addKnown(organizationName(key.slice(KEY_PREFIX.length)))
    } catch {
      // Skip unparseable keys.
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Locating az and its Python
// ---------------------------------------------------------------------------

function defaultIsExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function defaultRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export function findAzExecutable(deps: AzureCredentialDeps = {}): string | null {
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  const isExecutable = deps.isExecutable ?? defaultIsExecutable
  const isWin = platform === 'win32'
  const names = isWin ? ['az.cmd', 'az.exe', 'az'] : ['az']
  const sep = isWin ? ';' : delimiter
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter((d) => d.length > 0)
  if (isWin) {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
      if (base) dirs.push(win32.join(base, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin'))
    }
  } else {
    // GUI launches (Finder, .desktop) may not inherit the shell PATH.
    dirs.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      join(deps.home ?? homedir(), '.local', 'bin'),
    )
  }
  const joinFn = isWin ? win32.join : join
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = joinFn(dir, name)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/**
 * Candidate interpreters for az's bundled Python, derived from the `az`
 * launcher. Pure (text in, paths out); the caller checks they exist.
 * - Homebrew: `AZ_INSTALLER=HOMEBREW /opt/homebrew/Cellar/azure-cli/X/libexec/bin/python -Im azure.cli "$@"`
 * - Linux deb/rpm: `"$bin_dir/../../opt/az/bin/python3" -Im azure.cli "$@"` (plus `/opt/az/bin/python3`)
 * - pip/venv: a console script with a `#!/path/to/python` shebang
 * - Windows MSI: `az.cmd` = `@"%~dp0\..\python.exe" -IBm azure.cli %*`
 */
export function pythonCandidatesFromLauncher(
  launcherText: string,
  launcherPath: string,
  platform: NodeJS.Platform,
): string[] {
  const out: string[] = []
  const add = (path: string): void => {
    if (path && !out.includes(path)) out.push(path)
  }

  if (platform === 'win32') {
    const dir = win32.dirname(launcherPath)
    for (const match of launcherText.matchAll(/"?%~dp0\\?([^"\s]*python(?:w)?\.exe)"?/gi)) {
      add(win32.resolve(dir, match[1]))
    }
    add(win32.resolve(dir, '..', 'python.exe'))
    return out
  }

  const dir = dirname(launcherPath)
  const shebang = /^#!\s*(\S*python[0-9.]*)\s*$/m.exec(launcherText.split('\n')[0] ?? '')
  if (shebang && shebang[1].startsWith('/')) add(shebang[1])

  const expanded = launcherText.replace(/\$\{?bin_dir\}?/g, dir)
  for (const match of expanded.matchAll(/(\/[^\s"'`;|&()]*\/python[0-9.]*)(?=["'\s]|$)/gm)) {
    if (match[1].endsWith('/env')) continue
    add(resolve(match[1]))
  }
  if (platform === 'linux') add('/opt/az/bin/python3')
  return out
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

export function buildSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const name of SPAWN_ENV_ALLOWLIST) {
    const value = env[name]
    if (value !== undefined) out[name] = value
  }
  return out
}

const defaultExecFile: ExecFileFn = (file, args, options) =>
  promisify(execFileCb)(file, args, { ...options, encoding: 'utf8' }) as Promise<ExecResult>

/** Seconds since epoch (`expires_on`, newer az) or local `YYYY-MM-DD HH:MM:SS.ffffff` (`expiresOn`). */
export function parseEntraExpiry(json: {
  expires_on?: unknown
  expiresOn?: unknown
}): number | null {
  const epoch = Number(json.expires_on)
  if (json.expires_on !== undefined && Number.isFinite(epoch) && epoch > 0) return epoch * 1000
  if (typeof json.expiresOn === 'string') {
    const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(json.expiresOn)
    if (local) {
      const [, y, mo, d, h, mi, s] = local.map(Number)
      return new Date(y, mo - 1, d, h, mi, s).getTime()
    }
  }
  return null
}

export function basicPatHeader(pat: string): string {
  return 'Basic ' + Buffer.from(':' + pat, 'utf8').toString('base64')
}

interface CachedCredential extends AzureAuthHeader {
  /** Epoch ms after which the header must be re-obtained; `null` = until invalidated (PATs). */
  refreshAt: number | null
}

export class AzureCredentialSource {
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly home: string
  private readonly execFile: ExecFileFn
  private readonly readText: (path: string) => Promise<string | null>
  private readonly isExecutable: (path: string) => boolean
  private readonly realpath: (path: string) => string
  private readonly now: () => number

  private readonly cache = new Map<string, CachedCredential>()
  private readonly inFlight = new Map<string, Promise<AzureAuthHeader>>()
  /** Headers the server rejected with 401, per org: the chain skips them next time. */
  private readonly rejected = new Map<string, Set<string>>()
  private azPath: string | null | undefined
  private pythonPath: string | null | undefined

  constructor(deps: AzureCredentialDeps = {}) {
    this.env = deps.env ?? process.env
    this.platform = deps.platform ?? process.platform
    this.home = deps.home ?? homedir()
    this.execFile = deps.execFile ?? defaultExecFile
    this.readText = deps.readText ?? defaultReadText
    this.isExecutable = deps.isExecutable ?? defaultIsExecutable
    this.realpath = deps.realpath ?? defaultRealpath
    this.now = deps.now ?? Date.now
  }

  /**
   * `Authorization` header for `org` (name or URL). Cached in memory per
   * org; concurrent first calls share one lookup.
   */
  getAuthHeader(org: string): Promise<AzureAuthHeader> {
    const key = organizationName(org).toLowerCase()
    const cached = this.cache.get(key)
    if (cached && (cached.refreshAt === null || cached.refreshAt > this.now())) {
      return Promise.resolve({ header: cached.header, source: cached.source })
    }
    const pending = this.inFlight.get(key)
    if (pending) return pending

    const promise = this.resolveChain(organizationName(org))
      .then((credential) => {
        this.cache.set(key, credential)
        return { header: credential.header, source: credential.source }
      })
      .finally(() => {
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, promise)
    return promise
  }

  /**
   * Drops cached credentials (one org, or all). With `reason: 'rejected'`
   * (the REST client got a 401), the dropped header is remembered so the
   * chain moves on to the next source instead of returning it again; a
   * fresh `az devops login` with a NEW PAT is picked up normally.
   */
  invalidate(org?: string, reason: 'refresh' | 'rejected' = 'refresh'): void {
    const keys = org ? [organizationName(org).toLowerCase()] : [...this.cache.keys()]
    for (const key of keys) {
      const cached = this.cache.get(key)
      if (cached && reason === 'rejected') {
        const set = this.rejected.get(key) ?? new Set<string>()
        set.add(cached.header)
        this.rejected.set(key, set)
      }
      this.cache.delete(key)
    }
    if (!org) {
      // A full refresh also forgets rejected headers (the user may have fixed the
      // PAT's scopes) and re-resolves binaries (the user may have installed az).
      if (reason === 'refresh') this.rejected.clear()
      this.azPath = undefined
      this.pythonPath = undefined
    }
  }

  private isRejected(orgKey: string, header: string): boolean {
    return this.rejected.get(orgKey)?.has(header) ?? false
  }

  private async resolveChain(org: string): Promise<CachedCredential> {
    const orgKey = org.toLowerCase()
    const loginHint = 'az devops login --organization ' + organizationUrl(org)

    const envPat = this.env.AZURE_DEVOPS_EXT_PAT?.trim()
    if (envPat) {
      const header = basicPatHeader(envPat)
      if (!this.isRejected(orgKey, header)) return { header, source: 'env-pat', refreshAt: null }
    }

    const az = this.resolveAz()
    const pat = await this.readStoredPat(org)
    if (pat) {
      const header = basicPatHeader(pat)
      if (!this.isRejected(orgKey, header))
        return { header, source: 'az-devops-pat', refreshAt: null }
    }

    if (!az) {
      throw new AzureScmError(
        'CLI_UNAVAILABLE',
        'Azure CLI (az) was not found. Install it with the azure-devops extension, then run: ' +
          loginHint +
          ' (or set AZURE_DEVOPS_EXT_PAT).',
      )
    }

    const entra = await this.readEntraToken()
    if (entra && !this.isRejected(orgKey, entra.header)) return entra

    const rejectedAny = (this.rejected.get(orgKey)?.size ?? 0) > 0
    throw new AzureScmError(
      'UNAUTHENTICATED',
      (rejectedAny
        ? 'Azure DevOps rejected the stored credential for ' +
          org +
          ' (expired or missing scopes). '
        : 'No Azure DevOps credential found for ' + org + '. ') +
        'Run: ' +
        loginHint +
        ' and paste a PAT with Code (Read & Write) scope.',
    )
  }

  private resolveAz(): string | null {
    if (this.azPath === undefined) {
      this.azPath = findAzExecutable({
        env: this.env,
        platform: this.platform,
        home: this.home,
        isExecutable: this.isExecutable,
      })
    }
    return this.azPath
  }

  private async resolvePython(): Promise<string | null> {
    if (this.pythonPath !== undefined) return this.pythonPath
    const az = this.resolveAz()
    if (!az) return null
    const launcher = this.realpath(az)
    const text = (await this.readText(launcher)) ?? ''
    // A binary launcher (not a script) has no interpreter to find.
    const head = text.slice(0, 64 * 1024)
    const candidates = head.includes('\0')
      ? []
      : pythonCandidatesFromLauncher(head, launcher, this.platform)
    const found = candidates.find((candidate) => this.isExecutable(candidate)) ?? null
    // Only positive results are cached: a later install should be picked up.
    if (found) this.pythonPath = found
    return found
  }

  private spawnOptions(timeout: number): Parameters<ExecFileFn>[2] {
    return {
      timeout,
      env: buildSpawnEnv(this.env),
      cwd: this.home || tmpdir(),
      maxBuffer: MAX_SPAWN_OUTPUT,
      windowsHide: true,
    }
  }

  /** Keyring service names the extension may have used for `org`, most specific first. */
  private async credentialKeys(org: string): Promise<string[]> {
    const keys: string[] = []
    const add = (key: string): void => {
      if (!keys.includes(key)) keys.push(key)
    }
    add(KEY_PREFIX + normalizeOrgUrlForKey(organizationUrl(org)))
    add(KEY_PREFIX + normalizeOrgUrlForKey('https://' + org.toLowerCase() + '.visualstudio.com'))
    const paths = azConfigPaths(this.env, this.home)
    const list = (await this.readText(join(paths.devopsConfigDir, 'organization_list'))) ?? ''
    for (const line of list.split(/\r?\n/)) {
      const key = line.trim()
      if (!key.startsWith(KEY_PREFIX) || key === DEFAULT_CREDENTIAL_KEY) continue
      try {
        if (organizationName(key.slice(KEY_PREFIX.length)).toLowerCase() === org.toLowerCase())
          add(key)
      } catch {
        // Ignore unparseable lines.
      }
    }
    add(DEFAULT_CREDENTIAL_KEY)
    return keys
  }

  private async readStoredPat(org: string): Promise<string | null> {
    const keys = await this.credentialKeys(org)
    const python = await this.resolvePython()
    if (python) {
      const paths = azConfigPaths(this.env, this.home)
      const args = this.platform === 'win32' ? ['-I', '-B'] : ['-I']
      try {
        const { stdout } = await this.execFile(
          python,
          [...args, '-c', KEYRING_SCRIPT, paths.devopsExtensionDir, ...keys],
          this.spawnOptions(KEYRING_TIMEOUT_MS),
        )
        const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { token?: unknown }
        if (typeof parsed.token === 'string' && parsed.token.trim()) return parsed.token.trim()
      } catch {
        // Timeout / crash / bad output: fall through to the file store. The
        // error is NOT surfaced: it could echo argv or partial output.
      }
    }
    return this.readPatFromFile(keys)
  }

  /** The extension's plain-file fallback (`<devopsConfigDir>/personalAccessTokens`, INI). */
  private async readPatFromFile(keys: string[]): Promise<string | null> {
    const paths = azConfigPaths(this.env, this.home)
    const text = await this.readText(join(paths.devopsConfigDir, 'personalAccessTokens'))
    if (!text) return null
    const ini = parseIni(text)
    for (const key of keys) {
      const token = ini.get(key)?.get(PAT_USERNAME.toLowerCase())?.trim()
      if (token) return token
    }
    return null
  }

  private async readEntraToken(): Promise<CachedCredential | null> {
    const az = this.resolveAz()
    if (!az) return null
    const azArgs = [
      'account',
      'get-access-token',
      '--resource',
      AZURE_DEVOPS_RESOURCE_ID,
      '-o',
      'json',
    ]
    let file = az
    let args = azArgs
    if (this.platform === 'win32') {
      // `az.cmd` needs a shell; run its Python directly instead.
      const python = await this.resolvePython()
      if (!python) return null
      file = python
      args = ['-I', '-B', '-m', 'azure.cli', ...azArgs]
    }
    try {
      const { stdout } = await this.execFile(file, args, this.spawnOptions(ENTRA_TIMEOUT_MS))
      const json = JSON.parse(stdout) as {
        accessToken?: unknown
        expires_on?: unknown
        expiresOn?: unknown
      }
      if (typeof json.accessToken !== 'string' || !ENTRA_TOKEN_PATTERN.test(json.accessToken)) {
        return null
      }
      const expiresAt = parseEntraExpiry(json)
      const refreshAt =
        expiresAt === null ? this.now() + 10 * 60 * 1000 : expiresAt - ENTRA_REFRESH_MARGIN_MS
      if (refreshAt <= this.now()) return null
      return { header: 'Bearer ' + json.accessToken, source: 'az-entra', refreshAt }
    } catch {
      // No `az login` session (the common case here) or a timeout.
      return null
    }
  }
}
