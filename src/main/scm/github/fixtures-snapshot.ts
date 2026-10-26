/**
 * Árbol de archivos fixture (T54) que `MockGithubService.writeSnapshot`
 * escribe a disco con `fs` para simular "el repo al commit del PR" que los
 * proveedores agénticos exploran. Uno por repo del universo shopwave
 * (`./fixtures.ts`): ~7-8 archivos plausibles (manifest, un par de
 * rutas/handlers Express, un modelo/migración SQL, un README corto) — no
 * necesitan reflejar los diffs reales de cada PR, solo dar a un agente algo
 * de contexto real para leer con Read/Grep.
 *
 * GOTCHA DE BUILD (bitácora en `.agents/TASKS.md`): todo el contenido largo
 * de este archivo usa comillas normales concatenadas con `+` y `\n`
 * explícito, NUNCA un template literal delimitado por backticks — el plugin
 * `vite:esm-shim` de electron-vite busca en texto plano dónde termina el
 * último `import ... from '...'` del bundle, y estos fixtures SÍ contienen
 * literalmente strings `import ... from ...` (son código Express/TS de
 * mentira). Backticks sueltos DENTRO de una comilla normal son seguros
 * (mismo patrón que `./fixtures.ts` y `../ai/fixtures.ts`).
 */

export interface SnapshotFixtureFile {
  /** Ruta relativa dentro del snapshot, siempre con `/` (nunca separador de SO). */
  path: string
  content: string
}

const apiFiles: SnapshotFixtureFile[] = [
  {
    path: 'package.json',
    content:
      '{\n' +
      '  "name": "@shopwave/api",\n' +
      '  "version": "3.4.0",\n' +
      '  "private": true,\n' +
      '  "type": "module",\n' +
      '  "scripts": {\n' +
      '    "dev": "tsx watch src/index.ts",\n' +
      '    "build": "tsc -p tsconfig.json",\n' +
      '    "test": "vitest run"\n' +
      '  },\n' +
      '  "dependencies": {\n' +
      '    "express": "^4.19.2",\n' +
      '    "pg": "^8.11.5",\n' +
      '    "zod": "^3.23.8"\n' +
      '  }\n' +
      '}\n',
  },
  {
    path: 'README.md',
    content:
      '# shopwave/api\n\n' +
      'API REST del backend de carritos, cupones y checkout de Shopwave.\n\n' +
      '## Arrancar en local\n\n' +
      '```\n' +
      'npm install\n' +
      'npm run dev\n' +
      '```\n\n' +
      'Escucha en `localhost:3000` por defecto (ver `src/index.ts`).\n',
  },
  {
    path: 'src/index.ts',
    content:
      "import express from 'express'\n" +
      "import { cartsRouter } from './routes/carts.js'\n" +
      "import { chargeHandler } from './routes/charge.js'\n\n" +
      'const app = express()\n' +
      'app.use(express.json())\n' +
      "app.use('/api/v1/carts', cartsRouter)\n" +
      "app.post('/charge', chargeHandler)\n\n" +
      'const port = process.env.PORT ?? 3000\n' +
      'app.listen(port, () => {\n' +
      "  console.log('shopwave/api listening on ' + port)\n" +
      '})\n',
  },
  {
    path: 'src/routes/carts.ts',
    content:
      "import { Router } from 'express'\n" +
      "import { CartsService } from '../services/carts-service.js'\n\n" +
      'export const cartsRouter = Router()\n\n' +
      "cartsRouter.get('/:id', async (req, res) => {\n" +
      '  const cart = await CartsService.findById(req.params.id)\n' +
      "  if (!cart) return res.status(404).json({ error: 'not_found' })\n" +
      '  res.json(cart)\n' +
      '})\n\n' +
      "cartsRouter.post('/:id/apply-coupon', async (req, res) => {\n" +
      '  const { code } = req.body\n' +
      '  const result = await CartsService.applyCoupon(req.params.id, code)\n' +
      '  res.json(result)\n' +
      '})\n',
  },
  {
    path: 'src/routes/charge.ts',
    content:
      "import type { Request, Response } from 'express'\n" +
      "import { PaymentsClient } from '../services/payments-client.js'\n\n" +
      'export async function chargeHandler(req: Request, res: Response): Promise<void> {\n' +
      '  const { amount, currency } = req.body\n' +
      '  const result = await PaymentsClient.charge(amount, currency)\n' +
      '  res.status(result.status).json(result.body)\n' +
      '}\n',
  },
  {
    path: 'src/services/carts-service.ts',
    content:
      "import { db } from '../db.js'\n\n" +
      'export const CartsService = {\n' +
      '  async findById(id: string) {\n' +
      "    const { rows } = await db.query('select * from carts where id = $1', [id])\n" +
      '    return rows[0] ?? null\n' +
      '  },\n' +
      '  async applyCoupon(id: string, code: string) {\n' +
      "    const { rows } = await db.query('select * from coupons where code = $1', [code])\n" +
      '    const coupon = rows[0]\n' +
      "    if (!coupon) throw new Error('coupon_not_found')\n" +
      '    return { cartId: id, couponCode: code, discount: coupon.discount }\n' +
      '  },\n' +
      '}\n',
  },
  {
    path: 'migrations/0012_add_coupons.sql',
    content:
      'CREATE TABLE coupons (\n' +
      '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n' +
      '  code VARCHAR(32) UNIQUE NOT NULL,\n' +
      '  discount NUMERIC(5, 2) NOT NULL,\n' +
      '  min_amount_cents INTEGER NOT NULL DEFAULT 0,\n' +
      '  expires_at TIMESTAMPTZ,\n' +
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n' +
      ');\n\n' +
      'CREATE INDEX idx_coupons_code ON coupons (code);\n',
  },
]

