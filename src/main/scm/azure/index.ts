/**
 * The Azure DevOps `ScmProvider` factory.
 *
 * - Real: `AzureScmProvider` with the `az` credential bridge and the REST
 *   client over Node's `fetch`.
 * - Mock (`MINERVA_MOCK=1`): the SAME `AzureScmProvider`, but its client
 *   talks to the in-memory fake server (`./fixtures/fake-server.ts`, org
 *   "contoso"), auth is always `signed_in`, and `writeSnapshot` writes the
 *   fixture files directly (no zip). Writes mutate the fake's memory only.
 *   `MINERVA_MOCK_AZURE_AUTH=unauthenticated|cli_unavailable` makes the mock
 *   credential fail like a machine without `az devops login` / without `az`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { mt } from '../../i18n'
import { mockAuthOverride } from '../mock-mode'
import type { SnapshotRequest } from '../provider'
import { AzureScmProvider, type AzureProviderConfig } from './azure-provider'
import { AzureDevOpsClient, type CredentialProvider } from './client'
import { AzureCredentialSource, organizationUrl } from './credentials'
import { AzureScmError } from './errors'
import { createFakeAzureServer, type FakeAzureServer } from './fixtures/fake-server'
import { MOCK_ORG, MOCK_PROJECT } from './fixtures/universe'

export { AzureScmProvider, type AzureProviderConfig } from './azure-provider'

/** The org/projects the mock serves, whatever is saved in Settings. */
export const MOCK_AZURE_ORGANIZATIONS = [{ organization: MOCK_ORG, projects: [MOCK_PROJECT] }]

/** Shared by the provider and `scm:listAzureProjects`, so both use one credential cache. */
export const azureCredentials = new AzureCredentialSource()

export function createAzureClient(
  credentials: CredentialProvider = azureCredentials,
): AzureDevOpsClient {
  return new AzureDevOpsClient({ credentials })
}

export function createRealAzureProvider(getConfig: () => AzureProviderConfig): AzureScmProvider {
  return new AzureScmProvider({
    client: createAzureClient(),
    credentials: azureCredentials,
    getConfig,
  })
}

/** Mock credential: never leaves main, never valid anywhere but the fake server. */
export const mockAzureCredentials: CredentialProvider = {
  getAuthHeader: async () => ({ header: 'Basic bW9jazptb2Nr', source: 'az-devops-pat' }),
  invalidate: () => {},
}

/** The mock credential, or one that fails the way a signed-out machine does (`mockAuthOverride`). */
function mockCredentialsFromEnv(): CredentialProvider {
  const override = mockAuthOverride('MINERVA_MOCK_AZURE_AUTH')
  if (override !== 'unauthenticated' && override !== 'cli_unavailable') return mockAzureCredentials
  return {
    getAuthHeader: async (organization: string) => {
      const command = 'az devops login --organization ' + organizationUrl(organization)
      throw override === 'cli_unavailable'
        ? new AzureScmError('CLI_UNAVAILABLE', mt('azure.cliNotFound', { command }))
        : new AzureScmError('UNAUTHENTICATED', mt('azure.noCredential', { organization, command }))
    },
    invalidate: () => {},
  }
}

export class MockAzureScmProvider extends AzureScmProvider {
  constructor(
    private readonly server: FakeAzureServer,
    getConfig: () => AzureProviderConfig,
    credentials: CredentialProvider = mockCredentialsFromEnv(),
  ) {
    super({
      client: new AzureDevOpsClient({ credentials, fetch: server.fetch }),
      credentials,
      getConfig: () => {
        const config = getConfig()
        return { enabled: config.enabled, organizations: MOCK_AZURE_ORGANIZATIONS }
      },
    })
  }

  /** Cheap snapshot: the fixture files at that head commit, written straight to `destDir`. */
  override async writeSnapshot(req: SnapshotRequest, destDir: string): Promise<void> {
    const repo = this.scoped(req.repo)
    const root = resolve(destDir)
    for (const file of this.server.snapshotFiles(repo.repositoryId, req.headSha)) {
      const target = resolve(root, file.path.split('/').join(sep))
      if (!target.startsWith(root + sep)) continue
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content)
    }
  }
}

export function createMockAzureProvider(
  getConfig: () => AzureProviderConfig,
  latencyMs = 25,
): MockAzureScmProvider {
  return new MockAzureScmProvider(createFakeAzureServer({ latencyMs }), getConfig)
}
