/**
 * Deterministic Azure DevOps mock universe (org "contoso", project
 * "Platform") for the future mock provider and e2e tests. Shapes are the
 * WIRE types (`../api-types.ts`), so the mock exercises the same mappers and
 * patch builder as the real provider.
 *
 * What it covers:
 * - 3 repos, 10 PRs: a 3-deep stack in orders-api, the same feature chain in
 *   storefront-web starting one branch lower (cross-repo grouping), an
 *   orphaned PR whose parent completed, a completed parent, an abandoned PR.
 * - Threads with every status, a system thread, a deleted comment, replies,
 *   a PR-level thread, a LEFT-side comment and a comment on a context line
 *   outside every hunk.
 * - A rename with edits, a pure rename, a binary file, an add and a delete.
 *
 * Blob ids are real git blob SHA-1s of the contents, so they are stable.
 *
 * Gotchas (CLAUDE.md 2/3): no backtick-delimited strings and no file content
 * that looks like an ES import statement; the esm-shim plugin's regex would
 * corrupt the main bundle.
 */
import { createHash } from 'node:crypto'
import type {
  AzChangeEntry,
  AzComment,
  AzGitRepository,
  AzIdentityRef,
  AzIteration,
  AzPullRequest,
  AzThread,
} from '../api-types'

export const MOCK_ORG = 'contoso'
export const MOCK_PROJECT = 'Platform'
const PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c'

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function person(id: string, displayName: string, uniqueName: string): AzIdentityRef {
  return { id, displayName, uniqueName }
}

export const PEOPLE = {
  ada: person('a1d0c6e8-0000-4000-8000-000000000001', 'Ada Lovelace', 'ada@contoso.example'),
  grace: person('a1d0c6e8-0000-4000-8000-000000000002', 'Grace Hopper', 'grace@contoso.example'),
  linus: person('a1d0c6e8-0000-4000-8000-000000000003', 'Linus Pauling', 'linus@contoso.example'),
  build: person(
    'a1d0c6e8-0000-4000-8000-0000000000b1',
    'Contoso Build Service',
    'build@contoso.example',
  ),
  team: {
    ...person(
      'a1d0c6e8-0000-4000-8000-0000000000f1',
      '[Platform]\\Reviewers',
      'vstfs:///Classification/TeamProject/team',
    ),
    isContainer: true,
  },
} satisfies Record<string, AzIdentityRef>

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

function repo(id: string, name: string): AzGitRepository {
  return {
    id,
    name,
    defaultBranch: 'refs/heads/main',
    project: { id: PROJECT_ID, name: MOCK_PROJECT },
    webUrl: 'https://dev.azure.com/' + MOCK_ORG + '/' + MOCK_PROJECT + '/_git/' + name,
  }
}

export const REPOS = {
  api: repo('11111111-1111-4111-8111-111111111111', 'orders-api'),
  web: repo('22222222-2222-4222-8222-222222222222', 'storefront-web'),
  infra: repo('33333333-3333-4333-8333-333333333333', 'platform-infra'),
} satisfies Record<string, AzGitRepository>

// ---------------------------------------------------------------------------
// File contents and blobs
// ---------------------------------------------------------------------------

const lines = (...rows: string[]): string => rows.join('\n') + '\n'

export function gitBlobId(content: Uint8Array): string {
  return createHash('sha1')
    .update('blob ' + content.length + '\0')
    .update(content)
    .digest('hex')
}

const blobStore = new Map<string, Buffer>()

function blob(content: string | Buffer): string {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  const id = gitBlobId(bytes)
  blobStore.set(id, bytes)
  return id
}

/** Raw blob bytes by object id (what `GET …/blobs/{id}?$format=octetstream` returns). */
export function getMockBlob(objectId: string): Buffer | null {
  return blobStore.get(objectId) ?? null
}

const ORDER_MODEL_BASE = lines(
  'namespace Contoso.Orders.Models;',
  '',
  'public sealed class Order',
  '{',
  '    public Guid Id { get; init; }',
  '    public string CustomerId { get; init; } = "";',
  '    public decimal Total { get; set; }',
  '    public DateTimeOffset CreatedAt { get; init; }',
  '}',
)

