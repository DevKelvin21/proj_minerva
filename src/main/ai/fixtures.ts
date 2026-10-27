/**
 * English fixtures (the Spanish copy is `./fixtures.es.ts`; `mock-service.ts`
 * picks by analysis language).
 *
 * Fixtures de `DidacticAnalysis` para el universo mock "shopwave" (mismos PRs
 * que `src/main/scm/github/fixtures.ts`). Cuatro PRs tienen contenido enriquecido
 * (secciones `endpoint`/`schema`/`architecture`/`cloud` con diagramas
 * Mermaid, esta última solo en `shopwave/checkout-service#77`, T76); el
 * resto recibe un resumen genérico armado a partir de su `PullRequestDetail`.
 *
 * IMPORTANTE (gotcha de build, ver `.agents/TASKS.md`): el contenido largo de
 * estos fixtures usa comillas normales (simples/dobles) con `\n` y
 * concatenación, NUNCA template literals con backtick como delimitador de
 * string — evita relanzar el bug de `vite:esm-shim` encontrado en T4. Los
 * caracteres backtick sueltos dentro de un string con comillas normales (para
 * `código inline` en Markdown) sí son seguros, como ya se usa en
 * `github/fixtures.ts`.
 */
import { prKey } from '../../shared/scm'
import { githubRepo } from '../../shared/scm-guards'
import type { DidacticSection, LineQuestion, PullRequestDetail } from '../../shared/types'

/** Mock answer to a reviewer's question about some lines (`ai:askAboutLines`). */
export function lineAnswerSection(question: LineQuestion): DidacticSection {
  const where =
    question.startLine === question.endLine
      ? question.path + ':' + question.startLine
      : question.path + ':' + question.startLine + '-' + question.endLine
  return {
    kind: 'summary',
    markdown:
      'Mock answer for `' +
      where +
      '`: these lines are part of the change this PR makes. With a real AI provider, the ' +
      'agent reads the file at the PR commit before answering your question.\n\n' +
      'Next step: compare them with the code that calls them, then decide whether they need a ' +
      'comment.',
  }
}

/** Resumen genérico para PRs sin sección enriquecida en esta demo mock. */
export function genericSummarySection(detail: PullRequestDetail): DidacticSection {
  const labels =
    detail.labels.length > 0 ? detail.labels.map((l) => l.name).join(', ') : 'no labels'

  return {
    kind: 'summary',
    markdown:
      '## Summary\n\n**' +
      detail.title +
      '** (' +
      detail.repo.fullName +
      '#' +
      detail.number +
      ')\n\n' +
      'Changes ' +
      (detail.changedFiles ?? '?') +
      ' file(s): +' +
      (detail.additions ?? '?') +
      ' / -' +
      (detail.deletions ?? '?') +
      '. Labels: ' +
      labels +
      '.\n\n' +
      'This PR did not trigger any enriched section (architecture, endpoint or schema) in this ' +
      'demo with mock data: in the real pipeline, the AI classifier decides automatically which ' +
      'sections to generate from the diff (see `.claude/skills/` and `src/main/ai/prompts/README.md`).',
  }
}

