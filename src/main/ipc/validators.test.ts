import { describe, expect, it } from 'vitest'
import { payloadValidators } from './validators'

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
})