const ORDER_MODEL_HEAD = lines(
  'namespace Contoso.Orders.Models;',
  '',
  'public sealed class Order',
  '{',
  '    public Guid Id { get; init; }',
  '    public string CustomerId { get; init; } = "";',
  '    public decimal Total { get; set; }',
  '    public string Currency { get; set; } = "USD";',
  '    public OrderStatus Status { get; set; } = OrderStatus.Draft;',
  '    public DateTimeOffset CreatedAt { get; init; }',
  '}',
)

const ORDER_STATUS = lines(
  'namespace Contoso.Orders.Models;',
  '',
  'public enum OrderStatus',
  '{',
  '    Draft,',
  '    Submitted,',
  '    Paid,',
  '    Cancelled,',
  '}',
)

const CHECKOUT_SERVICE_BASE = lines(
  'namespace Contoso.Orders.Services;',
  '',
  'public sealed class CheckoutService(IOrderRepository orders)',
  '{',
  '    public async Task<Order> SubmitAsync(Guid orderId)',
  '    {',
  '        var order = await orders.GetAsync(orderId);',
  '        // Line 8: validation happens elsewhere for now.',
  '        // Line 9: kept as context.',
  '        // Line 10: kept as context.',
  '        // Line 11: kept as context.',
  '        // Line 12: kept as context.',
  '        // Line 13: kept as context.',
  '        // Line 14: kept as context.',
  '        // Line 15: kept as context.',
  '        // Line 16: kept as context.',
  '        await orders.SaveAsync(order);',
  '        return order;',
  '    }',
  '}',
)

const CHECKOUT_SERVICE_HEAD = CHECKOUT_SERVICE_BASE.replace(
  '        await orders.SaveAsync(order);\n',
  lines(
    '        if (order.Status != OrderStatus.Draft)',
    '            throw new InvalidOperationException("Only draft orders can be submitted.");',
    '        order.Status = OrderStatus.Submitted;',
    '        await orders.SaveAsync(order);',
  ),
)

const ENDPOINTS_HEAD = lines(
  'namespace Contoso.Orders.Api;',
  '',
  'public static class CheckoutEndpoints',
  '{',
  '    public static void Map(WebApplication app)',
  '    {',
  '        app.MapPost("/orders/{id:guid}/submit", async (Guid id, CheckoutService checkout) =>',
  '            Results.Ok(await checkout.SubmitAsync(id)));',
  '    }',
  '}',
)

const REFUND_SCHEMA = lines(
  'CREATE TABLE refunds (',
  '    id UUID PRIMARY KEY,',
  '    order_id UUID NOT NULL REFERENCES orders(id),',
  '    amount NUMERIC(12, 2) NOT NULL',
  ');',
)

const REFUND_LEDGER = lines(
  'CREATE TABLE refund_ledger (',
  '    id UUID PRIMARY KEY,',
  '    refund_id UUID NOT NULL REFERENCES refunds(id),',
  '    entry_type TEXT NOT NULL,',
  '    created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
  ');',
)

const CART_TOTAL_BASE = lines(
  'export function cartTotal(items: { price: number; qty: number }[]): number {',
  '  return items.reduce((sum, item) => sum + item.price * item.qty, 0)',
  '}',
)

const CART_TOTAL_HEAD = lines(
  'export function cartTotal(items: { price: number; qty: number }[]): number {',
  '  const cents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0)',
  '  return cents / 100',
  '}',
)

const CHECKOUT_PAGE_HEAD = lines(
  'export function CheckoutPage(props: { orderId: string }) {',
  '  return <SubmitOrderButton orderId={props.orderId} />',
  '}',
)

const MODELS_TS_HEAD = lines(
  'export type OrderStatus = "Draft" | "Submitted" | "Paid" | "Cancelled"',
  '',
  'export interface Order {',
  '  id: string',
  '  total: number',
  '  currency: string',
  '  status: OrderStatus',
  '}',
)

const TF_NETWORK_BASE = lines(
  'module "vnet" {',
  '  source        = "./modules/network"',
  '  address_space = ["10.0.0.0/16"]',
  '}',
)

const TF_NETWORK_HEAD = lines(
  'module "vnet" {',
  '  source        = "./modules/virtual-network"',
  '  address_space = ["10.0.0.0/16"]',
  '}',
)

const TF_README = lines('# Network module', '', 'Creates the shared virtual network.')

