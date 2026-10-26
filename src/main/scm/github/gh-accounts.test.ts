import { describe, expect, it } from 'vitest'
import { parseGhAccountsJson, parseGhAccountsText } from './gh-accounts'

/**
 * Las dos salidas reales usadas como fixture vienen de `gh 2.96.0` en una
 * máquina con DOS cuentas en github.com, una activa y sana y otra con el
 * token vencido — el caso exacto que motivó F18.
 */
const REAL_JSON = JSON.stringify({
  hosts: {
    'github.com': [
      {
        state: 'success',
        active: true,
        host: 'github.com',
        login: 'am-i-edygg',
        tokenSource: '/home/u/.config/gh/hosts.yml',
        scopes: 'admin:public_key, gist, read:org, repo',
        gitProtocol: 'ssh',
      },
      {
        state: 'error',
        error: 'HTTP 401: Bad credentials (https://api.github.com/)',
        active: false,
        host: 'github.com',
        login: 'edyggclevr',
        tokenSource: 'default',
        gitProtocol: 'ssh',
      },
    ],
  },
})

const REAL_TEXT = [
  'github.com',
  '  ✓ Logged in to github.com account am-i-edygg (/home/u/.config/gh/hosts.yml)',
  '  - Active account: true',
  '  - Git operations protocol: ssh',
  '  - Token: gho_************************************',
  "  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'",
  '',
  '  X Failed to log in to github.com account edyggclevr (default)',
  '  - Active account: false',
  '  - The token in default is invalid.',
  '  - To re-authenticate, run: gh auth login -h github.com',
  '  - To forget about this account, run: gh auth logout -h github.com -u edyggclevr',
].join('\n')

const EXPECTED = [
  { login: 'am-i-edygg', active: true, valid: true },
  { login: 'edyggclevr', active: false, valid: false },
]

describe('parseGhAccountsJson', () => {
  it('lee la salida real de gh auth status --json hosts', () => {
    expect(parseGhAccountsJson(REAL_JSON, 'github.com')).toEqual(EXPECTED)
  })

  it('devuelve null (no []) ante JSON inválido, para que el llamador pruebe el fallback de texto', () => {
    expect(parseGhAccountsJson('unknown flag: --json', 'github.com')).toBeNull()
    expect(parseGhAccountsJson('', 'github.com')).toBeNull()
  })

  it('devuelve null si falta la forma esperada (hosts / array del host)', () => {
    expect(parseGhAccountsJson('{}', 'github.com')).toBeNull()
    expect(parseGhAccountsJson('{"hosts":{}}', 'github.com')).toBeNull()
    expect(parseGhAccountsJson('{"hosts":{"github.com":"nope"}}', 'github.com')).toBeNull()
  })

  it('devuelve [] (no null) si el host existe pero no tiene cuentas', () => {
    expect(parseGhAccountsJson('{"hosts":{"github.com":[]}}', 'github.com')).toEqual([])
  })

  it('ignora otros hosts (GHES en la misma máquina)', () => {
    const raw = JSON.stringify({
      hosts: {
        'github.com': [{ state: 'success', active: true, login: 'personal' }],
        'ghe.empresa.com': [{ state: 'success', active: true, login: 'trabajo' }],
      },
    })
    expect(parseGhAccountsJson(raw, 'github.com')).toEqual([
      { login: 'personal', active: true, valid: true },
    ])
  })

  it('descarta entradas sin un login usable en vez de tirar toda la lista', () => {
    const raw = JSON.stringify({
      hosts: {
        'github.com': [
          { state: 'success', active: false, login: '' },
          { state: 'success', active: false },
          { state: 'success', active: false, login: 'con espacios' },
          { state: 'success', active: true, login: 'bueno' },
        ],
      },
    })
    expect(parseGhAccountsJson(raw, 'github.com')).toEqual([
      { login: 'bueno', active: true, valid: true },
    ])
  })

  it('cualquier state distinto de "success" es valid: false, pero la cuenta NO desaparece', () => {
    const raw = JSON.stringify({
      hosts: { 'github.com': [{ state: 'timeout', active: false, login: 'rara' }] },
    })
    expect(parseGhAccountsJson(raw, 'github.com')).toEqual([
      { login: 'rara', active: false, valid: false },
    ])
  })

  it('deduplica por login y recorta a 20 cuentas', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      state: 'success',
      active: false,
      login: 'user' + i,
    }))
    entries.push({ state: 'success', active: false, login: 'user0' })
    const parsed = parseGhAccountsJson(
      JSON.stringify({ hosts: { 'github.com': entries } }),
      'github.com',
    )

    expect(parsed).toHaveLength(20)
    expect(new Set(parsed?.map((a) => a.login)).size).toBe(20)
  })
})

describe('parseGhAccountsText', () => {
  it('lee el reporte real de gh auth status (sin --json)', () => {
    expect(parseGhAccountsText(REAL_TEXT, 'github.com')).toEqual(EXPECTED)
  })

  it('ignora las secciones de otros hosts', () => {
    const raw = [
      'ghe.empresa.com',
      '  ✓ Logged in to ghe.empresa.com account trabajo (keyring)',
      '  - Active account: true',
      'github.com',
      '  ✓ Logged in to github.com account personal (keyring)',
      '  - Active account: true',
    ].join('\n')

    expect(parseGhAccountsText(raw, 'github.com')).toEqual([
      { login: 'personal', active: true, valid: true },
    ])
  })

  it('sin línea "Active account" (formatos viejos), degrada a active: false sin perder la cuenta', () => {
    const raw = ['github.com', '  ✓ Logged in to github.com account solo (keyring)'].join('\n')

    expect(parseGhAccountsText(raw, 'github.com')).toEqual([
      { login: 'solo', active: false, valid: true },
    ])
  })

  it('devuelve [] ante un texto que no tiene nada que ver', () => {
    expect(parseGhAccountsText('You are not logged into any GitHub hosts.', 'github.com')).toEqual(
      [],
    )
    expect(parseGhAccountsText('', 'github.com')).toEqual([])
  })

  it('no confunde la línea de "gh auth logout -u <user>" con una cuenta nueva', () => {
    // Esa línea de ayuda menciona un usuario pero no dice "logged in": si se
    // tomara como encabezado, la lista traería duplicados fantasma.
    const parsed = parseGhAccountsText(REAL_TEXT, 'github.com')
    expect(parsed).toHaveLength(2)
  })

  it('deduplica por login', () => {
    const raw = [
      'github.com',
      '  ✓ Logged in to github.com account repetido (keyring)',
      '  - Active account: true',
      '  ✓ Logged in to github.com account repetido (keyring)',
      '  - Active account: false',
    ].join('\n')

    expect(parseGhAccountsText(raw, 'github.com')).toEqual([
      { login: 'repetido', active: true, valid: true },
    ])
  })
})
