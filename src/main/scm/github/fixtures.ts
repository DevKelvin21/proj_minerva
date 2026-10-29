/**
 * Fixtures del universo mock "shopwave": 8 PRs repartidos en 3 repos, con
 * archivos (`DiffFile`, patches unified válidos) e hilos de comentarios.
 *
 * The mock's signed-in user is `mgarcia` (`MOCK_GITHUB_LOGIN`, also what
 * `MINERVA_MOCK_GH_AUTH=signed_in` reports). Open PRs by relation (home
 * dashboard): author of api#482, api#470, checkout-service#74; review
 * requested on api#479, checkout-service#77, web#201; uninvolved in web#198,
 * web#190. Label `endpoint` spans api + checkout-service (both open).
 *
 * Migrado desde `src/renderer/src/mocks/pull-requests.ts` (T3) a `main` (T4):
 * la fuente de verdad de datos de PRs ahora vive en el proceso principal y se
 * sirve al renderer vía IPC (`MockGithubService` en `./mock-service.ts`).
 */
import type {
  CommentThread,
  DiffFile,
  PrReviewer,
  PullRequestDetail,
  UserRef,
} from '../../../shared/types'
import { prWebUrl, type GithubRepoRef, type ReviewerVote } from '../../../shared/scm'
import { githubRepo } from '../../../shared/scm-guards'

function reviewer(user: UserRef, vote: ReviewerVote = 'none', isRequired = false): PrReviewer {
  return { user, vote, isRequired }
}

const mgarcia: UserRef = {
  login: 'mgarcia',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1001?v=4',
}

/** The mock universe's signed-in user ("me"). */
export const MOCK_GITHUB_LOGIN = mgarcia.login
const jrivas: UserRef = {
  login: 'jrivas',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1002?v=4',
}
const lchen: UserRef = {
  login: 'lchen',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1003?v=4',
}
const sfontaine: UserRef = {
  login: 'sfontaine',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1004?v=4',
}
const dkumar: UserRef = {
  login: 'dkumar',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1005?v=4',
}

const apiRepo: GithubRepoRef = githubRepo('shopwave', 'api')
const webRepo: GithubRepoRef = githubRepo('shopwave', 'web')
const checkoutRepo: GithubRepoRef = githubRepo('shopwave', 'checkout-service')

export interface PrFixture {
  detail: PullRequestDetail
  files: DiffFile[]
  threads: CommentThread[]
  /**
   * Files at older commits of the PR (commit -> path -> text), what a thread
   * origin points at. A path missing under a commit did not exist there.
   */
  commitFiles?: Record<string, Record<string, string>>
  /** Head files the snapshot fixture does not carry (path -> text). */
  headFiles?: Record<string, string>
  /** Paths whose first read at a commit fails (NETWORK), to exercise Retry. */
  failFirstCommitRead?: string[]
}

/** #470's first and third commits (threads written before later pushes). */
const PUSH_470_FIRST = '4700a11c4700a11c4700a11c4700a11c4700a11c'
const PUSH_470_THIRD = '4700c33c4700c33c4700c33c4700c33c4700c33c'

/**
 * #482's coupon-service.ts at head: the lines its diff adds, so the active
 * thread on line 16 (about `coupon.discountRate`, used on line 18) shows its code.
 */
const COUPON_SERVICE_482 =
  "import { Cart } from '../models/cart'\n" +
  '\n' +
  'export interface ApplyCouponResult {\n' +
  '  ok: boolean\n' +
  '  total: number\n' +
  '  reason?: string\n' +
  '}\n' +
  '\n' +
  'export const CouponService = {\n' +
  '  async apply(cart: Cart, code: string): Promise<ApplyCouponResult> {\n' +
  '    const coupon = await findByCode(code)\n' +
  '    if (!coupon || coupon.expiresAt < new Date()) {\n' +
  "      return { ok: false, total: cart.total, reason: 'expired_or_missing' }\n" +
  '    }\n' +
  '    if (cart.appliedCouponCode) {\n' +
  "      return { ok: false, total: cart.total, reason: 'already_applied' }\n" +
  '    }\n' +
  '    const total = cart.total * (1 - coupon.discountRate)\n' +
  '    return { ok: true, total }\n' +
  '  },\n' +
  '}\n'

const RATE_LIMIT_HEAD =
  "import { RequestHandler } from 'express'\n" +
  "import { redis } from '../lib/redis'\n" +
  '\n' +
  'const WINDOW_SECONDS = 60\n' +
  '\n' +
  'export function rateLimit(limitPerMinute = 60): RequestHandler {\n' +
  '  return async (req, res, next) => {\n' +
  "    const key = 'ratelimit:' + req.ip\n" +
  '    const count = await redis.incr(key)\n' +
  '    if (count === 1) await redis.expire(key, WINDOW_SECONDS)\n' +
  '    if (count > limitPerMinute) {\n' +
  "      res.status(429).json({ error: 'rate_limited' })\n" +
  '      return\n' +
  '    }\n' +
  '    next()\n' +
  '  }\n' +
  '}\n'

/** At the third commit: the expiry was set on every request (line 8), before the fix. */
const RATE_LIMIT_THIRD =
  "import { RequestHandler } from 'express'\n" +
  "import { redis } from '../lib/redis'\n" +
  '\n' +
  'export function rateLimit(limitPerMinute = 60): RequestHandler {\n' +
  '  return async (req, res, next) => {\n' +
  "    const key = 'ratelimit:' + req.ip\n" +
  '    const count = await redis.incr(key)\n' +
  '    await redis.expire(key, 60)\n' +
  '    if (count > limitPerMinute) {\n' +
  "      res.status(429).json({ error: 'rate_limited' })\n" +
  '      return\n' +
  '    }\n' +
  '    next()\n' +
  '  }\n' +
  '}\n'