const pr482Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## What changes\n\n' +
      'This PR adds the `POST /api/v1/carts/:id/apply-coupon` endpoint: it validates a coupon code ' +
      'and, if it is valid, recalculates the total of the active cart.\n\n' +
      '**Why it matters:** it is the first point where a customer can change the cart total with ' +
      'an external code. A bug here can turn into unbounded discounts (lost revenue) or legitimate ' +
      'coupons being rejected (bad experience).\n\n' +
      '**What to review:**\n' +
      '- The discount clamp: the comment thread points out that an uncapped `coupon.discountRate` ' +
      'could reach 100%; confirm the fix (clamp to 0.9) is in this diff.\n' +
      '- The "coupon already applied" case (409) still has no test, according to the last review comment.\n' +
      '- That all the validation lives in `CouponService` and is not duplicated in the route handler.',
  },
  {
    kind: 'walkthrough',
    markdown:
      'Read the new service first (it owns the business rules), then the route that exposes it, then the test that pins the expired-coupon case.',
    cohorts: [
      {
        title: 'Apply-coupon endpoint',
        layers: [
          {
            title: 'Coupon validation service',
            markdown:
              '`CouponService.apply` is the core of the PR: it looks the coupon up, rejects expired or already-applied ones with a `reason`, and recalculates the total with `discountRate`. Everything else in the PR just wires this function.',
            files: [{ path: 'src/services/coupon-service.ts', ranges: [{ start: 3, end: 7 }, { start: 9, end: 21 }] }],
          },
          {
            title: 'Route wiring and HTTP mapping',
            markdown:
              '`registerCartRoutes` gains `POST /carts/:id/apply-coupon`; the handler loads the cart, delegates to the service and maps `result.ok` to 200 or 409. Note there is no input validation on `req.body.code` yet.',
            files: [{ path: 'src/routes/carts.ts', ranges: [{ start: 13, end: 13 }, { start: 20, end: 27 }] }],
            mermaid:
              'sequenceDiagram\n' +
              '  participant C as Client\n' +
              '  participant R as carts router\n' +
              '  participant S as CouponService\n' +
              '  C->>R: POST /carts/:id/apply-coupon\n' +
              '  R->>S: apply(cart, code)\n' +
              '  S-->>R: { ok, total, reason? }\n' +
              '  R-->>C: 200 or 409\n',
          },
          {
            title: 'Unit test for the expired case',
            markdown:
              'One Vitest case covers the expired coupon. The `already_applied` branch and the happy path are not tested yet: worth asking for before merging.',
            files: [{ path: 'src/services/coupon-service.test.ts', ranges: [{ start: 4, end: 9 }] }],
          },
        ],
      },
    ],
  },
  {
    kind: 'setup',
    markdown:
      '## How to try this PR\n\n' +
      'The diff of this PR shows no `Dockerfile` or `docker-compose.yml` among the touched files, ' +
      'so there is no direct evidence of a Docker flow for this demo — if `shopwave/api` has one ' +
      'to start the database, it does not appear in these files.\n\n' +
      '**Locally:** the touched file uses `express` (`import { Router } from \'express\'`), so ' +
      'it is the repo\'s usual Node.js/Express API:\n\n' +
      '1. `npm install`\n' +
      '2. `npm run dev` (or `npm start`, depending on the repo\'s `package.json`)\n\n' +
      '**Environment variables needed to run the API:** `DATABASE_URL` (Postgres connection, ' +
      'used by `CartService`/`OrderRepository`) and `PORT` (HTTP port).\n\n' +
      '**NEW environment variables in this PR:** yes — `CouponService` introduces a configurable ' +
      'cap for the maximum discount (see "What to review" above, the clamp to 0.9):\n\n' +
      '| Variable | Purpose | Example value |\n' +
      '|---|---|---|\n' +
      '| `COUPON_MAX_DISCOUNT_RATE` | Upper bound of the `discountRate` that `CouponService.apply` ' +
      'accepts from a coupon (prevents unbounded discounts) | `0.9` |',
    snippets: [
      {
        label: 'local-start',
        language: 'bash',
        code: 'npm install\nnpm run dev',
      },
      {
        label: 'env',
        language: 'env',
        code: 'DATABASE_URL=postgres://localhost:5432/shopwave\nPORT=3000\nCOUPON_MAX_DISCOUNT_RATE=0.9',
      },
    ],
  },
  {
    kind: 'endpoint',
    markdown:
      '### `POST /api/v1/carts/:id/apply-coupon`\n\n' +
      '| | |\n' +
      '|---|---|\n' +
      '| **Path param** | `id` — id of the active cart |\n' +
      '| **Body** | `{ "code": string }` |\n' +
      '| **200 OK** | `{ "ok": true, "total": number }` — coupon applied, total recalculated |\n' +
      '| **409 Conflict** | `{ "ok": false, "reason": "already_applied" }` — the cart already had a coupon |\n' +
      '| **200 with `ok:false`** | `{ "ok": false, "reason": "expired_or_missing" }` — invalid or expired code |\n\n' +
      'The handler delegates all the logic to `CouponService.apply(cart, code)` (new service, see ' +
      'the architecture diagram below).',
    snippets: [
      {
        label: 'curl',
        language: 'curl',
        code:
          'curl -X POST http://localhost:3000/api/v1/carts/123/apply-coupon \\\n' +
          '  -H "Content-Type: application/json" \\\n' +
          '  -d \'{"code":"WELCOME10"}\'',
      },
      {
        label: 'apply-coupon.http',
        language: 'http',
        code:
          'POST http://localhost:3000/api/v1/carts/123/apply-coupon\n' +
          'Content-Type: application/json\n\n' +
          '{\n' +
          '  "code": "WELCOME10"\n' +
          '}',
      },
    ],
  },
  {
    kind: 'architecture',
    markdown:
      '`CouponService` is a new service, independent from `CartService`: the ' +
      '`POST /carts/:id/apply-coupon` route calls it to keep coupon validation out of the HTTP ' +
      'handler.',
    mermaid:
      'C4Container\n' +
      // Sin '#' en el título: el lexer C4 de mermaid (11.16) lanza "Lexical
      // error" con '#' dentro del DSL (descubierto en T16; misma regla en el
      // prompt real y en la skill mermaid-c4-diagram).
      '  title Architectural impact of PR 482 (apply-coupon)\n' +
      '  Person(customer, "Customer", "Shops on Shopwave")\n' +
      '  System_Boundary(shopwave, "Shopwave") {\n' +
      '    Container(api, "API", "Node.js / Express", "Exposes REST to customers")\n' +
      '    Container(couponService, "CouponService (NEW)", "TypeScript", "Validates and applies coupons to a cart")\n' +
      '    ContainerDb(db, "Database", "PostgreSQL", "Carts, coupons, orders")\n' +
      '  }\n' +
      '  Rel(customer, api, "POST /carts/:id/apply-coupon")\n' +
      // Etiquetas de Rel ≤4 palabras (misma regla que el prompt real, T16):
      // las largas se enciman con las cajas vecinas en el layout C4.
      '  Rel(api, couponService, "delegates validation")\n' +
      '  Rel(couponService, db, "reads and writes")\n',
  },
]