/** A 1x1 transparent PNG (binary on purpose). */
const LOGO_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
)
const LOGO_PNG_V2 = Buffer.concat([LOGO_PNG, Buffer.from([0x00, 0x01])])

// ---------------------------------------------------------------------------
// PRs
// ---------------------------------------------------------------------------

let shaCounter = 0
/** Deterministic fake commit id. */
function commitId(label: string): string {
  shaCounter++
  return createHash('sha1')
    .update('commit:' + label + ':' + shaCounter)
    .digest('hex')
}

interface PrSpec {
  id: number
  repo: AzGitRepository
  title: string
  source: string
  target: string
  status: AzPullRequest['status']
  author: AzIdentityRef
  created: string
  closed?: string
  isDraft?: boolean
  reviewers?: AzPullRequest['reviewers']
}

function pullRequest(spec: PrSpec): AzPullRequest {
  const pr: AzPullRequest = {
    pullRequestId: spec.id,
    codeReviewId: spec.id,
    status: spec.status,
    title: spec.title,
    description: 'Mock PR ' + spec.id + '.',
    createdBy: spec.author,
    creationDate: spec.created,
    sourceRefName: 'refs/heads/' + spec.source,
    targetRefName: 'refs/heads/' + spec.target,
    isDraft: spec.isDraft ?? false,
    mergeStatus: 'succeeded',
    lastMergeSourceCommit: { commitId: commitId('src' + spec.id) },
    lastMergeTargetCommit: { commitId: commitId('tgt' + spec.id) },
    reviewers: spec.reviewers ?? [],
    repository: spec.repo,
  }
  if (spec.closed) pr.closedDate = spec.closed
  return pr
}

const reviewer = (identity: AzIdentityRef, vote: number, isRequired = false) => ({
  ...identity,
  vote,
  isRequired,
})

export const PULL_REQUESTS: AzPullRequest[] = [
  // orders-api: completed parent of the orphan below.
  pullRequest({
    id: 100,
    repo: REPOS.api,
    title: 'Add refunds table',
    source: 'feature/refund-schema',
    target: 'main',
    status: 'completed',
    author: PEOPLE.grace,
    created: '2026-10-01T09:00:00Z',
    closed: '2026-10-06T16:00:00Z',
  }),
  // orders-api: 3-deep stack.
  pullRequest({
    id: 101,
    repo: REPOS.api,
    title: 'Checkout v2: order status and currency',
    source: 'feature/checkout-v2-models',
    target: 'main',
    status: 'active',
    author: PEOPLE.ada,
    created: '2026-10-10T10:00:00Z',
    reviewers: [reviewer(PEOPLE.grace, 10, true), reviewer(PEOPLE.team, 0, true)],
  }),
  pullRequest({
    id: 102,
    repo: REPOS.api,
    title: 'Checkout v2: submit validation',
    source: 'feature/checkout-v2-service',
    target: 'feature/checkout-v2-models',
    status: 'active',
    author: PEOPLE.ada,
    created: '2026-10-11T10:00:00Z',
    reviewers: [reviewer(PEOPLE.grace, 5), reviewer(PEOPLE.linus, -5)],
  }),
  pullRequest({
    id: 103,
    repo: REPOS.api,
    title: 'Checkout v2: submit endpoint',
    source: 'feature/checkout-v2-endpoints',
    target: 'feature/checkout-v2-service',
    status: 'active',
    author: PEOPLE.ada,
    created: '2026-10-12T10:00:00Z',
    isDraft: true,
  }),
  // orders-api: orphan (parent #100 completed; target branch still exists).
  pullRequest({
    id: 105,
    repo: REPOS.api,
    title: 'Refund ledger',
    source: 'feature/refund-ledger',
    target: 'feature/refund-schema',
    status: 'active',
    author: PEOPLE.grace,
    created: '2026-10-03T12:00:00Z',
    reviewers: [reviewer(PEOPLE.ada, -10)],
  }),
  // storefront-web: same feature chain, starting one branch lower.
  pullRequest({
    id: 110,
    repo: REPOS.web,
    title: 'Checkout v2: client models',
    source: 'feature/checkout-v2-models',
    target: 'main',
    status: 'active',
    author: PEOPLE.linus,
    created: '2026-10-10T11:00:00Z',
  }),
  pullRequest({
    id: 104,
    repo: REPOS.web,
    title: 'Checkout v2: submit button',
    source: 'feature/checkout-v2-ui',
    target: 'feature/checkout-v2-models',
    status: 'active',
    author: PEOPLE.linus,
    created: '2026-10-11T11:00:00Z',
  }),
  // storefront-web: standalone PR carrying every thread status.
  pullRequest({
    id: 108,
    repo: REPOS.web,
    title: 'Fix cart rounding',
    source: 'fix/cart-rounding',
    target: 'main',
    status: 'active',
    author: PEOPLE.grace,
    created: '2026-10-14T08:00:00Z',
    reviewers: [reviewer(PEOPLE.ada, 10), reviewer(PEOPLE.linus, 0)],
  }),
  // storefront-web: abandoned.
  pullRequest({
    id: 107,
    repo: REPOS.web,
    title: 'Try a new cart layout',
    source: 'spike/cart-layout',
    target: 'main',
    status: 'abandoned',
    author: PEOPLE.linus,
    created: '2026-09-20T08:00:00Z',
    closed: '2026-09-25T08:00:00Z',
  }),
  // platform-infra: rename + binary.
  pullRequest({
    id: 106,
    repo: REPOS.infra,
    title: 'Rename network module',
    source: 'chore/rename-network-module',
    target: 'main',
    status: 'active',
    author: PEOPLE.grace,
    created: '2026-10-15T08:00:00Z',
  }),
]