const APP_470 =
  "import express from 'express'\n" +
  "import { registerCartRoutes } from './routes/carts'\n" +
  "import { rateLimit } from './middleware/rate-limit'\n" +
  '\n' +
  'const app = express()\n' +
  'app.use(rateLimit())\n' +
  'registerCartRoutes(app)\n'

/** Added by #470's first commit, removed by a later one. */
const TOKEN_BUCKET_FIRST =
  'export interface TokenBucket {\n' +
  '  capacity: number\n' +
  '  refillPerSecond: number\n' +
  '  tokens: number\n' +
  '  updatedAt: number\n' +
  '}\n' +
  '\n' +
  'export function take(bucket: TokenBucket, now: number): boolean {\n' +
  '  const elapsed = (now - bucket.updatedAt) / 1000\n' +
  '  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerSecond)\n' +
  '  bucket.updatedAt = now\n' +
  '  if (bucket.tokens < 1) return false\n' +
  '  bucket.tokens -= 1\n' +
  '  return true\n' +
  '}\n'

export const prFixtures: PrFixture[] = [
  {
    detail: {
      id: 'shopwave/api#482',
      number: 482,
      title: 'Add POST /carts/:id/apply-coupon endpoint',
      author: mgarcia,
      repo: apiRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-07-02T14:20:00.000Z',
      updatedAt: '2026-07-04T09:12:00.000Z',
      headRef: 'feature/coupon-endpoint',
      baseRef: 'main',
      webUrl: prWebUrl(apiRepo, 482),
      headSha: 'a482f001a482f001a482f001a482f001a482f001',
      commentCount: 2,
      reviewDecision: 'review_required',
      ciStatus: 'success',
      additions: 96,
      deletions: 4,
      changedFiles: 3,
      bodyMarkdown:
        '## Qué hace\n\nAgrega `POST /api/v1/carts/:id/apply-coupon` para validar y aplicar un cupón a un carrito activo.\n\n- Valida vigencia y monto mínimo del cupón.\n- Recalcula el total del carrito.\n- Devuelve 409 si el cupón ya fue aplicado.\n\n## Cómo probar\n\n```bash\ncurl -X POST localhost:3000/api/v1/carts/123/apply-coupon -d \'{"code":"WELCOME10"}\'\n```',
      labels: [
        { name: 'endpoint', color: '14b8a6' },
        { name: 'backend', color: '2563eb' },
      ],
      reviewers: [reviewer(dkumar, 'none', true)],
      commits: 5,
    },
    files: [
      {
        path: 'src/routes/carts.ts',
        status: 'modified',
        additions: 14,
        deletions: 1,
        isBinary: false,
        patch:
          "@@ -10,6 +10,7 @@ import { Router } from 'express'\n import { CartService } from '../services/cart-service'\n import { OrderRepository } from '../repositories/order-repository'\n+import { CouponService } from '../services/coupon-service'\n \n export function registerCartRoutes(router: Router): void {\n   router.get('/carts/:id', getCartHandler)\n@@ -18,4 +19,17 @@ export function registerCartRoutes(router: Router): void {\n   router.post('/carts/:id/checkout', checkoutHandler)\n+  router.post('/carts/:id/apply-coupon', applyCouponHandler)\n }\n+\n+async function applyCouponHandler(req: Request, res: Response): Promise<void> {\n+  const cart = await CartService.get(req.params.id)\n+  const result = await CouponService.apply(cart, req.body.code)\n+  res.status(result.ok ? 200 : 409).json(result)\n+}",
      },
      {
        path: 'src/services/coupon-service.ts',
        status: 'added',
        additions: 58,
        deletions: 0,
        isBinary: false,
        patch:
          "@@ -0,0 +1,58 @@\n+import { Cart } from '../models/cart'\n+\n+export interface ApplyCouponResult {\n+  ok: boolean\n+  total: number\n+  reason?: string\n+}\n+\n+export const CouponService = {\n+  async apply(cart: Cart, code: string): Promise<ApplyCouponResult> {\n+    const coupon = await findByCode(code)\n+    if (!coupon || coupon.expiresAt < new Date()) {\n+      return { ok: false, total: cart.total, reason: 'expired_or_missing' }\n+    }\n+    if (cart.appliedCouponCode) {\n+      return { ok: false, total: cart.total, reason: 'already_applied' }\n+    }\n+    const total = cart.total * (1 - coupon.discountRate)\n+    return { ok: true, total }\n+  },\n+}",
      },
      {
        path: 'src/services/coupon-service.test.ts',
        status: 'added',
        additions: 24,
        deletions: 0,
        isBinary: false,
        patch:
          "@@ -0,0 +1,24 @@\n+import { describe, expect, it } from 'vitest'\n+import { CouponService } from './coupon-service'\n+\n+describe('CouponService.apply', () => {\n+  it('rejects an expired coupon', async () => {\n+    const result = await CouponService.apply(cartFixture(), 'EXPIRED')\n+    expect(result.ok).toBe(false)\n+  })\n+})",
      },
    ],
    threads: [
      {
        id: 'thread-482-1',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        path: 'src/services/coupon-service.ts',
        line: 16,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-482-1',
            author: dkumar,
            bodyMarkdown:
              '¿Qué pasa si `coupon.discountRate` viene en 1 (100%)? Deberíamos poner un tope.',
            createdAt: '2026-07-03T10:05:00.000Z',
            isMinimized: false,
          },
          {
            id: 'c-482-2',
            author: mgarcia,
            bodyMarkdown: 'Buen punto, agrego un clamp a 0.9 máximo antes de mergear.',
            createdAt: '2026-07-03T11:40:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-482-2',
        status: 'active',
        isResolved: false,
        isLineThread: false,
        comments: [
          {
            id: 'c-482-3',
            author: dkumar,
            bodyMarkdown:
              'En general se ve bien, falta el caso de cupón ya aplicado en el test suite.',
            createdAt: '2026-07-04T09:00:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
    headFiles: { 'src/services/coupon-service.ts': COUPON_SERVICE_482 },
  },
  {
    detail: {
      id: 'shopwave/api#479',
      number: 479,
      title: 'Add refunds table and migration for partial refunds',
      author: jrivas,
      repo: apiRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-06-30T08:00:00.000Z',
      updatedAt: '2026-07-04T16:45:00.000Z',
      headRef: 'feature/refunds-schema',
      baseRef: 'main',
      webUrl: prWebUrl(apiRepo, 479),
      headSha: 'b479f002b479f002b479f002b479f002b479f002',
      commentCount: 0,
      reviewDecision: null,
      ciStatus: 'pending',
      additions: 140,
      deletions: 6,
      changedFiles: 3,
      bodyMarkdown:
        '## Qué hace\n\nIntroduce la tabla `refunds` para soportar reembolsos parciales por línea de orden.\n\n- Migración `create_refunds`.\n- Modelo `Refund` con relación a `Order`.\n- Campo `refundedAmount` calculado en `Order`.\n\n## Riesgo\n\nMigración aditiva (no toca datos existentes), segura para desplegar antes del feature flag.',
      labels: [
        { name: 'schema', color: 'a855f7' },
        { name: 'backend', color: '2563eb' },
      ],
      reviewers: [reviewer(mgarcia)],
      commits: 3,
    },
    files: [
      {
        path: 'migrations/2026070401_create_refunds.sql',
        status: 'added',
        additions: 22,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,22 @@\n+CREATE TABLE refunds (\n+  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n+  order_id UUID NOT NULL REFERENCES orders(id),\n+  order_line_id UUID NOT NULL REFERENCES order_lines(id),\n+  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),\n+  reason TEXT,\n+  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n+);\n+\n+CREATE INDEX idx_refunds_order_id ON refunds(order_id);',
      },
      {
        path: 'src/models/refund.ts',
        status: 'added',
        additions: 34,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,34 @@\n+export interface Refund {\n+  id: string\n+  orderId: string\n+  orderLineId: string\n+  amountCents: number\n+  reason?: string\n+  createdAt: string\n+}',
      },
      {
        path: 'src/models/order.ts',
        status: 'modified',
        additions: 8,
        deletions: 1,
        isBinary: false,
        patch:
          '@@ -22,7 +22,14 @@ export interface Order {\n   status: OrderStatus\n-  total: number\n+  total: number\n+  refundedAmount: number\n }',
      },
    ],
    threads: [
      {
        id: 'thread-479-1',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        path: 'migrations/2026070401_create_refunds.sql',
        line: 5,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-479-1',
            author: mgarcia,
            bodyMarkdown:
              '¿Por qué CHECK (amount_cents > 0) y no también un tope máximo contra order_lines.amount_cents? Así evitamos reembolsar de más por error.',
            createdAt: '2026-07-02T09:10:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-479-2',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        path: 'src/models/refund.ts',
        line: 5,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-479-2',
            author: dkumar,
            bodyMarkdown:
              '`amountCents` en number me preocupa un poco para montos grandes, pero como es entero está bien mientras no pasemos Number.MAX_SAFE_INTEGER.',
            createdAt: '2026-07-02T10:30:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-479-3',
        status: 'resolved',
        isResolved: true,
        isLineThread: true,
        path: 'src/models/order.ts',
        line: 24,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-479-3',
            author: jrivas,
            bodyMarkdown:
              '`refundedAmount` se recalcula en el mismo servicio que crea el `Refund`, no es un trigger de base de datos.',
            createdAt: '2026-07-03T15:00:00.000Z',
            isMinimized: false,
          },
          {
            id: 'c-479-4',
            author: mgarcia,
            bodyMarkdown: 'Gracias, con eso alcanza.',
            createdAt: '2026-07-03T15:20:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
  },
  {
    detail: {
      id: 'shopwave/api#470',
      number: 470,
      title: 'Add rate limiting middleware to public endpoints',
      author: mgarcia,
      repo: apiRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-06-27T12:00:00.000Z',
      updatedAt: '2026-07-01T10:30:00.000Z',
      headRef: 'feature/rate-limit-middleware',
      baseRef: 'main',
      webUrl: prWebUrl(apiRepo, 470),
      headSha: 'c470f003c470f003c470f003c470f003c470f003',
      commentCount: 0,
      reviewDecision: 'approved',
      ciStatus: 'success',
      additions: 58,
      deletions: 3,
      changedFiles: 2,
      bodyMarkdown:
        '## Qué hace\n\nAgrega un middleware de rate limiting (token bucket, 60 req/min por IP) a los endpoints públicos.\n\nUsa Redis para el contador compartido entre instancias.',
      labels: [{ name: 'security', color: 'ef4444' }],
      reviewers: [reviewer(dkumar, 'approved')],
      commits: 4,
    },
    files: [
      {
        path: 'src/middleware/rate-limit.ts',
        status: 'added',
        additions: 46,
        deletions: 0,
        isBinary: false,
        patch:
          "@@ -0,0 +1,46 @@\n+import { RequestHandler } from 'express'\n+import { redis } from '../lib/redis'\n+\n+export function rateLimit(limitPerMinute = 60): RequestHandler {\n+  return async (req, res, next) => {\n+    const key = 'ratelimit:' + req.ip\n+    const count = await redis.incr(key)\n+    if (count === 1) await redis.expire(key, 60)\n+    if (count > limitPerMinute) {\n+      res.status(429).json({ error: 'rate_limited' })\n+      return\n+    }\n+    next()\n+  }\n+}",
      },
      {
        path: 'src/app.ts',
        status: 'modified',
        additions: 12,
        deletions: 3,
        isBinary: false,
        patch:
          "@@ -5,9 +5,18 @@ import express from 'express'\n import { registerCartRoutes } from './routes/carts'\n+import { rateLimit } from './middleware/rate-limit'\n \n const app = express()\n+app.use(rateLimit())\n registerCartRoutes(app)",
      },
    ],
    // Written on earlier commits: one whose lines moved since, one on a file a later push removed.
    threads: [
      {
        id: 'thread-470-1',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        isOutdated: true,
        path: 'src/middleware/rate-limit.ts',
        line: 8,
        side: 'RIGHT',
        origin: { commit: PUSH_470_THIRD, line: 8 },
        comments: [
          {
            id: 'c-470-1',
            author: dkumar,
            bodyMarkdown:
              'This resets the window on every request, so a steady client is never let through again.',
            createdAt: '2026-06-29T15:20:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-470-2',
        status: 'resolved',
        isResolved: true,
        isLineThread: true,
        isOutdated: true,
        path: 'src/lib/token-bucket.ts',
        line: 9,
        lineEnd: 10,
        side: 'RIGHT',
        origin: { commit: PUSH_470_FIRST, line: 9, lineEnd: 10 },
        comments: [
          {
            id: 'c-470-2',
            author: dkumar,
            bodyMarkdown: 'Why a hand-rolled bucket? Redis INCR + EXPIRE does this for us.',
            createdAt: '2026-06-28T10:00:00.000Z',
            isMinimized: false,
          },
          {
            id: 'c-470-3',
            author: mgarcia,
            bodyMarkdown: 'Agreed, it was a first try. Removed in a later push.',
            createdAt: '2026-06-28T11:30:00.000Z',
            isMinimized: false,
          },
        ],
      },
      // Its first read at the commit fails (`failFirstCommitRead`): the excerpt's Retry.
      {
        id: 'thread-470-3',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        isOutdated: true,
        path: 'src/app.ts',
        line: 6,
        side: 'RIGHT',
        origin: { commit: PUSH_470_THIRD, line: 6 },
        comments: [
          {
            id: 'c-470-4',
            author: dkumar,
            bodyMarkdown: 'Should the limiter run before or after auth?',
            createdAt: '2026-06-29T15:40:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
    commitFiles: {
      [PUSH_470_FIRST]: { 'src/lib/token-bucket.ts': TOKEN_BUCKET_FIRST },
      [PUSH_470_THIRD]: { 'src/middleware/rate-limit.ts': RATE_LIMIT_THIRD, 'src/app.ts': APP_470 },
    },
    headFiles: { 'src/middleware/rate-limit.ts': RATE_LIMIT_HEAD, 'src/app.ts': APP_470 },
    failFirstCommitRead: ['src/app.ts'],
  },
  {
    detail: {
      id: 'shopwave/web#201',
      number: 201,
      title: 'Refactor checkout state machine to use a reducer',
      author: lchen,
      repo: webRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-06-28T09:15:00.000Z',
      updatedAt: '2026-07-03T18:22:00.000Z',
      headRef: 'refactor/checkout-reducer',
      baseRef: 'main',
      webUrl: prWebUrl(webRepo, 201),
      headSha: 'd201f004d201f004d201f004d201f004d201f004',
      commentCount: 1,
      reviewDecision: 'approved',
      ciStatus: 'success',
      additions: 243,
      deletions: 273,
      changedFiles: 5,
      bodyMarkdown:
        '## Qué hace\n\nReemplaza la máquina de estados ad-hoc de checkout por un reducer puro + `useReducer`. Sin cambios de comportamiento visible, solo refactor interno para poder testear las transiciones sin montar la UI. También se renombra `checkout-types.ts` a `checkout-state.ts` y se convierte `CheckoutValidator` (clase con estado mutable) en funciones puras de validación.',
      labels: [{ name: 'refactor', color: '64748b' }],
      reviewers: [reviewer(sfontaine, 'approved'), reviewer(mgarcia)],
      commits: 6,
    },
    files: [
      {
        path: 'src/features/checkout/checkout-machine.ts',
        status: 'removed',
        additions: 0,
        deletions: 132,
        isBinary: false,
        patch:
          "@@ -1,132 +0,0 @@\n-export class CheckoutMachine {\n-  private state: CheckoutState = 'cart'\n-\n-  transition(event: CheckoutEvent): void {\n-    // ... lógica imperativa de transición de 130 líneas\n-  }\n-}",
      },
      {
        path: 'src/features/checkout/checkout-reducer.ts',
        status: 'added',
        additions: 118,
        deletions: 0,
        isBinary: false,
        patch:
          "@@ -0,0 +1,118 @@\n+export type CheckoutState = 'cart' | 'shipping' | 'payment' | 'confirmation'\n+\n+export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {\n+  switch (state) {\n+    case 'cart':\n+      return event.type === 'CONTINUE' ? 'shipping' : state\n+    case 'shipping':\n+      return event.type === 'CONTINUE' ? 'payment' : 'cart'\n+    default:\n+      return state\n+  }\n+}",
      },
      {
        path: 'src/features/checkout/CheckoutPage.tsx',
        status: 'modified',
        additions: 92,
        deletions: 113,
        isBinary: false,
        patch:
          "@@ -1,15 +1,14 @@\n-import { CheckoutMachine } from './checkout-machine'\n+import { checkoutReducer } from './checkout-reducer'\n+import { useReducer } from 'react'\n \n export function CheckoutPage(): JSX.Element {\n-  const machine = useMemo(() => new CheckoutMachine(), [])\n+  const [state, dispatch] = useReducer(checkoutReducer, 'cart')\n   ...\n }",
      },
      {
        path: 'src/features/checkout/checkout-validation.ts',
        status: 'modified',
        additions: 33,
        deletions: 28,
        isBinary: false,
        patch:
          "@@ -1,13 +1,12 @@\n import { Cart } from '../../models/cart'\n import { ShippingAddress } from '../../models/address'\n \n-export class CheckoutValidator {\n-  private errors: string[] = []\n-\n-  validateCart(cart: Cart): boolean {\n-    this.errors = []\n-    if (cart.items.length === 0) this.errors.push('cart_empty')\n-    if (cart.total <= 0) this.errors.push('invalid_total')\n-    return this.errors.length === 0\n-  }\n+export type ValidationResult = { valid: boolean; errors: string[] }\n+\n+export function validateCart(cart: Cart): ValidationResult {\n+  const errors: string[] = []\n+  if (cart.items.length === 0) errors.push('cart_empty')\n+  if (cart.total <= 0) errors.push('invalid_total')\n+  return { valid: errors.length === 0, errors }\n+}\n \n@@ -14,8 +13,8 @@\n-  validateShipping(address: ShippingAddress): boolean {\n-    this.errors = []\n-    if (!address.line1) this.errors.push('missing_line1')\n-    if (!address.postalCode) this.errors.push('missing_postal_code')\n-    if (!address.country) this.errors.push('missing_country')\n-    return this.errors.length === 0\n-  }\n-\n+export function validateShipping(address: ShippingAddress): ValidationResult {\n+  const errors: string[] = []\n+  if (!address.line1) errors.push('missing_line1')\n+  if (!address.postalCode) errors.push('missing_postal_code')\n+  if (!address.country) errors.push('missing_country')\n+  return { valid: errors.length === 0, errors }\n+}\n+\n@@ -22,11 +21,17 @@\n-  validatePayment(method: string): boolean {\n-    this.errors = []\n-    const allowed = ['card', 'paypal', 'wallet']\n-    if (!allowed.includes(method)) this.errors.push('unsupported_payment_method')\n-    return this.errors.length === 0\n-  }\n-\n-  getErrors(): string[] {\n-    return this.errors\n-  }\n-}\n+const ALLOWED_PAYMENT_METHODS = ['card', 'paypal', 'wallet', 'bank_transfer']\n+\n+export function validatePayment(method: string): ValidationResult {\n+  const errors: string[] = []\n+  if (!ALLOWED_PAYMENT_METHODS.includes(method)) errors.push('unsupported_payment_method')\n+  return { valid: errors.length === 0, errors }\n+}\n+\n+export function validateCheckout(\n+  cart: Cart,\n+  address: ShippingAddress,\n+  paymentMethod: string,\n+): ValidationResult {\n+  const results = [validateCart(cart), validateShipping(address), validatePayment(paymentMethod)]\n+  const errors = results.flatMap((r) => r.errors)\n+  return { valid: errors.length === 0, errors }\n+}",
      },
      {
        path: 'src/features/checkout/checkout-state.ts',
        previousPath: 'src/features/checkout/checkout-types.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        isBinary: false,
      },
    ],
    threads: [
      {
        id: 'thread-201-1',
        status: 'resolved',
        isResolved: true,
        isLineThread: false,
        comments: [
          {
            id: 'c-201-1',
            author: sfontaine,
            bodyMarkdown: 'Mucho más legible que la máquina de estados anterior. Aprobado.',
            createdAt: '2026-07-03T18:00:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-201-2',
        status: 'resolved',
        isResolved: true,
        isLineThread: true,
        path: 'src/features/checkout/checkout-machine.ts',
        line: 2,
        side: 'LEFT',
        comments: [
          {
            id: 'c-201-2',
            author: sfontaine,
            bodyMarkdown:
              'Buena limpieza, esta clase mezclaba estado mutable con la lógica de transición y era imposible testear sin montar la UI.',
            createdAt: '2026-06-29T10:00:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-201-3',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        path: 'src/features/checkout/checkout-reducer.ts',
        line: 7,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-201-3',
            author: sfontaine,
            bodyMarkdown:
              'Falta el caso `shipping -> payment` cuando el evento es distinto de CONTINUE, ¿vuelve a cart o se queda en shipping? Y el caso payment -> confirmation no está.',
            createdAt: '2026-06-29T11:15:00.000Z',
            isMinimized: false,
          },
        ],
      },
      {
        id: 'thread-201-4',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        path: 'src/features/checkout/CheckoutPage.tsx',
        line: 5,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-201-4',
            author: lchen,
            bodyMarkdown:
              '`dispatch` se pasa por prop a los hijos por ahora; si crece lo movemos a un context dedicado.',
            createdAt: '2026-06-29T12:00:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
  },
  {
    detail: {
      id: 'shopwave/web#198',
      number: 198,
      title: 'Redesign product card UI with new price badge',
      author: sfontaine,
      repo: webRepo,
      state: 'open',
      isDraft: true,
      createdAt: '2026-07-04T11:00:00.000Z',
      updatedAt: '2026-07-04T17:10:00.000Z',
      headRef: 'ui/product-card-redesign',
      baseRef: 'main',
      webUrl: prWebUrl(webRepo, 198),
      headSha: 'e198f005e198f005e198f005e198f005e198f005',
      commentCount: 0,
      reviewDecision: null,
      ciStatus: 'pending',
      additions: 88,
      deletions: 20,
      changedFiles: 3,
      bodyMarkdown:
        '## Qué hace (WIP)\n\nBorrador del rediseño de la tarjeta de producto: nuevo `PriceBadge` para precios con descuento. Falta:\n\n- [ ] Estados de hover/focus\n- [ ] Modo compacto para grillas de 4 columnas\n\nAún no listo para review.',
      labels: [{ name: 'ui', color: 'ec4899' }],
      reviewers: [],
      commits: 2,
    },
    files: [
      {
        path: 'src/components/ProductCard.tsx',
        status: 'modified',
        additions: 30,
        deletions: 18,
        isBinary: false,
        patch:
          '@@ -8,10 +8,14 @@ export function ProductCard({ product }: Props): JSX.Element {\n   return (\n     <article className={styles.card}>\n-      <span className={styles.price}>${product.price}</span>\n+      <PriceBadge price={product.price} discountPrice={product.discountPrice} />\n     </article>\n   )\n }',
      },
      {
        path: 'src/components/PriceBadge.tsx',
        status: 'added',
        additions: 42,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,42 @@\n+interface Props {\n+  price: number\n+  discountPrice?: number\n+}\n+\n+export function PriceBadge({ price, discountPrice }: Props): JSX.Element {\n+  if (!discountPrice) return <span>${price}</span>\n+  return (\n+    <span>\n+      <s>${price}</s> ${discountPrice}\n+    </span>\n+  )\n+}',
      },
      {
        path: 'src/components/ProductCard.module.css',
        status: 'modified',
        additions: 16,
        deletions: 2,
        isBinary: false,
        patch:
          '@@ -12,4 +12,18 @@\n .price {\n-  color: #111;\n+  color: var(--text-muted);\n }\n+\n+.priceBadge {\n+  display: flex;\n+  gap: 0.25rem;\n+}',
      },
    ],
    threads: [],
  },
  {
    detail: {
      id: 'shopwave/web#190',
      number: 190,
      title: 'Add dark mode toggle to account settings',
      author: sfontaine,
      repo: webRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-06-25T15:30:00.000Z',
      updatedAt: '2026-06-29T09:00:00.000Z',
      headRef: 'feature/dark-mode-toggle',
      baseRef: 'main',
      webUrl: prWebUrl(webRepo, 190),
      headSha: 'f190f006f190f006f190f006f190f006f190f006',
      commentCount: 0,
      reviewDecision: 'review_required',
      ciStatus: 'success',
      additions: 64,
      deletions: 5,
      changedFiles: 2,
      bodyMarkdown:
        '## Qué hace\n\nAgrega un toggle de modo oscuro en Ajustes de cuenta. Persiste la preferencia en `localStorage` y respeta `prefers-color-scheme` por defecto.',
      labels: [{ name: 'ui', color: 'ec4899' }],
      reviewers: [reviewer(lchen, 'none', true)],
      commits: 3,
    },
    files: [
      {
        path: 'src/features/account/SettingsPage.tsx',
        status: 'modified',
        additions: 20,
        deletions: 4,
        isBinary: false,
        patch:
          '@@ -30,6 +30,10 @@ export function SettingsPage(): JSX.Element {\n+      <ThemeToggle />',
      },
      {
        path: 'src/hooks/useTheme.ts',
        status: 'added',
        additions: 44,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,44 @@\n+export function useTheme(): [Theme, (t: Theme) => void] {\n+  // lee/escribe localStorage + prefers-color-scheme\n+}',
      },
    ],
    threads: [],
  },
  {
    detail: {
      id: 'shopwave/checkout-service#77',
      number: 77,
      title: 'Fix race condition in payment webhook handler',
      author: jrivas,
      repo: checkoutRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-07-01T20:10:00.000Z',
      updatedAt: '2026-07-04T19:05:00.000Z',
      headRef: 'fix/webhook-race-condition',
      baseRef: 'main',
      webUrl: prWebUrl(checkoutRepo, 77),
      headSha: 'a077f007a077f007a077f007a077f007a077f007',
      commentCount: 1,
      reviewDecision: 'changes_requested',
      ciStatus: 'failure',
      additions: 47,
      deletions: 12,
      changedFiles: 2,
      bodyMarkdown:
        '## Qué hace\n\nDos webhooks de pago casi simultáneos podían marcar la misma orden como pagada dos veces, disparando doble notificación al cliente. Se agrega un lock optimista por `orderId`.\n\n## CI\n\nEl job de integración falla intermitentemente; investigando si es el fix o un flake del entorno de test.',
      labels: [
        { name: 'bug', color: 'ef4444' },
        { name: 'payments', color: '14b8a6' },
      ],
      reviewers: [reviewer(mgarcia, 'changes_requested')],
      commits: 4,
    },
    files: [
      {
        path: 'src/webhooks/payment-webhook-handler.ts',
        status: 'modified',
        additions: 35,
        deletions: 10,
        isBinary: false,
        patch:
          "@@ -14,12 +14,25 @@ export async function handlePaymentWebhook(event: PaymentEvent): Promise<void> {\n-  const order = await OrderRepository.findById(event.orderId)\n-  if (order.status === 'paid') return\n-  await OrderRepository.markPaid(order.id)\n+  const lock = await acquireOrderLock(event.orderId)\n+  try {\n+    const order = await OrderRepository.findById(event.orderId)\n+    if (order.status === 'paid') return\n+    await OrderRepository.markPaid(order.id)\n+  } finally {\n+    await lock.release()\n+  }",
      },
      {
        path: 'src/webhooks/payment-webhook-handler.test.ts',
        status: 'modified',
        additions: 12,
        deletions: 2,
        isBinary: false,
        patch:
          "@@ -40,4 +40,14 @@ describe('handlePaymentWebhook', () => {\n+  it('ignores duplicate webhooks fired concurrently', async () => {\n+    await Promise.all([handlePaymentWebhook(event), handlePaymentWebhook(event)])\n+    expect(OrderRepository.markPaid).toHaveBeenCalledTimes(1)\n+  })",
      },
    ],
    threads: [
      {
        id: 'thread-77-1',
        status: 'active',
        isResolved: false,
        isLineThread: true,
        path: 'src/webhooks/payment-webhook-handler.ts',
        line: 22,
        side: 'RIGHT',
        comments: [
          {
            id: 'c-77-1',
            author: mgarcia,
            bodyMarkdown:
              '¿El lock es por proceso o distribuido? Con 3 instancias corriendo esto no alcanza si es en memoria.',
            createdAt: '2026-07-04T18:50:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
  },
  {
    detail: {
      id: 'shopwave/checkout-service#74',
      number: 74,
      title: 'Add idempotency key support to /charge endpoint',
      author: mgarcia,
      repo: checkoutRepo,
      state: 'open',
      isDraft: false,
      createdAt: '2026-06-26T13:40:00.000Z',
      updatedAt: '2026-06-30T08:20:00.000Z',
      headRef: 'feature/idempotency-key',
      baseRef: 'main',
      webUrl: prWebUrl(checkoutRepo, 74),
      headSha: 'b074f008b074f008b074f008b074f008b074f008',
      commentCount: 0,
      reviewDecision: null,
      ciStatus: 'success',
      additions: 102,
      deletions: 8,
      changedFiles: 2,
      bodyMarkdown:
        '## Qué hace\n\n`POST /charge` ahora acepta un header `Idempotency-Key`. Reintentos con la misma clave devuelven la respuesta original en vez de cobrar dos veces.\n\n## Cómo probar\n\n```\ncurl -X POST localhost:4000/charge -H "Idempotency-Key: abc123" -d \'{"amount":1999}\'\n```',
      labels: [{ name: 'endpoint', color: '14b8a6' }],
      reviewers: [reviewer(jrivas), reviewer(dkumar)],
      commits: 5,
    },
    files: [
      {
        path: 'src/routes/charge.ts',
        status: 'modified',
        additions: 28,
        deletions: 8,
        isBinary: false,
        patch:
          "@@ -8,10 +8,20 @@ export async function chargeHandler(req: Request, res: Response): Promise<void> {\n+  const key = req.header('Idempotency-Key')\n+  if (key) {\n+    const cached = await IdempotencyStore.get(key)\n+    if (cached) {\n+      res.status(cached.status).json(cached.body)\n+      return\n+    }\n+  }",
      },
      {
        path: 'src/services/idempotency-store.ts',
        status: 'added',
        additions: 74,
        deletions: 0,
        isBinary: false,
        patch:
          "@@ -0,0 +1,74 @@\n+export const IdempotencyStore = {\n+  async get(key: string): Promise<CachedResponse | null> {\n+    return redis.get('idem:' + key).then((v) => (v ? JSON.parse(v) : null))\n+  },\n+  async set(key: string, response: CachedResponse): Promise<void> {\n+    await redis.set('idem:' + key, JSON.stringify(response), 'EX', 86400)\n+  },\n+}",
      },
    ],
    threads: [],
  },
  // Los siguientes 3 PRs (T51, F10) existen para poder ejercitar el filtro
  // de estado (`PrStateFilter`) en el mock: 1 `closed` (rechazado, no
  // mergeado) y 2 `merged`. Mismo estilo/universo shopwave que los de arriba.
  {
    detail: {
      id: 'shopwave/api#455',
      number: 455,
      title: 'Add experimental GraphQL gateway proxy',
      author: lchen,
      repo: apiRepo,
      state: 'closed',
      isDraft: false,
      createdAt: '2026-06-10T10:00:00.000Z',
      updatedAt: '2026-06-18T16:40:00.000Z',
      headRef: 'experiment/graphql-gateway',
      baseRef: 'main',
      webUrl: prWebUrl(apiRepo, 455),
      headSha: 'c455f009c455f009c455f009c455f009c455f009',
      commentCount: 1,
      reviewDecision: 'changes_requested',
      ciStatus: 'failure',
      additions: 38,
      deletions: 2,
      changedFiles: 1,
      bodyMarkdown:
        '## Qué hace\n\nSpike de un gateway GraphQL delante de los endpoints REST existentes. Se cierra sin mergear: el equipo decidió posponerlo hasta evaluar Federation vs. un schema monolítico.',
      labels: [{ name: 'declined', color: '6b7280' }],
      reviewers: [reviewer(mgarcia, 'changes_requested')],
      commits: 2,
    },
    files: [
      {
        path: 'src/gateway/graphql-proxy.ts',
        status: 'added',
        additions: 38,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,38 @@\n+export function createGraphqlProxy(): GraphqlProxy {\n+  // spike: reenvía queries a los endpoints REST existentes\n+}',
      },
    ],
    threads: [
      {
        id: 'thread-455-1',
        status: 'active',
        isResolved: false,
        isLineThread: false,
        comments: [
          {
            id: 'c-455-1',
            author: mgarcia,
            bodyMarkdown:
              'Mejor lo cerramos por ahora y retomamos cuando decidamos si vamos con Federation.',
            createdAt: '2026-06-18T16:35:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
  },
  {
    detail: {
      id: 'shopwave/web#185',
      number: 185,
      title: 'Add pagination to order history table',
      author: sfontaine,
      repo: webRepo,
      state: 'merged',
      isDraft: false,
      createdAt: '2026-06-20T09:00:00.000Z',
      updatedAt: '2026-06-24T14:10:00.000Z',
      headRef: 'feature/order-history-pagination',
      baseRef: 'main',
      webUrl: prWebUrl(webRepo, 185),
      headSha: 'd185f010d185f010d185f010d185f010d185f010',
      commentCount: 0,
      reviewDecision: 'approved',
      ciStatus: 'success',
      additions: 52,
      deletions: 9,
      changedFiles: 2,
      bodyMarkdown:
        '## Qué hace\n\nPagina la tabla de historial de pedidos en Ajustes de cuenta (20 por página) en vez de traer todo el historial de una vez.',
      labels: [{ name: 'ui', color: 'ec4899' }],
      reviewers: [reviewer(lchen, 'approved')],
      commits: 2,
    },
    files: [
      {
        path: 'src/features/account/OrderHistoryTable.tsx',
        status: 'modified',
        additions: 30,
        deletions: 9,
        isBinary: false,
        patch:
          '@@ -12,10 +12,20 @@ export function OrderHistoryTable(): JSX.Element {\n+  const { page, setPage } = usePagination(20)',
      },
      {
        path: 'src/hooks/usePagination.ts',
        status: 'added',
        additions: 22,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,22 @@\n+export function usePagination(pageSize: number) {\n+  // maneja page/pageSize y expone slice() sobre el array de items\n+}',
      },
    ],
    threads: [],
  },
  {
    detail: {
      id: 'shopwave/checkout-service#68',
      number: 68,
      title: 'Add multi-currency support to payment totals',
      author: dkumar,
      repo: checkoutRepo,
      state: 'merged',
      isDraft: false,
      createdAt: '2026-06-15T11:20:00.000Z',
      updatedAt: '2026-06-22T17:05:00.000Z',
      headRef: 'feature/multi-currency-totals',
      baseRef: 'main',
      webUrl: prWebUrl(checkoutRepo, 68),
      headSha: 'e068f011e068f011e068f011e068f011e068f011',
      commentCount: 1,
      reviewDecision: 'approved',
      ciStatus: 'success',
      additions: 61,
      deletions: 6,
      changedFiles: 2,
      bodyMarkdown:
        '## Qué hace\n\nLos totales de pago ahora se calculan y muestran en la moneda del cliente (antes siempre USD), usando la tasa de cambio vigente al momento del charge.',
      labels: [{ name: 'payments', color: '14b8a6' }],
      reviewers: [reviewer(jrivas, 'approved'), reviewer(mgarcia)],
      commits: 3,
    },
    files: [
      {
        path: 'src/services/currency-service.ts',
        status: 'added',
        additions: 41,
        deletions: 0,
        isBinary: false,
        patch:
          '@@ -0,0 +1,41 @@\n+export const CurrencyService = {\n+  async convert(amount: number, from: string, to: string): Promise<number> {\n+    const rate = await getExchangeRate(from, to)\n+    return Math.round(amount * rate)\n+  },\n+}',
      },
      {
        path: 'src/routes/charge.ts',
        status: 'modified',
        additions: 20,
        deletions: 6,
        isBinary: false,
        patch:
          "@@ -22,10 +22,24 @@ export async function chargeHandler(req: Request, res: Response): Promise<void> {\n+  const total = await CurrencyService.convert(req.body.amount, 'USD', req.body.currency)",
      },
    ],
    threads: [
      {
        id: 'thread-68-1',
        status: 'resolved',
        isResolved: true,
        isLineThread: false,
        comments: [
          {
            id: 'c-68-1',
            author: jrivas,
            bodyMarkdown: 'Probado con EUR y MXN, los totales redondean bien. Apruebo.',
            createdAt: '2026-06-22T16:55:00.000Z',
            isMinimized: false,
          },
        ],
      },
    ],
  },
]