const pr479Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## What changes\n\n' +
      'Introduces the `refunds` table (additive migration) to support partial refunds per order ' +
      'line, together with the `Refund` model and a computed `refundedAmount` field on `Order`.\n\n' +
      '**Why it matters:** it is a schema change in production. Although the migration does not ' +
      'touch existing data, it defines a new relation (`Order` 1—N `Refund`) that other services ' +
      'will start depending on.\n\n' +
      '**What to review:**\n' +
      '- The `CHECK (amount_cents > 0)` does not prevent refunding more than the order line is ' +
      'worth (see @mgarcia\'s comment); a cap against `order_lines.amount_cents` is missing.\n' +
      '- `refundedAmount` is recalculated in the application layer, not with a database trigger ' +
      '— confirm that every path that creates a `Refund` goes through that recalculation.',
  },
  {
    kind: 'walkthrough',
    markdown: '',
    cohorts: [
      {
        title: 'Refunds data model',
        layers: [
          {
            title: 'Migration: the refunds table',
            markdown:
              'Additive migration: `refunds` references `orders` and `order_lines`, with a positive-amount CHECK and an index by `order_id`. Nothing existing is altered, so it is safe to deploy before the feature flag.',
            files: [{ path: 'migrations/2026070401_create_refunds.sql', ranges: [{ start: 1, end: 10 }] }],
          },
          {
            title: 'Refund domain model',
            markdown:
              'The TypeScript mirror of the table. `amountCents` is an integer; check it stays below `Number.MAX_SAFE_INTEGER` in practice.',
            files: [{ path: 'src/models/refund.ts', ranges: [{ start: 1, end: 8 }] }],
          },
          {
            title: 'Order learns its refunded amount',
            markdown:
              '`Order.refundedAmount` is a denormalized field recalculated by the same service that creates a `Refund` (no DB trigger). Every path that creates a refund must go through that recalculation.',
            files: [{ path: 'src/models/order.ts', ranges: [{ start: 24, end: 25 }] }],
          },
        ],
      },
    ],
  },
  {
    kind: 'setup',
    markdown:
      '## How to try this PR\n\n' +
      'It is a migration (`migrations/2026070401_create_refunds.sql`) plus a new model; the diff ' +
      'shows no `Dockerfile` or `docker-compose.yml`, so there is no evidence of a Docker flow in ' +
      'this demo.\n\n' +
      '**Locally:** the same Node.js API of `shopwave/api`:\n\n' +
      '1. `npm install`\n' +
      '2. Run the new migration against the database (this diff does not show the exact command ' +
      'of the migration runner — look for the `migrate` script in `package.json`).\n' +
      '3. `npm run dev`\n\n' +
      '**Environment variables needed to run the API:** `DATABASE_URL` (Postgres, the same ' +
      'database the `refunds` migration runs against).\n\n' +
      '**NEW environment variables in this PR:** this PR adds or changes no environment variables ' +
      '— it is a pure schema migration, with no application code reading `process.env`.',
    snippets: [
      {
        label: 'local-start',
        language: 'bash',
        code: 'npm install\nnpm run dev',
      },
    ],
  },
  {
    kind: 'schema',
    markdown:
      '### Table `refunds`\n\n' +
      '| Field | Type | Notes |\n' +
      '|---|---|---|\n' +
      '| `id` | `uuid` | PK, `gen_random_uuid()` |\n' +
      '| `order_id` | `uuid` | FK -> `orders.id` |\n' +
      '| `order_line_id` | `uuid` | FK -> `order_lines.id` |\n' +
      '| `amount_cents` | `integer` | `CHECK (amount_cents > 0)`, no upper bound yet |\n' +
      '| `reason` | `text` | optional |\n' +
      '| `created_at` | `timestamptz` | default `now()` |\n\n' +
      'Index `idx_refunds_order_id` on `order_id` to list refunds per order.',
    mermaid:
      'erDiagram\n' +
      '    ORDER ||--o{ REFUND : has\n' +
      '    ORDER {\n' +
      '        string id PK\n' +
      '        string status\n' +
      '        int total\n' +
      '        int refundedAmount\n' +
      '    }\n' +
      '    REFUND {\n' +
      '        string id PK "NEW"\n' +
      '        string orderId FK "NEW"\n' +
      '        string orderLineId FK "NEW"\n' +
      '        int amountCents "NEW"\n' +
      '        string reason "NEW"\n' +
      '        string createdAt "NEW"\n' +
      '    }\n',
  },
]