// ---------------------------------------------------------------------------
// Iterations and changes
// ---------------------------------------------------------------------------

interface ChangeSpec {
  path: string
  changeType: string
  base?: string | Buffer
  head?: string | Buffer
  originalPath?: string
}

let changeTrackingSeq = 0

function change(spec: ChangeSpec): AzChangeEntry {
  changeTrackingSeq++
  const item: AzChangeEntry['item'] = { path: spec.path, gitObjectType: 'blob' }
  if (spec.head !== undefined) item.objectId = blob(spec.head)
  if (spec.base !== undefined) item.originalObjectId = blob(spec.base)
  const entry: AzChangeEntry = {
    changeTrackingId: changeTrackingSeq,
    changeId: changeTrackingSeq,
    item,
    changeType: spec.changeType,
  }
  if (spec.originalPath) entry.originalPath = spec.originalPath
  return entry
}

/** Changes of the LATEST iteration compared to the base (`$compareTo=0`), per PR id. */
export const CHANGES: Record<number, AzChangeEntry[]> = {
  100: [
    change({ path: '/db/migrations/0007_refunds.sql', changeType: 'add', head: REFUND_SCHEMA }),
  ],
  101: [
    change({
      path: '/src/Models/Order.cs',
      changeType: 'edit',
      base: ORDER_MODEL_BASE,
      head: ORDER_MODEL_HEAD,
    }),
    change({ path: '/src/Models/OrderStatus.cs', changeType: 'add', head: ORDER_STATUS }),
  ],
  102: [
    change({
      path: '/src/Services/CheckoutService.cs',
      changeType: 'edit',
      base: CHECKOUT_SERVICE_BASE,
      head: CHECKOUT_SERVICE_HEAD,
    }),
  ],
  103: [change({ path: '/src/Api/CheckoutEndpoints.cs', changeType: 'add', head: ENDPOINTS_HEAD })],
  105: [
    change({
      path: '/db/migrations/0008_refund_ledger.sql',
      changeType: 'add',
      head: REFUND_LEDGER,
    }),
  ],
  110: [change({ path: '/src/models/order.ts', changeType: 'add', head: MODELS_TS_HEAD })],
  104: [
    change({ path: '/src/pages/CheckoutPage.tsx', changeType: 'add', head: CHECKOUT_PAGE_HEAD }),
  ],
  108: [
    change({
      path: '/src/cart/total.ts',
      changeType: 'edit',
      base: CART_TOTAL_BASE,
      head: CART_TOTAL_HEAD,
    }),
  ],
  107: [
    change({
      path: '/src/cart/legacy-layout.css',
      changeType: 'delete',
      base: lines('.cart { display: grid; }'),
    }),
  ],
  106: [
    change({
      path: '/modules/virtual-network/main.tf',
      originalPath: '/modules/network/main.tf',
      changeType: 'edit, rename',
      base: TF_NETWORK_BASE,
      head: TF_NETWORK_HEAD,
    }),
    change({
      path: '/modules/virtual-network/README.md',
      originalPath: '/modules/network/README.md',
      changeType: 'rename',
      base: TF_README,
      head: TF_README,
    }),
    change({ path: '/docs/logo.png', changeType: 'edit', base: LOGO_PNG, head: LOGO_PNG_V2 }),
    change({
      path: '/modules/network/legacy.tf',
      changeType: 'delete',
      base: lines('# deprecated'),
    }),
  ],
}

