/**
 * The Azure DevOps `ScmProvider` factory.
 *
 * - Real: `AzureScmProvider` with the `az` credential bridge and the REST
 *   client over Node's `fetch`.
 * - Mock (`MINERVA_MOCK=1`): the SAME `AzureScmProvider`, but its client
 *   talks to the in-memory fake server (`./fixtures/fake-server.ts`, org
 *   "contoso"), auth is always `signed_in`, and `writeSnapshot` writes the
 *   fixture files directly (no zip). Writes mutate the fake's memory only.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { ScmError } from '../errors'
import type { SnapshotRequest } from '../provider'
import { AzureScmProvider, type AzureProviderConfig } from './azure-provider'
import { AzureDevOpsClient, type CredentialProvider } from './client'
import { AzureCredentialSource } from './credentials'
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

export class MockAzureScmProvider extends AzureScmProvider {
  constructor(
    private readonly server: FakeAzureServer,
    getConfig: () => AzureProviderConfig,
  ) {
    super({
      client: new AzureDevOpsClient({ credentials: mockAzureCredentials, fetch: server.fetch }),
      credentials: mockAzureCredentials,
      getConfig: () => {
        const config = getConfig()
        return { enabled: config.enabled, organizations: MOCK_AZURE_ORGANIZATIONS }
      },
    })
  }

  /** Cheap snapshot: the fixture files at that head commit, written straight to `destDir`. */
  override async writeSnapshot(req: SnapshotRequest, destDir: string): Promise<void> {
    if (req.repo.provider !== 'azure') {
      throw new ScmError('NOT_FOUND', 'Not an Azure DevOps repository: ' + req.repo.fullName)
    }
    const root = resolve(destDir)
    for (const file of this.server.snapshotFiles(req.repo.repositoryId, req.headSha)) {
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