const pr201Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## What changes\n\n' +
      'Replaces the imperative checkout state machine (`CheckoutMachine`, a class with mutable ' +
      'state) with a pure reducer (`checkoutReducer` + `useReducer`), and turns ' +
      '`CheckoutValidator` (a class) into pure validation functions. No behavior change visible ' +
      'to the user.\n\n' +
      '**Why it matters:** it is a large refactor (243 lines added, 273 removed) that touches the ' +
      'core purchase flow. The risk is not "what looks different" but "which transition stopped ' +
      'being covered" while migrating the logic.\n\n' +
      '**What to review:**\n' +
      '- The reducer does not explicitly cover `shipping -> payment` with events other than ' +
      '`CONTINUE`, nor the `payment -> confirmation` transition (see @sfontaine\'s comment).\n' +
      '- That `validateCheckout` combines the same cases that ' +
      '`CheckoutValidator.validateCart/validateShipping/validatePayment` used to cover separately.',
  },
  {
    kind: 'walkthrough',
    markdown:
      'Two independent threads of work: the state machine becomes a reducer, and the validator class becomes pure functions. Each can be reviewed on its own.',
    cohorts: [
      {
        title: 'State machine to reducer',
        layers: [
          {
            title: 'The pure checkout reducer',
            markdown:
              '`checkoutReducer` encodes the transitions as a `switch` on the current state. Compare it against the old class: the `payment -> confirmation` transition is missing from the diff.',
            files: [{ path: 'src/features/checkout/checkout-reducer.ts', ranges: [{ start: 1, end: 12 }] }],
            mermaid:
              'stateDiagram-v2\n' +
              '  [*] --> cart\n' +
              '  cart --> shipping: CONTINUE\n' +
              '  shipping --> payment: CONTINUE\n' +
              '  shipping --> cart: other event\n' +
              '  payment --> confirmation: missing in diff\n',
          },
          {
            title: 'CheckoutPage switches to useReducer',
            markdown:
              'The page replaces the memoized `CheckoutMachine` instance with `useReducer(checkoutReducer, \'cart\')`; `dispatch` is passed down by prop for now.',
            files: [{ path: 'src/features/checkout/CheckoutPage.tsx', ranges: [{ start: 1, end: 6 }] }],
          },
          {
            title: 'Old machine and types module',
            markdown:
              '`checkout-machine.ts` is deleted outright and `checkout-types.ts` is renamed to `checkout-state.ts` with no content change.',
            files: [
              { path: 'src/features/checkout/checkout-machine.ts', ranges: [{ start: 1, end: 7 }] },
              { path: 'src/features/checkout/checkout-state.ts', ranges: [] },
            ],
          },
        ],
      },
      {
        title: 'Validation as pure functions',
        layers: [
          {
            title: 'Validators return a result object',
            markdown:
              '`CheckoutValidator` (mutable `errors` state) becomes `validateCart` / `validateShipping` / `validatePayment` returning `{ valid, errors }`, plus a composed `validateCheckout`. Behaviour change hidden in the refactor: `bank_transfer` joins the allowed payment methods.',
            files: [
              {
                path: 'src/features/checkout/checkout-validation.ts',
                ranges: [{ start: 4, end: 12 }, { start: 13, end: 20 }, { start: 21, end: 37 }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: 'architecture',
    markdown:
      'The `CheckoutPage` component goes from orchestrating a class instance (`CheckoutMachine`) to ' +
      'dispatching events against a pure reducer. `checkout-validation.ts` no longer depends on ' +
      'mutable state (`this.errors`) and exposes independent functions per step.',
    mermaid:
      'C4Component\n' +
      '  title Checkout (web) - before and after the reducer refactor\n' +
      '  Container_Boundary(checkout, "Checkout module") {\n' +
      '    Component(page, "CheckoutPage", "React component", "Orchestrates the purchase flow")\n' +
      '    Component(machineOld, "CheckoutMachine (REMOVED)", "Class with mutable state", "Imperative transition logic, ~130 lines")\n' +
      '    Component(reducerNew, "checkoutReducer (NEW)", "Pure function", "Replaces CheckoutMachine")\n' +
      '    Component(validation, "checkout-validation", "Pure functions", "Before: CheckoutValidator class with mutable state")\n' +
      '  }\n' +
      '  Rel(page, machineOld, "used (before refactor)")\n' +
      '  Rel(page, reducerNew, "uses useReducer (after)")\n' +
      '  Rel(page, validation, "validates with validateCheckout")\n',
  },
]

const pr77Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## What changes\n\n' +
      'This PR adds an optimistic lock per `orderId` in `handlePaymentWebhook` so that two almost ' +
      'simultaneous payment webhooks do not mark the same order as paid twice (and trigger a ' +
      'double notification to the customer).\n\n' +
      '**Why it matters:** the handler runs as a serverless function invoked by the payment ' +
      'provider\'s webhook gateway; the provider can retry (and does retry) the same ' +
      'notification, and several concurrent invocations of the same function can process the ' +
      'same `orderId` in parallel.\n\n' +
      '**What to review:**\n' +
      '- @mgarcia\'s comment is still open: `acquireOrderLock` — is it an in-process memory lock ' +
      'or a distributed one? With several concurrent instances of the function (the normal case ' +
      'in production), an in-memory lock is not enough: each invocation sees its own copy and ' +
      'they do not block each other.\n' +
      '- The CI job fails intermittently (see the PR description) — confirm whether it is the fix ' +
      'or a flake of the test environment before approving.',
  },
  {
    kind: 'walkthrough',
    markdown: '',
    cohorts: [
      {
        title: 'Webhook idempotency',
        layers: [
          {
            title: 'Lock around the paid transition',
            markdown:
              'The read-check-write sequence now runs inside `acquireOrderLock(orderId)` with a `finally` release. Ask whether the lock is per process or distributed: with several instances an in-memory lock does not close the race.',
            files: [{ path: 'src/webhooks/payment-webhook-handler.ts', ranges: [{ start: 14, end: 22 }] }],
            mermaid:
              'sequenceDiagram\n' +
              '  participant W as Webhook\n' +
              '  participant L as OrderLock\n' +
              '  participant O as OrderRepository\n' +
              '  W->>L: acquire(orderId)\n' +
              '  W->>O: findById\n' +
              '  W->>O: markPaid\n' +
              '  W->>L: release\n',
          },
          {
            title: 'Concurrency regression test',
            markdown:
              'Fires the same webhook twice with `Promise.all` and asserts `markPaid` runs once. Since CI is flaky, check that the test fails without the lock.',
            files: [{ path: 'src/webhooks/payment-webhook-handler.test.ts', ranges: [{ start: 41, end: 44 }] }],
          },
        ],
      },
    ],
  },
  {
    kind: 'setup',
    markdown:
      '## How to try this PR\n\n' +
      'The diff shows no `Dockerfile` or `docker-compose.yml`, so there is no evidence of a Docker ' +
      'flow in this demo.\n\n' +
      '**Locally:** `handlePaymentWebhook` is a Node.js function invoked by the payment webhook ' +
      'gateway:\n\n' +
      '1. `npm install`\n' +
      '2. `npm run dev` (invokes the handler against a simulated test event)\n\n' +
      '**Environment variables needed:** `DATABASE_URL` (Postgres, via `OrderRepository`) and the ' +
      'credentials of the distributed lock (see the infra section below).\n\n' +
      '**NEW environment variables in this PR:** this PR adds no environment variables of its own ' +
      '— the lock it introduces reuses the existing database connection.',
    snippets: [
      {
        label: 'local-start',
        language: 'bash',
        code: 'npm install\nnpm run dev',
      },
      {
        label: 'env',
        language: 'env',
        code: 'DATABASE_URL=postgres://localhost:5432/shopwave',
      },
    ],
  },
  {
    kind: 'cloud',
    markdown:
      '## How the deployed system works\n\n' +
      '`payment-webhook-handler` is not a long-running server: it is a Lambda function behind an ' +
      'API Gateway that the payment provider invokes for every event (payment confirmed, refund, ' +
      'etc.). The Lambda reads and updates the order in DynamoDB and, if the payment is ' +
      'confirmed, queues an event in SQS so that another Lambda (`order-notifier`) sends the ' +
      'confirmation email to the customer through SES. Being serverless, the payment provider ' +
      'can trigger several concurrent invocations of the SAME Lambda for the same `orderId` ' +
      '(webhook retries, traffic spikes) — there is no single process instance serving all of ' +
      'them.\n\n' +
      '## Where this PR has an effect\n\n' +
      'The lock this PR adds lives in `payment-webhook-handler` and must coordinate those ' +
      'concurrent invocations with each other. If `acquireOrderLock` were an in-memory lock ' +
      '(@mgarcia\'s question in the comments), each Lambda invocation would see its own state and ' +
      'the fix would be useless in production: the lock needs to live outside the function, in a ' +
      'place shared by every invocation — for example a conditional write against the DynamoDB ' +
      '`Orders` table (already on the path) or a separate locks table.',
    mermaids: [
      'architecture-beta\n' +
        'group aws(logos:aws)[AWS]\n' +
        'service payer(internet)[Payment Provider]\n' +
        'service gw(logos:aws-api-gateway)[Webhook Gateway] in aws\n' +
        'service handler(logos:aws-lambda)[Webhook Handler] in aws\n' +
        'service orders(logos:aws-dynamodb)[Orders Table] in aws\n' +
        'service queue(logos:aws-sqs)[Notify Queue] in aws\n' +
        'service notifier(logos:aws-lambda)[Order Notifier] in aws\n' +
        'service email(logos:aws-ses)[Email] in aws\n' +
        'payer:R -- L:gw\n' +
        'gw:R -- L:handler\n' +
        'handler:R -- L:orders\n' +
        'handler:B -- T:queue\n' +
        'queue:R -- L:notifier\n' +
        'notifier:R -- L:email\n',
      'architecture-beta\n' +
        'service handler(logos:aws-lambda)[Webhook Handler PR]\n' +
        'service orders(logos:aws-dynamodb)[Orders Table PR]\n' +
        'service queue(logos:aws-sqs)[Notify Queue]\n' +
        'handler:R -- L:orders\n' +
        'handler:B -- T:queue\n',
    ],
  },
]

/** Secciones enriquecidas por `prId` (`owner/name#number`, igual formato que `PullRequestDetail.id`). */
/** Keyed by `prKey`. */
export const richDidacticSections: Record<string, DidacticSection[]> = {
  [prKey(githubRepo('shopwave', 'api'), 482)]: pr482Sections,
  [prKey(githubRepo('shopwave', 'api'), 479)]: pr479Sections,
  [prKey(githubRepo('shopwave', 'web'), 201)]: pr201Sections,
  [prKey(githubRepo('shopwave', 'checkout-service'), 77)]: pr77Sections,
}