const webFiles: SnapshotFixtureFile[] = [
  {
    path: 'package.json',
    content:
      '{\n' +
      '  "name": "@shopwave/web",\n' +
      '  "version": "2.1.0",\n' +
      '  "private": true,\n' +
      '  "scripts": {\n' +
      '    "dev": "vite",\n' +
      '    "build": "vite build"\n' +
      '  },\n' +
      '  "dependencies": {\n' +
      '    "react": "^18.3.1",\n' +
      '    "react-dom": "^18.3.1"\n' +
      '  }\n' +
      '}\n',
  },
  {
    path: 'README.md',
    content:
      '# shopwave/web\n\n' +
      'Frontend de la tienda (catálogo, carrito, checkout). Consume `shopwave/api`.\n\n' +
      '## Arrancar en local\n\n' +
      '```\n' +
      'npm install\n' +
      'npm run dev\n' +
      '```\n',
  },
  {
    path: 'src/main.tsx',
    content:
      "import React from 'react'\n" +
      "import ReactDOM from 'react-dom/client'\n" +
      "import { App } from './App.js'\n\n" +
      "ReactDOM.createRoot(document.getElementById('root')!).render(<App />)\n",
  },
  {
    path: 'src/App.tsx',
    content:
      "import { CartPage } from './pages/CartPage.js'\n\n" +
      'export function App() {\n' +
      '  return <CartPage />\n' +
      '}\n',
  },
  {
    path: 'src/pages/CartPage.tsx',
    content:
      "import { useEffect, useState } from 'react'\n" +
      "import { fetchCart } from '../api/carts.js'\n\n" +
      'export function CartPage() {\n' +
      '  const [cart, setCart] = useState(null)\n\n' +
      '  useEffect(() => {\n' +
      "    fetchCart('current').then(setCart)\n" +
      '  }, [])\n\n' +
      '  if (!cart) return <p>Cargando carrito...</p>\n' +
      '  return <pre>{JSON.stringify(cart, null, 2)}</pre>\n' +
      '}\n',
  },
  {
    path: 'src/api/carts.ts',
    content:
      "const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000'\n\n" +
      'export async function fetchCart(id: string) {\n' +
      "  const res = await fetch(API_BASE + '/api/v1/carts/' + id)\n" +
      '  return res.json()\n' +
      '}\n',
  },
]