function iterationsFor(pr: AzPullRequest): AzIteration[] {
  const head = pr.lastMergeSourceCommit?.commitId ?? ''
  const target = pr.lastMergeTargetCommit?.commitId ?? ''
  const first: AzIteration = {
    id: 1,
    author: pr.createdBy,
    createdDate: pr.creationDate,
    reason: 'create',
    sourceRefCommit: { commitId: pr.pullRequestId === 102 ? commitId('first102') : head },
    targetRefCommit: { commitId: target },
  }
  // #102 got a second push after review started: line comments on
  // iteration 1 refer to that older iteration (see `AzureThreadLite.iteration`).
  if (pr.pullRequestId !== 102) return [first]
  return [
    first,
    {
      id: 2,
      author: pr.createdBy,
      createdDate: '2026-10-13T09:00:00Z',
      reason: 'push',
      sourceRefCommit: { commitId: head },
      targetRefCommit: { commitId: target },
    },
  ]
}

export const ITERATIONS: Record<number, AzIteration[]> = Object.fromEntries(
  PULL_REQUESTS.map((pr) => [pr.pullRequestId, iterationsFor(pr)]),
)

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

let commentClock = Date.parse('2026-10-14T09:00:00Z')
function at(): string {
  commentClock += 7 * 60 * 1000
  return new Date(commentClock).toISOString()
}

function comment(
  id: number,
  author: AzIdentityRef,
  content: string,
  extra: Partial<AzComment> = {},
): AzComment {
  const date = at()
  return {
    id,
    parentCommentId: id === 1 ? 0 : 1,
    author,
    content,
    publishedDate: date,
    lastUpdatedDate: date,
    lastContentUpdatedDate: date,
    commentType: 'text',
    ...extra,
  }
}

interface ThreadSpec {
  id: number
  status?: AzThread['status']
  comments: AzComment[]
  filePath?: string
  right?: [number, number]
  left?: [number, number]
  changeTrackingId?: number
  iteration?: [number, number]
  isDeleted?: boolean
}

function thread(spec: ThreadSpec): AzThread {
  const published = spec.comments[0]?.publishedDate ?? at()
  const last = spec.comments[spec.comments.length - 1]?.publishedDate ?? published
  const t: AzThread = {
    id: spec.id,
    publishedDate: published,
    lastUpdatedDate: last,
    comments: spec.comments,
    threadContext: null,
  }
  if (spec.status) t.status = spec.status
  if (spec.isDeleted) t.isDeleted = true
  if (spec.filePath) {
    t.threadContext = { filePath: spec.filePath }
    if (spec.right) {
      t.threadContext.rightFileStart = { line: spec.right[0], offset: 1 }
      t.threadContext.rightFileEnd = { line: spec.right[1], offset: 1 }
    }
    if (spec.left) {
      t.threadContext.leftFileStart = { line: spec.left[0], offset: 1 }
      t.threadContext.leftFileEnd = { line: spec.left[1], offset: 1 }
    }
    if (spec.changeTrackingId !== undefined) {
      const [first, second] = spec.iteration ?? [1, 1]
      t.pullRequestThreadContext = {
        changeTrackingId: spec.changeTrackingId,
        iterationContext: { firstComparingIteration: first, secondComparingIteration: second },
      }
    }
  }
  return t
}

const trackingId = (prId: number, path: string): number =>
  CHANGES[prId].find((entry) => entry.item.path === path)?.changeTrackingId ?? 0

const CART = '/src/cart/total.ts'
const SERVICE = '/src/Services/CheckoutService.cs'

