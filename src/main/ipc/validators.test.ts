import { describe, expect, it } from 'vitest'
import { payloadValidators } from './validators'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../shared/theme/appearance'
import { getBuiltInTheme, getThemeColorsForMode } from '../../shared/theme/themes'

const validRepo = {
  provider: 'github',
  owner: 'octocat',
  name: 'hello-world',
  fullName: 'octocat/hello-world',
}
const validAzureRepo = {
  provider: 'azure',
  organization: 'contoso',
  project: 'Studio v2',
  name: 'cms-api',
  repositoryId: '3f2c1a9e-0000-4000-8000-000000000001',
  fullName: 'contoso/Studio v2/cms-api',
}

describe('payloadValidators', () => {
  describe('void channels', () => {
    const channels = [
      'minerva:ping',
      'scm:getAuthStatus',
      'scm:listGhAccounts',
      'scm:getSettings',
      'settings:get',
      'settings:getAppearance',
    ] as const

    it.each(channels)('acepta undefined para %s', (channel) => {
      expect(payloadValidators[channel](undefined)).toBe(true)
    })

    it.each(channels)('rechaza cualquier payload no-undefined para %s', (channel) => {
      expect(payloadValidators[channel]({})).toBe(false)
      expect(payloadValidators[channel]('x')).toBe(false)
      expect(payloadValidators[channel](null)).toBe(false)
    })
  })

  describe('scm:listPullRequests', () => {
    const validate = payloadValidators['scm:listPullRequests']

    it('acepta payload sin search', () => {
      expect(validate({})).toBe(true)
    })

    it('acepta search string corto', () => {
      expect(validate({ search: 'design system' })).toBe(true)
    })

    it('acepta search vacío', () => {
      expect(validate({ search: '' })).toBe(true)
    })

    it('rechaza search demasiado largo (>256)', () => {
      expect(validate({ search: 'a'.repeat(257) })).toBe(false)
    })

    it('acepta search justo en el límite (256)', () => {
      expect(validate({ search: 'a'.repeat(256) })).toBe(true)
    })

    it('rechaza search que no es string', () => {
      expect(validate({ search: 123 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ search: 'x', evil: '__proto__' })).toBe(false)
    })

    it('rechaza arrays, null y primitivos', () => {
      expect(validate([])).toBe(false)
      expect(validate(null)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate(undefined)).toBe(false)
    })

    it('acepta cada valor de state (T50)', () => {
      expect(validate({ state: 'open' })).toBe(true)
      expect(validate({ state: 'closed' })).toBe(true)
      expect(validate({ state: 'all' })).toBe(true)
    })

    it('acepta state y search combinados', () => {
      expect(validate({ search: 'design system', state: 'all' })).toBe(true)
    })

    it('rechaza un state desconocido', () => {
      expect(validate({ state: 'merged' })).toBe(false)
      expect(validate({ state: 'OPEN' })).toBe(false)
    })

    it('rechaza state que no es string', () => {
      expect(validate({ state: 1 })).toBe(false)
    })
  })

  describe('scm:markPrSeen', () => {
    const validate = payloadValidators['scm:markPrSeen']
    const base = { repo: validRepo, number: 7, updatedAt: '2026-07-11T10:00:00Z', commentCount: 3 }

    it('acepta payload válido (GitHub y Azure)', () => {
      expect(validate(base)).toBe(true)
      expect(validate({ ...base, repo: validAzureRepo })).toBe(true)
    })

    it('acepta commentCount en 0 o null (provider no lo reporta)', () => {
      expect(validate({ ...base, commentCount: 0 })).toBe(true)
      expect(validate({ ...base, commentCount: null })).toBe(true)
    })

    it('rechaza repo inválido o number fuera de rango', () => {
      expect(validate({ ...base, repo: { ...validRepo, provider: 'gitlab' } })).toBe(false)
      expect(validate({ ...base, number: 0 })).toBe(false)
    })

    it('rechaza updatedAt vacío', () => {
      expect(validate({ ...base, updatedAt: '' })).toBe(false)
    })

    it('rechaza updatedAt > 64 chars', () => {
      expect(validate({ ...base, updatedAt: 'a'.repeat(65) })).toBe(false)
    })

    it('acepta updatedAt justo en el límite (64)', () => {
      expect(validate({ ...base, updatedAt: 'a'.repeat(64) })).toBe(true)
    })

    it('rechaza commentCount negativo o no entero', () => {
      expect(validate({ ...base, commentCount: -1 })).toBe(false)
      expect(validate({ ...base, commentCount: 1.5 })).toBe(false)
    })

    it('rechaza commentCount que no es number', () => {
      expect(validate({ ...base, commentCount: '3' })).toBe(false)
    })

    it('rechaza claves desconocidas (incluido el viejo prId)', () => {
      expect(validate({ ...base, evil: true })).toBe(false)
      expect(validate({ ...base, prId: 'PR_kwDOA1' })).toBe(false)
    })

    it('rechaza payload incompleto o no-objeto', () => {
      expect(validate({ repo: validRepo })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('scm:getPullRequestDetail / Files / getCommentThreads / ai:analyzePullRequest / ai:getCachedAnalysis / ai:invalidateAnalysis / ai:getAnalysisState', () => {
    const channels = [
      'scm:getPullRequestDetail',
      'scm:getPullRequestFiles',
      'scm:getCommentThreads',
      'ai:analyzePullRequest',
      'ai:getCachedAnalysis',
      'ai:invalidateAnalysis',
      'ai:getAnalysisState',
    ] as const

    it.each(channels)('acepta { repo, number } válido para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 42 })).toBe(true)
    })

    it.each(channels)('rechaza number <= 0 para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 0 })).toBe(false)
      expect(payloadValidators[channel]({ repo: validRepo, number: -1 })).toBe(false)
    })

    it.each(channels)('rechaza number no entero para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 4.5 })).toBe(false)
    })

    it.each(channels)('rechaza number > 1_000_000 para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 1_000_001 })).toBe(false)
    })

    it.each(channels)('rechaza repo con campos vacíos para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: { ...validRepo, owner: '' }, number: 1 })).toBe(
        false,
      )
    })

    it.each(channels)('rechaza repo con campos > 200 chars para %s', (channel) => {
      expect(
        payloadValidators[channel]({
          repo: { ...validRepo, owner: 'a'.repeat(201) },
          number: 1,
        }),
      ).toBe(false)
    })

    it.each(channels)('rechaza repo incompleto para %s', (channel) => {
      expect(
        payloadValidators[channel]({
          repo: { provider: 'github', owner: 'a', name: 'b' },
          number: 1,
        }),
      ).toBe(false)
    })

    it.each(channels)('acepta un repo de Azure DevOps válido para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validAzureRepo, number: 12561 })).toBe(true)
    })

    it.each(channels)(
      'rechaza repos sin provider, de provider desconocido o mezclados para %s',
      (channel) => {
        const { provider: _omit, ...noProvider } = validRepo
        void _omit
        const bad = [
          noProvider,
          { ...validRepo, provider: 'gitlab' },
          { ...validRepo, provider: 'azure' },
          { ...validAzureRepo, owner: 'x' },
          { ...validAzureRepo, repositoryId: '' },
          { ...validAzureRepo, repositoryId: 'orders-api' },
          { ...validAzureRepo, repositoryId: '..' },
          { ...validAzureRepo, repositoryId: '3f2c1a9e-0000-4000-8000-00000000000g' },
          { ...validAzureRepo, repositoryId: '3f2c1a9e-0000-4000-8000-000000000001/x' },
          { ...validAzureRepo, organization: '..' },
          { ...validAzureRepo, organization: '.' },
          { ...validAzureRepo, project: '..' },
          { ...validAzureRepo, project: 'a/b' },
          { ...validAzureRepo, name: '..' },
          { ...validAzureRepo, name: 'x\\y' },
          { ...validAzureRepo, name: 'x\ny' },
          { ...validAzureRepo, project: 'p'.repeat(201) },
          { ...validAzureRepo, provider: 'github' },
        ]
        for (const repo of bad) {
          expect(payloadValidators[channel]({ repo, number: 1 })).toBe(false)
        }
      },
    )

    it.each(channels)('rechaza payload sin repo/number para %s', (channel) => {
      expect(payloadValidators[channel]({})).toBe(false)
      expect(payloadValidators[channel](undefined)).toBe(false)
    })

    it.each(channels)('rechaza claves extra para %s', (channel) => {
      expect(payloadValidators[channel]({ repo: validRepo, number: 1, extra: 'nope' })).toBe(false)
    })
  })

  describe('scm:postComment', () => {
    const validate = payloadValidators['scm:postComment']
    const base = { repo: validRepo, number: 1, bodyMarkdown: 'Looks good!' }

    it('acepta comentario general mínimo', () => {
      expect(validate(base)).toBe(true)
    })

    it('acepta comentario de línea completo', () => {
      expect(
        validate({ ...base, threadId: 't1', path: 'src/index.ts', line: 10, side: 'RIGHT' }),
      ).toBe(true)
    })

    it('acepta side LEFT', () => {
      expect(validate({ ...base, side: 'LEFT' })).toBe(true)
    })

    it('rechaza bodyMarkdown vacío', () => {
      expect(validate({ ...base, bodyMarkdown: '' })).toBe(false)
    })

    it('rechaza bodyMarkdown > 65536 chars', () => {
      expect(validate({ ...base, bodyMarkdown: 'a'.repeat(65537) })).toBe(false)
    })

    it('acepta bodyMarkdown justo en el límite (65536)', () => {
      expect(validate({ ...base, bodyMarkdown: 'a'.repeat(65536) })).toBe(true)
    })

    it('rechaza threadId > 200 chars', () => {
      expect(validate({ ...base, threadId: 'a'.repeat(201) })).toBe(false)
    })

    it('rechaza path > 500 chars', () => {
      expect(validate({ ...base, path: 'a'.repeat(501) })).toBe(false)
    })

    it('rechaza line < 1 o no entero', () => {
      expect(validate({ ...base, line: 0 })).toBe(false)
      expect(validate({ ...base, line: -5 })).toBe(false)
      expect(validate({ ...base, line: 1.5 })).toBe(false)
    })

    it('caps line at 1,000,000', () => {
      expect(validate({ ...base, path: 'a.ts', line: 1_000_000 })).toBe(true)
      expect(validate({ ...base, path: 'a.ts', line: 1_000_001 })).toBe(false)
      expect(validate({ ...base, path: 'a.ts', line: Number.MAX_SAFE_INTEGER })).toBe(false)
      expect(validate({ ...base, path: 'a.ts', line: Infinity })).toBe(false)
    })

    it('rechaza side inválido', () => {
      expect(validate({ ...base, side: 'MIDDLE' })).toBe(false)
    })

    it('rechaza repo inválido', () => {
      expect(validate({ ...base, repo: { owner: 'a', name: 'b', fullName: '' } })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ ...base, injected: true })).toBe(false)
    })

    it('rechaza payload no-objeto', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('settings:setAiProvider', () => {
    const validate = payloadValidators['settings:setAiProvider']

    it('acepta cada proveedor conocido', () => {
      expect(validate({ provider: 'claude-code' })).toBe(true)
      expect(validate({ provider: 'codex' })).toBe(true)
      expect(validate({ provider: 'opencode' })).toBe(true)
    })

    it('rechaza un proveedor desconocido (incluido "openrouter", eliminado en T59)', () => {
      expect(validate({ provider: 'gemini-cli' })).toBe(false)
      expect(validate({ provider: 'openrouter' })).toBe(false)
    })

    it('rechaza provider que no es string', () => {
      expect(validate({ provider: 42 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', evil: true })).toBe(false)
    })

    it('rechaza payload sin provider o no-objeto', () => {
      expect(validate({})).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('ai:getProviderModels', () => {
    const validate = payloadValidators['ai:getProviderModels']

    it('acepta cada proveedor conocido', () => {
      expect(validate({ provider: 'claude-code' })).toBe(true)
      expect(validate({ provider: 'codex' })).toBe(true)
      expect(validate({ provider: 'opencode' })).toBe(true)
    })

    it('rechaza un proveedor desconocido (incluido "openrouter", eliminado en T59)', () => {
      expect(validate({ provider: 'gemini-cli' })).toBe(false)
      expect(validate({ provider: 'openrouter' })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', evil: true })).toBe(false)
    })

    it('rechaza payload sin provider o no-objeto', () => {
      expect(validate({})).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('settings:setProviderModel', () => {
    const validate = payloadValidators['settings:setProviderModel']

    it('acepta un payload válido', () => {
      expect(validate({ provider: 'claude-code', model: 'claude-sonnet-5' })).toBe(true)
    })

    it('acepta un id de modelo fuera de cualquier lista curada (modo "Otro (avanzado)" de OpenCode)', () => {
      expect(validate({ provider: 'opencode', model: 'anthropic/claude-sonnet-5' })).toBe(true)
    })

    it('rechaza un proveedor desconocido', () => {
      expect(validate({ provider: 'gemini-cli', model: 'x' })).toBe(false)
    })

    it('rechaza model vacío o > 100 chars', () => {
      expect(validate({ provider: 'codex', model: '' })).toBe(false)
      expect(validate({ provider: 'codex', model: 'a'.repeat(101) })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', model: 'gpt-5.5-codex', evil: true })).toBe(false)
    })

    it('rechaza payload incompleto o no-objeto', () => {
      expect(validate({ provider: 'codex' })).toBe(false)
      expect(validate({ model: 'gpt-5.5-codex' })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
    })
  })

  describe('settings:setLanguage', () => {
    const validate = payloadValidators['settings:setLanguage']

    it('accepts the known locales', () => {
      expect(validate({ language: 'en' })).toBe(true)
      expect(validate({ language: 'es' })).toBe(true)
    })

    it('rejects unknown locales, wrong types and extra keys', () => {
      expect(validate({ language: 'fr' })).toBe(false)
      expect(validate({ language: 'EN' })).toBe(false)
      expect(validate({ language: 1 })).toBe(false)
      expect(validate({ language: 'en', extra: true })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('en')).toBe(false)
    })
  })

  describe('settings:getLanguage', () => {
    it('only accepts a void payload', () => {
      expect(payloadValidators['settings:getLanguage'](undefined)).toBe(true)
      expect(payloadValidators['settings:getLanguage']({})).toBe(false)
    })
  })

  describe('settings:setModelOption', () => {
    const validate = payloadValidators['settings:setModelOption']

    it('acepta un payload válido', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'high' })).toBe(true)
    })

    it('rechaza un proveedor desconocido', () => {
      expect(validate({ provider: 'gemini-cli', optionId: 'effort', value: 'high' })).toBe(false)
    })

    it('rechaza optionId vacío o > 50 chars', () => {
      expect(validate({ provider: 'codex', optionId: '', value: 'high' })).toBe(false)
      expect(validate({ provider: 'codex', optionId: 'a'.repeat(51), value: 'high' })).toBe(false)
    })

    it('acepta optionId justo en el límite (50)', () => {
      expect(validate({ provider: 'codex', optionId: 'a'.repeat(50), value: 'high' })).toBe(true)
    })

    it('rechaza value vacío o > 50 chars', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: '' })).toBe(false)
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'a'.repeat(51) })).toBe(false)
    })

    it('acepta value justo en el límite (50)', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'a'.repeat(50) })).toBe(true)
    })

    it('rechaza optionId/value que no son string', () => {
      expect(validate({ provider: 'codex', optionId: 42, value: 'high' })).toBe(false)
      expect(validate({ provider: 'codex', optionId: 'effort', value: 42 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ provider: 'codex', optionId: 'effort', value: 'high', evil: true })).toBe(
        false,
      )
    })

    it('rechaza payload incompleto o no-objeto', () => {
      expect(validate({ provider: 'codex', optionId: 'effort' })).toBe(false)
      expect(validate({ optionId: 'effort', value: 'high' })).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('scm:setGithubAccount', () => {
    const validate = payloadValidators['scm:setGithubAccount']

    it('acepta un login de gh', () => {
      expect(validate({ login: 'octocat' })).toBe(true)
      expect(validate({ login: 'am-i-edygg' })).toBe(true)
    })

    it('acepta null (volver a la cuenta activa de gh)', () => {
      expect(validate({ login: null })).toBe(true)
    })

    it('rechaza un login con espacios (terminaría en el argv de gh)', () => {
      expect(validate({ login: 'oct cat' })).toBe(false)
      expect(validate({ login: 'octocat\n--otro-flag' })).toBe(false)
    })

    it('rechaza login vacío o desmedido', () => {
      expect(validate({ login: '' })).toBe(false)
      expect(validate({ login: 'a'.repeat(65) })).toBe(false)
    })

    it('rechaza login que no es string ni null', () => {
      expect(validate({ login: 42 })).toBe(false)
      expect(validate({ login: undefined })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ login: 'octocat', evil: true })).toBe(false)
    })

    it('rechaza payload sin login o no-objeto', () => {
      expect(validate({})).toBe(false)
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('window:openDidactic', () => {
    const validate = payloadValidators['window:openDidactic']
    const base = { repo: validRepo, number: 482, title: 'Add coupon support' }

    it('acepta payload válido', () => {
      expect(validate(base)).toBe(true)
    })

    it('rechaza title vacío', () => {
      expect(validate({ ...base, title: '' })).toBe(false)
    })

    it('rechaza title > 300 chars', () => {
      expect(validate({ ...base, title: 'a'.repeat(301) })).toBe(false)
    })

    it('acepta title justo en el límite (300)', () => {
      expect(validate({ ...base, title: 'a'.repeat(300) })).toBe(true)
    })

    it('rechaza title que no es string', () => {
      expect(validate({ ...base, title: 123 })).toBe(false)
    })

    it('rechaza repo inválido', () => {
      expect(validate({ ...base, repo: { owner: '', name: 'x', fullName: 'a/x' } })).toBe(false)
    })

    it('rechaza number <= 0 o no entero', () => {
      expect(validate({ ...base, number: 0 })).toBe(false)
      expect(validate({ ...base, number: 4.5 })).toBe(false)
    })

    it('rechaza claves desconocidas', () => {
      expect(validate({ ...base, evil: true })).toBe(false)
    })

    it('rechaza payload no-objeto', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate('x')).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('scm:setThreadStatus', () => {
    const validate = payloadValidators['scm:setThreadStatus']
    const base = { repo: validAzureRepo, number: 3, threadId: '12', status: 'wont_fix' }

    it('accepts any Azure status, but only active/resolved for GitHub', () => {
      for (const status of ['active', 'pending', 'resolved', 'wont_fix', 'closed', 'by_design']) {
        expect(validate({ ...base, status })).toBe(true)
      }
      expect(validate({ ...base, repo: validRepo, status: 'resolved' })).toBe(true)
      expect(validate({ ...base, repo: validRepo, status: 'active' })).toBe(true)
      expect(validate({ ...base, repo: validRepo, status: 'wont_fix' })).toBe(false)
      expect(validate({ ...base, repo: validRepo, status: 'pending' })).toBe(false)
    })

    it('rejects unknown statuses, empty thread ids and extra keys', () => {
      expect(validate({ ...base, status: 'fixed' })).toBe(false)
      expect(validate({ ...base, threadId: '' })).toBe(false)
      expect(validate({ ...base, threadId: 'x'.repeat(201) })).toBe(false)
      expect(validate({ ...base, extra: 1 })).toBe(false)
      expect(validate({ ...base, status: undefined })).toBe(false)
    })
  })

  describe('chat:send', () => {
    const validate = payloadValidators['chat:send']
    const line = {
      kind: 'line',
      id: 'l1',
      path: 'src/a.ts',
      side: 'new',
      line: 12,
      code: 'const a = 1',
      note: '',
    }
    const thread = {
      kind: 'thread',
      id: 't1',
      threadId: 'PRRT_1',
      path: 'src/a.ts',
      side: 'old',
      startLine: 3,
      endLine: 5,
      outdated: false,
      comments: [{ author: 'alice', body: 'Is this safe?' }],
    }
    const base = { repo: validRepo, number: 1, text: 'Why?', context: [] as unknown[] }

    it('accepts a message, with or without a conversation and context', () => {
      expect(validate(base)).toBe(true)
      expect(validate({ ...base, conversationId: '3f2c1a9e-0000-4000-8000-000000000001' })).toBe(
        true,
      )
      expect(validate({ ...base, repo: validAzureRepo, context: [line, thread] })).toBe(true)
      expect(validate({ ...base, context: [{ ...line, side: 'old', code: '', note: 'hm' }] })).toBe(
        true,
      )
    })

    it('rejects empty or huge text, bad ids, a missing context and extra keys', () => {
      expect(validate({ ...base, text: '   ' })).toBe(false)
      expect(validate({ ...base, text: 'x'.repeat(4001) })).toBe(false)
      expect(validate({ ...base, conversationId: '' })).toBe(false)
      expect(validate({ ...base, conversationId: '../x' })).toBe(false)
      expect(validate({ ...base, conversationId: 'x'.repeat(101) })).toBe(false)
      expect(validate({ repo: validRepo, number: 1, text: 'Why?' })).toBe(false)
      expect(validate({ ...base, number: 0 })).toBe(false)
      expect(validate({ ...base, extra: true })).toBe(false)
    })

    it('checks every field of a line item', () => {
      const bad = [
        { ...line, kind: 'lines' },
        { ...line, id: '' },
        { ...line, path: '../etc/passwd' },
        { ...line, path: 'x'.repeat(1001) },
        { ...line, side: 'head' },
        { ...line, line: 0 },
        { ...line, line: 1.5 },
        { ...line, code: 'x'.repeat(2001) },
        { ...line, note: 'x'.repeat(2001) },
        { ...line, note: undefined },
        { ...line, extra: 1 },
      ]
      for (const item of bad) expect(validate({ ...base, context: [item] })).toBe(false)
    })

    it('checks every field of a thread item', () => {
      const noLines = { ...thread, startLine: undefined, endLine: undefined }
      expect(validate({ ...base, context: [noLines] })).toBe(true)
      expect(validate({ ...base, context: [{ ...thread, comments: [] }] })).toBe(true)
      const bad = [
        { ...thread, threadId: '' },
        { ...thread, startLine: undefined },
        { ...thread, endLine: undefined },
        { ...thread, startLine: 6 },
        { ...thread, startLine: 0, endLine: 0 },
        { ...thread, outdated: 'no' },
        { ...thread, comments: [{ author: '', body: 'x' }] },
        { ...thread, comments: [{ author: 'x'.repeat(201), body: 'x' }] },
        { ...thread, comments: [{ author: 'a', body: 'x', extra: 1 }] },
        { ...thread, comments: Array(51).fill(thread.comments[0]) },
      ]
      for (const item of bad) expect(validate({ ...base, context: [item] })).toBe(false)
    })

    it('takes a PR-level thread: no path, no side, no lines, no origin', () => {
      const general = {
        kind: 'thread',
        id: 'g1',
        threadId: 'PRRT_2',
        outdated: false,
        comments: thread.comments,
      }
      expect(validate({ ...base, context: [general] })).toBe(true)
      expect(validate({ ...base, context: [general, line] })).toBe(true)
      const bad = [
        { ...general, side: 'new' },
        { ...general, path: 'src/a.ts' },
        { ...general, startLine: 1, endLine: 1 },
        { ...general, origin: { commit: 'a'.repeat(40), line: 1 } },
        { ...general, threadId: undefined },
        // Only a thread may point at no file.
        { kind: 'line', id: 'l9', line: 1, code: '', note: '' },
      ]
      for (const item of bad) expect(validate({ ...base, context: [item] })).toBe(false)
    })

    it('checks the origin of an outdated line thread', () => {
      const commit = 'ab12'.repeat(10)
      const ok = [
        { commit, line: 8 },
        { commit, line: 9, lineEnd: 10 },
        { commit: commit.toUpperCase(), path: 'src/old-name.ts', line: 1 },
      ]
      for (const origin of ok) {
        expect(validate({ ...base, context: [{ ...thread, outdated: true, origin }] })).toBe(true)
      }
      const bad = [
        { commit: 'ab12', line: 8 },
        { commit: 'main', line: 8 },
        { commit: 'g'.repeat(40), line: 8 },
        { commit, line: 0 },
        { commit, line: 9, lineEnd: 8 },
        { commit, path: '../secrets', line: 1 },
        { commit, line: 1, extra: true },
        'HEAD',
        null,
      ]
      for (const origin of bad) {
        expect(validate({ ...base, context: [{ ...thread, outdated: true, origin }] })).toBe(false)
      }
    })

    it('caps the item count, rejects duplicate ids, and shares one character budget', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ ...line, id: 'l' + i }))
      expect(validate({ ...base, context: items })).toBe(true)
      expect(validate({ ...base, context: [...items, { ...line, id: 'l10' }] })).toBe(false)
      expect(validate({ ...base, context: [line, line] })).toBe(false)
      const body = 'x'.repeat(12_000)
      const big = { ...thread, comments: [{ author: 'a', body }] }
      expect(validate({ ...base, context: [big] })).toBe(true)
      expect(validate({ ...base, context: [big, { ...big, id: 't2' }] })).toBe(false)
    })
  })

  describe('chat:get / retry / cancel / delete', () => {
    const id = '3f2c1a9e-0000-4000-8000-000000000001'

    it('chat:get takes a conversation, an optional cursor and a bounded page size', () => {
      const validate = payloadValidators['chat:get']
      expect(validate({ conversationId: id })).toBe(true)
      expect(validate({ conversationId: id, before: id, limit: 100 })).toBe(true)
      expect(validate({ conversationId: id, limit: 0 })).toBe(false)
      expect(validate({ conversationId: id, limit: 101 })).toBe(false)
      expect(validate({ conversationId: id, limit: 2.5 })).toBe(false)
      expect(validate({ conversationId: id, before: '' })).toBe(false)
      expect(validate({ conversationId: 'a b' })).toBe(false)
      expect(validate({ conversationId: id, extra: 1 })).toBe(false)
    })

    it('retry, cancel and delete take exactly a conversation id', () => {
      for (const channel of ['chat:retry', 'chat:cancel', 'chat:delete'] as const) {
        const validate = payloadValidators[channel]
        expect(validate({ conversationId: id })).toBe(true)
        expect(validate({ conversationId: '' })).toBe(false)
        expect(validate({ conversationId: id, before: id })).toBe(false)
        expect(validate(undefined)).toBe(false)
      }
    })

    it('chat:list takes a PR', () => {
      const validate = payloadValidators['chat:list']
      expect(validate({ repo: validRepo, number: 3 })).toBe(true)
      expect(validate({ repo: validRepo })).toBe(false)
    })
  })

  describe('scm:getFileContent', () => {
    const validate = payloadValidators['scm:getFileContent']
    const base = { repo: validRepo, number: 1, path: 'src/a.ts', side: 'head' }

    it('accepts a repo-relative path on either side', () => {
      expect(validate(base)).toBe(true)
      expect(validate({ ...base, side: 'base' })).toBe(true)
      expect(validate({ ...base, repo: validAzureRepo, path: 'Dir With Spaces/a b.cs' })).toBe(true)
    })

    it('rejects traversal, absolute paths, control chars and bad sides', () => {
      for (const path of [
        '../etc/passwd',
        'a/../b',
        '/abs',
        'a//b',
        'a/./b',
        'a\\b',
        'a\u0000b',
        '',
      ]) {
        expect(validate({ ...base, path })).toBe(false)
      }
      expect(validate({ ...base, side: 'LEFT' })).toBe(false)
      expect(validate({ ...base, path: 'x'.repeat(501) })).toBe(false)
    })

    it('takes a full hex commit on the head side only', () => {
      const commit = 'a'.repeat(40)
      expect(validate({ ...base, commit })).toBe(true)
      expect(validate({ ...base, commit: 'ABCDEF0123'.repeat(4) })).toBe(true)
      expect(validate({ ...base, side: 'base', commit })).toBe(false)
      for (const bad of ['a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), 'HEAD', 'main', '', 7]) {
        expect(validate({ ...base, commit: bad })).toBe(false)
      }
    })
  })

  describe('scm:retarget', () => {
    const validate = payloadValidators['scm:retarget']
    const base = {
      repo: validAzureRepo,
      number: 12495,
      expectedCurrentBase: 'task/23714',
      newBase: 'main',
    }

    it('accepts two different valid short branch names', () => {
      expect(validate(base)).toBe(true)
    })

    it('rejects same-branch, refs/ names, invalid git names and missing fields', () => {
      expect(validate({ ...base, newBase: 'task/23714' })).toBe(false)
      for (const bad of [
        'refs/heads/main',
        'a..b',
        'has space',
        '-x',
        'x/',
        'x.lock',
        'a~1',
        'a:b',
        '',
      ]) {
        expect(validate({ ...base, newBase: bad })).toBe(false)
      }
      const { newBase: _drop, ...missing } = base
      void _drop
      expect(validate(missing)).toBe(false)
      expect(validate({ ...base, extra: true })).toBe(false)
    })
  })

  describe('scm:getStacks', () => {
    const validate = payloadValidators['scm:getStacks']
    it('accepts nothing or { refresh }', () => {
      expect(validate(undefined)).toBe(true)
      expect(validate({})).toBe(true)
      expect(validate({ refresh: true })).toBe(true)
      expect(validate({ refresh: 'yes' })).toBe(false)
      expect(validate({ other: 1 })).toBe(false)
      expect(validate('x')).toBe(false)
    })
  })

  describe('settings:setNotifications', () => {
    const validate = payloadValidators['settings:setNotifications']
    it('accepts a level and the badge flag', () => {
      expect(validate({ level: 'off', badge: false })).toBe(true)
      expect(validate({ level: 'direct', badge: true })).toBe(true)
      expect(validate({ level: 'all', badge: true })).toBe(true)
    })

    it('rejects unknown levels, missing or extra keys, wrong types', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate({ level: 'loud', badge: true })).toBe(false)
      expect(validate({ level: 'all' })).toBe(false)
      expect(validate({ level: 'all', badge: 'yes' })).toBe(false)
      expect(validate({ level: 'all', badge: true, sound: true })).toBe(false)
      expect(validate([])).toBe(false)
    })
  })

  describe('activity:markRead', () => {
    const validate = payloadValidators['activity:markRead']
    it('accepts { all: true } or a list of ids', () => {
      expect(validate({ all: true })).toBe(true)
      expect(validate({ ids: ['comment:github:shopwave/api#1:c1'] })).toBe(true)
    })

    it('rejects anything else', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate({})).toBe(false)
      expect(validate({ all: false })).toBe(false)
      expect(validate({ all: true, ids: ['a'] })).toBe(false)
      expect(validate({ ids: [] })).toBe(false)
      expect(validate({ ids: [''] })).toBe(false)
      expect(validate({ ids: [1] })).toBe(false)
      expect(validate({ ids: 'a' })).toBe(false)
      expect(validate({ ids: ['x'.repeat(601)] })).toBe(false)
      expect(validate({ ids: Array.from({ length: 501 }, (_, i) => 'id' + i) })).toBe(false)
    })
  })

  describe('activity:dismiss', () => {
    const validate = payloadValidators['activity:dismiss']
    it('accepts exactly { ids } with 1..500 ids', () => {
      expect(validate({ ids: ['orphan:github:shopwave/api#2:1'] })).toBe(true)
      expect(validate({ ids: Array.from({ length: 500 }, (_, i) => 'id' + i) })).toBe(true)
    })

    it('rejects anything else (there is no "dismiss all")', () => {
      expect(validate(undefined)).toBe(false)
      expect(validate({ all: true })).toBe(false)
      expect(validate({ ids: ['a'], all: true })).toBe(false)
      expect(validate({ ids: [] })).toBe(false)
      expect(validate({ ids: [''] })).toBe(false)
      expect(validate({ ids: [null] })).toBe(false)
      expect(validate({ ids: ['x'.repeat(601)] })).toBe(false)
      expect(validate({ ids: Array.from({ length: 501 }, (_, i) => 'id' + i) })).toBe(false)
      expect(validate(['a'])).toBe(false)
    })
  })

  describe('activity:get', () => {
    it('takes no payload', () => {
      expect(payloadValidators['activity:get'](undefined)).toBe(true)
      expect(payloadValidators['activity:get']({})).toBe(false)
    })
  })

  describe('scm:getDashboard', () => {
    const validate = payloadValidators['scm:getDashboard']
    it('accepts nothing or { refresh: boolean }', () => {
      expect(validate(undefined)).toBe(true)
      expect(validate({})).toBe(true)
      expect(validate({ refresh: true })).toBe(true)
      expect(validate({ refresh: false })).toBe(true)
    })

    it('rejects anything else', () => {
      expect(validate(null)).toBe(false)
      expect(validate('refresh')).toBe(false)
      expect(validate([])).toBe(false)
      expect(validate({ refresh: 'yes' })).toBe(false)
      expect(validate({ refresh: 1 })).toBe(false)
      expect(validate({ refresh: true, provider: 'github' })).toBe(false)
      expect(validate(Object.create({ refresh: true }))).toBe(false)
    })
  })

  describe('scm:setProviderSettings', () => {
    const validate = payloadValidators['scm:setProviderSettings']
    const azure = {
      enabled: true,
      organizations: [{ organization: 'Skyllful', projects: ['Virtual Competency Builder'] }],
    }

    it('accepts either block or both', () => {
      expect(validate({ github: { enabled: false } })).toBe(true)
      expect(validate({ azure })).toBe(true)
      expect(validate({ github: { enabled: true }, azure })).toBe(true)
      expect(validate({ azure: { enabled: false, organizations: [] } })).toBe(true)
    })

    it('rejects empty payloads, bad names, duplicates and extra keys', () => {
      expect(validate({})).toBe(false)
      expect(validate({ github: { enabled: 'yes' } })).toBe(false)
      expect(validate({ github: { enabled: true, x: 1 } })).toBe(false)
      const org = (organization: string, projects: string[] = []) => ({
        azure: { enabled: true, organizations: [{ organization, projects }] },
      })
      expect(validate(org('https://dev.azure.com/x'))).toBe(false)
      expect(validate(org('-bad'))).toBe(false)
      expect(validate(org('ok', ['a/b']))).toBe(false)
      expect(validate(org('ok', ['_hidden']))).toBe(false)
      expect(validate(org('ok', ['A', 'a']))).toBe(false)
    })

    it('caps Azure settings at 5 organizations x 30 projects', () => {
      const orgs = (count: number, projects = 0) => ({
        azure: {
          enabled: true,
          organizations: Array.from({ length: count }, (_, i) => ({
            organization: 'org' + i,
            projects: Array.from({ length: projects }, (_, j) => 'p' + j),
          })),
        },
      })
      expect(validate(orgs(5, 30))).toBe(true)
      expect(validate(orgs(6))).toBe(false)
      expect(validate(orgs(1, 31))).toBe(false)
      expect(
        validate({
          azure: {
            enabled: true,
            organizations: [
              { organization: 'Same', projects: [] },
              { organization: 'same', projects: [] },
            ],
          },
        }),
      ).toBe(false)
    })
  })

  describe('scm:listAzureProjects', () => {
    const validate = payloadValidators['scm:listAzureProjects']
    it('accepts an organization name only', () => {
      expect(validate({ organization: 'Skyllful' })).toBe(true)
      expect(validate({ organization: 'dev.azure.com/x' })).toBe(false)
      expect(validate({ organization: '' })).toBe(false)
      expect(validate({ organization: 'a', more: 1 })).toBe(false)
    })
  })
  describe('settings:setAppearance', () => {
    const validate = payloadValidators['settings:setAppearance']
    it('accepts full, canonical appearance settings only', () => {
      expect(validate(DEFAULT_APPEARANCE_SETTINGS)).toBe(true)
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, mode: 'dim' })).toBe(false)
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, contrast: 500 })).toBe(false)
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, darkTheme: 'missing' })).toBe(false)
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, extra: true })).toBe(false)
      const { contrast: _contrast, ...withoutContrast } = DEFAULT_APPEARANCE_SETTINGS
      expect(validate(withoutContrast)).toBe(false)
      expect(validate(undefined)).toBe(false)
    })

    it('refuses a custom theme with a color that is not canonical', () => {
      const colors = getThemeColorsForMode(getBuiltInTheme('grove')!, 'dark')!
      const theme = { id: 'mine', label: 'Mine', appearance: 'dark', colors }
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, customThemes: [theme] })).toBe(true)
      for (const canvas of ['#000', 'red', 'oklch(0 0 0); background: url(x)', 'var(--x)']) {
        const bad = { ...theme, colors: { ...colors, canvas } }
        expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, customThemes: [bad] })).toBe(false)
      }
    })

    it('caps the number of custom themes', () => {
      const colors = getThemeColorsForMode(getBuiltInTheme('grove')!, 'dark')!
      const many = Array.from({ length: 65 }, (_, i) => ({
        id: 'theme-' + i,
        label: 'Theme ' + i,
        appearance: 'dark',
        colors,
      }))
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, customThemes: many })).toBe(false)
      expect(validate({ ...DEFAULT_APPEARANCE_SETTINGS, customThemes: many.slice(0, 64) })).toBe(
        true,
      )
    })
  })

  describe('themes:searchOpenVsx / themes:installOpenVsx', () => {
    const search = payloadValidators['themes:searchOpenVsx']
    const install = payloadValidators['themes:installOpenVsx']
    it('search takes a short query and a known sort', () => {
      expect(search({ query: 'night owl' })).toBe(true)
      expect(search({ query: 'x', sortBy: 'downloadCount' })).toBe(true)
      expect(search({ query: '' })).toBe(false)
      expect(search({ query: 'x'.repeat(101) })).toBe(false)
      expect(search({ query: 'x', sortBy: 'evil' })).toBe(false)
      expect(search({ query: 'x', url: 'https://evil.example' })).toBe(false)
    })

    it('install takes an extension identity, never a URL', () => {
      expect(install({ namespace: 'sdras', name: 'night-owl' })).toBe(true)
      expect(install({ namespace: 'sdras', name: '../../etc' })).toBe(false)
      expect(install({ namespace: 'https://evil.example', name: 'x' })).toBe(false)
      expect(install({ namespace: 'sdras', name: 'night-owl', url: 'x' })).toBe(false)
      expect(install({ namespace: 'sdras' })).toBe(false)
    })
  })
})