const checkoutFiles: SnapshotFixtureFile[] = [
  {
    path: 'package.json',
    content:
      '{\n' +
      '  "name": "@shopwave/checkout-service",\n' +
      '  "version": "1.9.2",\n' +
      '  "private": true,\n' +
      '  "type": "module",\n' +
      '  "scripts": {\n' +
      '    "dev": "tsx watch src/index.ts"\n' +
      '  },\n' +
      '  "dependencies": {\n' +
      '    "express": "^4.19.2",\n' +
      '    "ioredis": "^5.4.1"\n' +
      '  }\n' +
      '}\n',
  },
  {
    path: 'README.md',
    content:
      '# shopwave/checkout-service\n\n' +
      'Microservicio de cobros: habla con el proveedor de pagos externo y expone\n' +
      '`POST /charge` con soporte de idempotencia.\n',
  },
  {
    path: 'src/index.ts',
    content:
      "import express from 'express'\n" +
      "import { chargeHandler } from './routes/charge.js'\n\n" +
      'const app = express()\n' +
      'app.use(express.json())\n' +
      "app.post('/charge', chargeHandler)\n\n" +
      'const port = process.env.PORT ?? 4000\n' +
      'app.listen(port)\n',
  },
  {
    path: 'src/routes/charge.ts',
    content:
      "import type { Request, Response } from 'express'\n" +
      "import { IdempotencyStore } from '../services/idempotency-store.js'\n" +
      "import { PaymentsGateway } from '../services/payments-gateway.js'\n\n" +
      'export async function chargeHandler(req: Request, res: Response): Promise<void> {\n' +
      "  const key = req.header('Idempotency-Key')\n" +
      '  if (key) {\n' +
      '    const cached = await IdempotencyStore.get(key)\n' +
      '    if (cached) {\n' +
      '      res.status(cached.status).json(cached.body)\n' +
      '      return\n' +
      '    }\n' +
      '  }\n' +
      '  const result = await PaymentsGateway.charge(req.body)\n' +
      '  if (key) await IdempotencyStore.set(key, result)\n' +
      '  res.status(result.status).json(result.body)\n' +
      '}\n',
  },
  {
    path: 'src/services/idempotency-store.ts',
    content:
      "import { redis } from '../redis.js'\n\n" +
      'export const IdempotencyStore = {\n' +
      '  async get(key: string) {\n' +
      "    const raw = await redis.get('idem:' + key)\n" +
      '    return raw ? JSON.parse(raw) : null\n' +
      '  },\n' +
      '  async set(key: string, response: unknown) {\n' +
      "    await redis.set('idem:' + key, JSON.stringify(response), 'EX', 86400)\n" +
      '  },\n' +
      '}\n',
  },
  {
    path: 'migrations/0004_add_charges.sql',
    content:
      'CREATE TABLE charges (\n' +
      '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n' +
      '  idempotency_key VARCHAR(64) UNIQUE,\n' +
      '  amount_cents INTEGER NOT NULL,\n' +
      "  currency VARCHAR(3) NOT NULL DEFAULT 'USD',\n" +
      "  status VARCHAR(16) NOT NULL DEFAULT 'pending',\n" +
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n' +
      ');\n',
  },
  // Infra AWS declarada (F15): habilita la sección didáctica `cloud` cuando el
  // proveedor de IA es REAL (la regla anti-alucinación del prompt exige IaC
  // visible en el snapshot). Coherente con la fixture didáctica de
  // shopwave/checkout-service#77 (Lambda + DynamoDB + SQS + SES).
  {
    path: 'serverless.yml',
    content:
      'service: checkout-service\n\n' +
      'provider:\n' +
      '  name: aws\n' +
      '  runtime: nodejs20.x\n' +
      '  region: us-east-1\n\n' +
      'functions:\n' +
      '  payment-webhook-handler:\n' +
      '    handler: src/webhooks/payment-webhook-handler.handle\n' +
      '    events:\n' +
      '      - httpApi:\n' +
      '          method: POST\n' +
      '          path: /webhooks/payment\n' +
      '  order-notifier:\n' +
      '    handler: src/notifier/order-notifier.handle\n' +
      '    events:\n' +
      '      - sqs:\n' +
      '          arn: !GetAtt NotifyQueue.Arn\n\n' +
      'resources:\n' +
      '  Resources:\n' +
      '    OrdersTable:\n' +
      '      Type: AWS::DynamoDB::Table\n' +
      '      Properties:\n' +
      '        TableName: shopwave-orders\n' +
      '        BillingMode: PAY_PER_REQUEST\n' +
      '    NotifyQueue:\n' +
      '      Type: AWS::SQS::Queue\n' +
      '      Properties:\n' +
      '        QueueName: shopwave-order-notify\n',
  },
  {
    path: 'src/webhooks/payment-webhook-handler.ts',
    content:
      "import { DynamoDBClient } from '@aws-sdk/client-dynamodb'\n" +
      "import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'\n" +
      "import { acquireOrderLock, releaseOrderLock } from './order-lock.js'\n\n" +
      'const db = new DynamoDBClient({})\n' +
      'const sqs = new SQSClient({})\n\n' +
      'export async function handle(event: { body: string }): Promise<{ statusCode: number }> {\n' +
      '  const payload = JSON.parse(event.body)\n' +
      '  const lock = await acquireOrderLock(payload.orderId)\n' +
      '  if (!lock) return { statusCode: 409 }\n' +
      '  try {\n' +
      '    // marca la orden como pagada en DynamoDB y encola la notificacion\n' +
      '    await markOrderPaid(db, payload.orderId)\n' +
      '    await sqs.send(new SendMessageCommand({\n' +
      '      QueueUrl: process.env.NOTIFY_QUEUE_URL,\n' +
      '      MessageBody: JSON.stringify({ orderId: payload.orderId }),\n' +
      '    }))\n' +
      '    return { statusCode: 200 }\n' +
      '  } finally {\n' +
      '    await releaseOrderLock(payload.orderId)\n' +
      '  }\n' +
      '}\n\n' +
      'async function markOrderPaid(client: DynamoDBClient, orderId: string): Promise<void> {\n' +
      '  // UpdateItem sobre la tabla shopwave-orders (omitido en la fixture)\n' +
      '}\n',
  },
]

/** Árbol fixture por repo, indexado por `RepoRef.fullName` (p. ej. `shopwave/api`). */
export const snapshotFixturesByRepo: Record<string, SnapshotFixtureFile[]> = {
  'shopwave/api': apiFiles,
  'shopwave/web': webFiles,
  'shopwave/checkout-service': checkoutFiles,
}

/** Árbol genérico para cualquier repo fuera del universo shopwave (mock robusto ante inputs no previstos). */
export const genericSnapshotFixture: SnapshotFixtureFile[] = [
  {
    path: 'package.json',
    content: '{\n  "name": "mock-repo",\n  "private": true\n}\n',
  },
  {
    path: 'README.md',
    content:
      '# Repo mock\n\nSnapshot genérico (MINERVA_MOCK=1) sin fixture específico para este repo.\n',
  },
  {
    path: 'src/index.ts',
    content: "export function main(): void {\n  console.log('mock repo')\n}\n",
  },
]