export const THREADS: Record<number, AzThread[]> = {
  108: [
    thread({
      id: 1,
      status: 'active',
      filePath: CART,
      right: [2, 3],
      changeTrackingId: trackingId(108, CART),
      comments: [
        comment(1, PEOPLE.ada, 'Why cents? A short comment here would help the next reader.'),
        comment(2, PEOPLE.grace, 'Floating point: 0.1 + 0.2. I will add a comment.'),
        comment(3, PEOPLE.ada, 'Thanks!'),
      ],
    }),
    thread({
      id: 2,
      status: 'pending',
      filePath: CART,
      right: [1, 1],
      changeTrackingId: trackingId(108, CART),
      comments: [comment(1, PEOPLE.linus, 'Pending: should this accept readonly arrays?')],
    }),
    thread({
      id: 3,
      status: 'fixed',
      filePath: CART,
      left: [2, 2],
      changeTrackingId: trackingId(108, CART),
      comments: [
        comment(1, PEOPLE.ada, 'The old version rounded nothing at all (left side).'),
        comment(2, PEOPLE.grace, 'Fixed in this PR.'),
      ],
    }),
    thread({
      id: 4,
      status: 'wontFix',
      comments: [comment(1, PEOPLE.linus, 'Could we move cart math to the API?')],
    }),
    thread({
      id: 5,
      status: 'closed',
      comments: [
        comment(1, PEOPLE.grace, 'Closing: discussed offline.'),
        comment(2, PEOPLE.linus, 'This comment was removed.', { isDeleted: true }),
      ],
    }),
    thread({
      id: 6,
      status: 'byDesign',
      filePath: CART,
      right: [4, 4],
      changeTrackingId: trackingId(108, CART),
      comments: [
        comment(1, PEOPLE.linus, 'Returning a float again?'),
        comment(2, PEOPLE.grace, 'By design: the UI formats it.'),
      ],
    }),
    // System thread (vote update): must be filtered out.
    thread({
      id: 7,
      comments: [comment(1, PEOPLE.ada, 'Ada Lovelace voted 10', { commentType: 'system' })],
    }),
    // Deleted thread: must be filtered out.
    thread({
      id: 8,
      status: 'active',
      isDeleted: true,
      comments: [comment(1, PEOPLE.linus, 'Never mind.')],
    }),
  ],
  102: [
    // Context line 12 is outside every hunk of the latest diff (the only hunk is new lines 14-22).
    thread({
      id: 1,
      status: 'active',
      filePath: SERVICE,
      right: [12, 12],
      changeTrackingId: trackingId(102, SERVICE),
      iteration: [1, 2],
      comments: [
        comment(1, PEOPLE.linus, 'Unrelated to the change, but this comment block is stale.'),
      ],
    }),
    // Anchored to iteration 1 (before the second push).
    thread({
      id: 2,
      status: 'active',
      filePath: SERVICE,
      right: [17, 17],
      changeTrackingId: trackingId(102, SERVICE),
      iteration: [1, 1],
      comments: [
        comment(1, PEOPLE.grace, 'Validate the status before saving.'),
        comment(2, PEOPLE.ada, 'Done in the next push.'),
      ],
    }),
  ],
  105: [
    thread({
      id: 1,
      status: 'active',
      comments: [
        comment(
          1,
          PEOPLE.ada,
          'This still targets feature/refund-schema, which already merged. Retarget to main?',
        ),
      ],
    }),
  ],
}

/** Active PRs, as `git/pullrequests?searchCriteria.status=active` returns them. */
export function mockPullRequestsByStatus(
  status: 'active' | 'completed' | 'abandoned' | 'all',
): AzPullRequest[] {
  return PULL_REQUESTS.filter((pr) => status === 'all' || pr.status === status)
}

/** Branches that exist on the mock remote, per repo id (the orphan's stale target still exists). */
export const BRANCHES: Record<string, string[]> = {
  [REPOS.api.id]: [
    'main',
    'feature/refund-schema',
    'feature/refund-ledger',
    'feature/checkout-v2-models',
    'feature/checkout-v2-service',
    'feature/checkout-v2-endpoints',
  ],
  [REPOS.web.id]: [
    'main',
    'feature/checkout-v2-models',
    'feature/checkout-v2-ui',
    'fix/cart-rounding',
  ],
  [REPOS.infra.id]: ['main', 'chore/rename-network-module'],
}
