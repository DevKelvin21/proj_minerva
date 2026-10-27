/**
 * Spanish copy of `./fixtures.ts` (same structure, same PRs): what the mock AI
 * serves when the analysis language is `es`.
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

/** Respuesta mock a la pregunta del revisor sobre unas líneas (`ai:askAboutLines`). */
export function lineAnswerSection(question: LineQuestion): DidacticSection {
  const where =
    question.startLine === question.endLine
      ? question.path + ':' + question.startLine
      : question.path + ':' + question.startLine + '-' + question.endLine
  return {
    kind: 'summary',
    markdown:
      'Respuesta mock para `' +
      where +
      '`: estas líneas son parte del cambio que hace este PR. Con un proveedor de IA real, el ' +
      'agente lee el archivo en el commit del PR antes de responder tu pregunta.\n\n' +
      'Siguiente paso: compáralas con el código que las llama y decide si necesitan un ' +
      'comentario.',
  }
}

/** Resumen genérico para PRs sin sección enriquecida en esta demo mock. */
export function genericSummarySection(detail: PullRequestDetail): DidacticSection {
  const labels =
    detail.labels.length > 0 ? detail.labels.map((l) => l.name).join(', ') : 'sin etiquetas'

  return {
    kind: 'summary',
    markdown:
      '## Resumen\n\n**' +
      detail.title +
      '** (' +
      detail.repo.fullName +
      '#' +
      detail.number +
      ')\n\n' +
      'Cambia ' +
      (detail.changedFiles ?? '?') +
      ' archivo(s): +' +
      (detail.additions ?? '?') +
      ' / -' +
      (detail.deletions ?? '?') +
      '. Etiquetas: ' +
      labels +
      '.\n\n' +
      'Este PR no disparó ninguna sección enriquecida (arquitectura, endpoint o esquema) en esta ' +
      'demo con datos mock: en el pipeline real, el clasificador de IA decide automáticamente qué ' +
      'secciones generar a partir del diff (ver `.claude/skills/` y `src/main/ai/prompts/README.md`).',
  }
}

const pr482Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Este PR agrega el endpoint `POST /api/v1/carts/:id/apply-coupon`: valida un código de cupón ' +
      'y, si es válido, recalcula el total del carrito activo.\n\n' +
      '**Por qué importa:** es el primer punto donde un cliente puede modificar el total del carrito ' +
      'con un código externo. Un bug aquí puede traducirse en descuentos no acotados (pérdida de ' +
      'ingresos) o en cupones legítimos rechazados (mala experiencia).\n\n' +
      '**Qué revisar:**\n' +
      '- El clamp del descuento: en el hilo de comentarios se señala que `coupon.discountRate` sin ' +
      'tope podía llegar a 100%; confirmar que el fix (clamp a 0.9) está en este diff.\n' +
      '- El caso "cupón ya aplicado" (409) todavía no tiene test, según el último comentario de revisión.\n' +
      '- Que toda la validación viva en `CouponService` y no se duplique en el handler de la ruta.',
  },
  {
    kind: 'walkthrough',
    markdown:
      'Leé primero el servicio nuevo (es dueño de las reglas de negocio), después la ruta que lo expone y por último el test que fija el caso del cupón vencido.',
    cohorts: [
      {
        title: 'Endpoint apply-coupon',
        layers: [
          {
            title: 'Servicio de validación de cupones',
            markdown:
              '`CouponService.apply` es el núcleo del PR: busca el cupón, rechaza los vencidos o ya aplicados con un `reason`, y recalcula el total con `discountRate`. El resto del PR solo cablea esta función.',
            files: [{ path: 'src/services/coupon-service.ts', ranges: [{ start: 3, end: 7 }, { start: 9, end: 21 }] }],
          },
          {
            title: 'Cableado de la ruta y mapeo HTTP',
            markdown:
              '`registerCartRoutes` suma `POST /carts/:id/apply-coupon`; el handler carga el carrito, delega en el servicio y mapea `result.ok` a 200 o 409. Ojo: todavía no hay validación de entrada sobre `req.body.code`.',
            files: [{ path: 'src/routes/carts.ts', ranges: [{ start: 13, end: 13 }, { start: 20, end: 27 }] }],
            mermaid:
              'sequenceDiagram\n' +
              '  participant C as Cliente\n' +
              '  participant R as router de carts\n' +
              '  participant S as CouponService\n' +
              '  C->>R: POST /carts/:id/apply-coupon\n' +
              '  R->>S: apply(cart, code)\n' +
              '  S-->>R: { ok, total, reason? }\n' +
              '  R-->>C: 200 o 409\n',
          },
          {
            title: 'Test unitario del caso vencido',
            markdown:
              'Un caso de Vitest cubre el cupón vencido. La rama `already_applied` y el camino feliz todavía no tienen test: vale la pena pedirlos antes de mergear.',
            files: [{ path: 'src/services/coupon-service.test.ts', ranges: [{ start: 4, end: 9 }] }],
          },
        ],
      },
    ],
  },
  {
    kind: 'setup',
    markdown:
      '## Cómo probar este PR\n\n' +
      'El diff de este PR no muestra un `Dockerfile` ni un `docker-compose.yml` entre los archivos ' +
      'tocados, así que no hay evidencia directa de un flujo Docker para esta demo — si `shopwave/api` ' +
      'tiene uno para levantar la base de datos, no aparece en estos archivos.\n\n' +
      '**En local:** el archivo tocado usa `express` (`import { Router } from \'express\'`), así que ' +
      'es la API Node.js/Express habitual del repo:\n\n' +
      '1. `npm install`\n' +
      '2. `npm run dev` (o `npm start`, según el `package.json` del repo)\n\n' +
      '**Variables de entorno necesarias para correr la API:** `DATABASE_URL` (conexión a Postgres, ' +
      'usada por `CartService`/`OrderRepository`) y `PORT` (puerto HTTP).\n\n' +
      '**Variables de entorno NUEVAS de este PR:** sí — `CouponService` introduce un tope ' +
      'configurable para el descuento máximo (ver "Qué revisar" arriba, el clamp a 0.9):\n\n' +
      '| Variable | Propósito | Valor de ejemplo |\n' +
      '|---|---|---|\n' +
      '| `COUPON_MAX_DISCOUNT_RATE` | Tope superior del `discountRate` que `CouponService.apply` ' +
      'acepta de un cupón (evita descuentos no acotados) | `0.9` |',
    snippets: [
      {
        label: 'arranque-local',
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
      '| **Path param** | `id` — id del carrito activo |\n' +
      '| **Body** | `{ "code": string }` |\n' +
      '| **200 OK** | `{ "ok": true, "total": number }` — cupón aplicado, total recalculado |\n' +
      '| **409 Conflict** | `{ "ok": false, "reason": "already_applied" }` — el carrito ya tenía cupón |\n' +
      '| **200 con `ok:false`** | `{ "ok": false, "reason": "expired_or_missing" }` — código inválido o vencido |\n\n' +
      'El handler delega toda la lógica a `CouponService.apply(cart, code)` (servicio nuevo, ver ' +
      'diagrama de arquitectura más abajo).',
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
      '`CouponService` es un servicio nuevo, independiente de `CartService`: la ruta ' +
      '`POST /carts/:id/apply-coupon` lo invoca para mantener la validación de cupones fuera del ' +
      'handler HTTP.',
    mermaid:
      'C4Container\n' +
      // Sin '#' en el título: el lexer C4 de mermaid (11.16) lanza "Lexical
      // error" con '#' dentro del DSL (descubierto en T16; misma regla en el
      // prompt real y en la skill mermaid-c4-diagram).
      '  title Impacto arquitectónico del PR 482 (apply-coupon)\n' +
      '  Person(customer, "Cliente", "Compra en Shopwave")\n' +
      '  System_Boundary(shopwave, "Shopwave") {\n' +
      '    Container(api, "API", "Node.js / Express", "Expone REST a clientes")\n' +
      '    Container(couponService, "CouponService (NUEVO)", "TypeScript", "Valida y aplica cupones a un carrito")\n' +
      '    ContainerDb(db, "Base de datos", "PostgreSQL", "Carritos, cupones, órdenes")\n' +
      '  }\n' +
      '  Rel(customer, api, "POST /carts/:id/apply-coupon")\n' +
      // Etiquetas de Rel ≤4 palabras (misma regla que el prompt real, T16):
      // las largas se enciman con las cajas vecinas en el layout C4.
      '  Rel(api, couponService, "delega validación")\n' +
      '  Rel(couponService, db, "lee y guarda")\n',
  },
]

const pr479Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Introduce la tabla `refunds` (migración aditiva) para soportar reembolsos parciales por ' +
      'línea de orden, junto al modelo `Refund` y un campo `refundedAmount` calculado en `Order`.\n\n' +
      '**Por qué importa:** es un cambio de esquema en producción. Aunque la migración no toca ' +
      'datos existentes, define una relación nueva (`Order` 1—N `Refund`) de la que otros servicios ' +
      'empezarán a depender.\n\n' +
      '**Qué revisar:**\n' +
      '- El `CHECK (amount_cents > 0)` no impide reembolsar más de lo que vale la línea de orden ' +
      '(ver comentario de @mgarcia); falta un tope contra `order_lines.amount_cents`.\n' +
      '- `refundedAmount` se recalcula en la capa de aplicación, no con un trigger de base de datos ' +
      '— confirmar que todo camino que crea un `Refund` pasa por ese recálculo.',
  },
  {
    kind: 'walkthrough',
    markdown: '',
    cohorts: [
      {
        title: 'Modelo de datos de reembolsos',
        layers: [
          {
            title: 'Migración: la tabla refunds',
            markdown:
              'Migración aditiva: `refunds` referencia `orders` y `order_lines`, con un CHECK de monto positivo y un índice por `order_id`. No altera nada existente, así que se puede desplegar antes del feature flag.',
            files: [{ path: 'migrations/2026070401_create_refunds.sql', ranges: [{ start: 1, end: 10 }] }],
          },
          {
            title: 'Modelo de dominio Refund',
            markdown:
              'El espejo TypeScript de la tabla. `amountCents` es entero; conviene verificar que en la práctica no pase `Number.MAX_SAFE_INTEGER`.',
            files: [{ path: 'src/models/refund.ts', ranges: [{ start: 1, end: 8 }] }],
          },
          {
            title: 'Order aprende su monto reembolsado',
            markdown:
              '`Order.refundedAmount` es un campo desnormalizado que recalcula el mismo servicio que crea un `Refund` (sin trigger de base de datos). Todo camino que cree un reembolso tiene que pasar por ese recálculo.',
            files: [{ path: 'src/models/order.ts', ranges: [{ start: 24, end: 25 }] }],
          },
        ],
      },
    ],
  },
  {
    kind: 'setup',
    markdown:
      '## Cómo probar este PR\n\n' +
      'Es una migración (`migrations/2026070401_create_refunds.sql`) más un modelo nuevo; el diff no ' +
      'muestra `Dockerfile` ni `docker-compose.yml`, así que no hay evidencia de un flujo Docker en ' +
      'esta demo.\n\n' +
      '**En local:** misma API Node.js de `shopwave/api`:\n\n' +
      '1. `npm install`\n' +
      '2. Correr la migración nueva contra la base (el repo no expone en este diff el comando exacto ' +
      'del runner de migraciones — buscar el script `migrate` en `package.json`).\n' +
      '3. `npm run dev`\n\n' +
      '**Variables de entorno necesarias para correr la API:** `DATABASE_URL` (Postgres, es contra ' +
      'esa misma base que corre la migración de `refunds`).\n\n' +
      '**Variables de entorno NUEVAS de este PR:** este PR no agrega ni cambia variables de entorno ' +
      '— es una migración de esquema pura, sin código de aplicación que lea `process.env`.',
    snippets: [
      {
        label: 'arranque-local',
        language: 'bash',
        code: 'npm install\nnpm run dev',
      },
    ],
  },
  {
    kind: 'schema',
    markdown:
      '### Tabla `refunds`\n\n' +
      '| Campo | Tipo | Notas |\n' +
      '|---|---|---|\n' +
      '| `id` | `uuid` | PK, `gen_random_uuid()` |\n' +
      '| `order_id` | `uuid` | FK -> `orders.id` |\n' +
      '| `order_line_id` | `uuid` | FK -> `order_lines.id` |\n' +
      '| `amount_cents` | `integer` | `CHECK (amount_cents > 0)`, sin tope superior aún |\n' +
      '| `reason` | `text` | opcional |\n' +
      '| `created_at` | `timestamptz` | default `now()` |\n\n' +
      'Índice `idx_refunds_order_id` sobre `order_id` para listar reembolsos por orden.',
    mermaid:
      'erDiagram\n' +
      '    ORDER ||--o{ REFUND : tiene\n' +
      '    ORDER {\n' +
      '        string id PK\n' +
      '        string status\n' +
      '        int total\n' +
      '        int refundedAmount\n' +
      '    }\n' +
      '    REFUND {\n' +
      '        string id PK "NUEVO"\n' +
      '        string orderId FK "NUEVO"\n' +
      '        string orderLineId FK "NUEVO"\n' +
      '        int amountCents "NUEVO"\n' +
      '        string reason "NUEVO"\n' +
      '        string createdAt "NUEVO"\n' +
      '    }\n',
  },
]

const pr201Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Reemplaza la máquina de estados imperativa de checkout (`CheckoutMachine`, clase con estado ' +
      'mutable) por un reducer puro (`checkoutReducer` + `useReducer`), y convierte ' +
      '`CheckoutValidator` (clase) en funciones puras de validación. Sin cambios de comportamiento ' +
      'visible para el usuario.\n\n' +
      '**Por qué importa:** es un refactor grande (243 líneas agregadas, 273 eliminadas) que toca el ' +
      'flujo central de compra. El riesgo no es "qué se ve distinto" sino "qué transición dejó de ' +
      'cubrirse" al migrar la lógica.\n\n' +
      '**Qué revisar:**\n' +
      '- El reducer no cubre explícitamente `shipping -> payment` con eventos distintos de ' +
      '`CONTINUE`, ni la transición `payment -> confirmation` (ver comentario de @sfontaine).\n' +
      '- Que `validateCheckout` combine los mismos casos que antes cubrían ' +
      '`CheckoutValidator.validateCart/validateShipping/validatePayment` por separado.',
  },
  {
    kind: 'walkthrough',
    markdown:
      'Dos hilos de trabajo independientes: la máquina de estados pasa a ser un reducer, y la clase validadora pasa a funciones puras. Cada uno se puede revisar por separado.',
    cohorts: [
      {
        title: 'De máquina de estados a reducer',
        layers: [
          {
            title: 'El reducer puro de checkout',
            markdown:
              '`checkoutReducer` codifica las transiciones como un `switch` sobre el estado actual. Compará contra la clase vieja: la transición `payment -> confirmation` no aparece en el diff.',
            files: [{ path: 'src/features/checkout/checkout-reducer.ts', ranges: [{ start: 1, end: 12 }] }],
            mermaid:
              'stateDiagram-v2\n' +
              '  [*] --> cart\n' +
              '  cart --> shipping: CONTINUE\n' +
              '  shipping --> payment: CONTINUE\n' +
              '  shipping --> cart: otro evento\n' +
              '  payment --> confirmation: falta en el diff\n',
          },
          {
            title: 'CheckoutPage pasa a useReducer',
            markdown:
              'La página reemplaza la instancia memoizada de `CheckoutMachine` por `useReducer(checkoutReducer, \'cart\')`; `dispatch` baja por prop por ahora.',
            files: [{ path: 'src/features/checkout/CheckoutPage.tsx', ranges: [{ start: 1, end: 6 }] }],
          },
          {
            title: 'Máquina vieja y módulo de tipos',
            markdown:
              '`checkout-machine.ts` se borra entero y `checkout-types.ts` se renombra a `checkout-state.ts` sin cambios de contenido.',
            files: [
              { path: 'src/features/checkout/checkout-machine.ts', ranges: [{ start: 1, end: 7 }] },
              { path: 'src/features/checkout/checkout-state.ts', ranges: [] },
            ],
          },
        ],
      },
      {
        title: 'Validación como funciones puras',
        layers: [
          {
            title: 'Los validadores devuelven un objeto resultado',
            markdown:
              '`CheckoutValidator` (estado mutable `errors`) pasa a `validateCart` / `validateShipping` / `validatePayment` devolviendo `{ valid, errors }`, más un `validateCheckout` compuesto. Cambio de comportamiento escondido en el refactor: `bank_transfer` entra a los métodos de pago permitidos.',
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
      'El componente `CheckoutPage` pasa de orquestar una instancia de clase (`CheckoutMachine`) a ' +
      'despachar eventos contra un reducer puro. `checkout-validation.ts` deja de depender de estado ' +
      'mutable (`this.errors`) y expone funciones independientes por paso.',
    mermaid:
      'C4Component\n' +
      '  title Checkout (web) - antes y despues del refactor a reducer\n' +
      '  Container_Boundary(checkout, "Modulo checkout") {\n' +
      '    Component(page, "CheckoutPage", "Componente React", "Orquesta el flujo de compra")\n' +
      '    Component(machineOld, "CheckoutMachine (ELIMINADO)", "Clase con estado mutable", "Logica de transicion imperativa, ~130 lineas")\n' +
      '    Component(reducerNew, "checkoutReducer (NUEVO)", "Funcion pura", "Reemplaza a CheckoutMachine")\n' +
      '    Component(validation, "checkout-validation", "Funciones puras", "Antes: clase CheckoutValidator con estado mutable")\n' +
      '  }\n' +
      '  Rel(page, machineOld, "usaba (antes del refactor)")\n' +
      '  Rel(page, reducerNew, "usa useReducer (despues del refactor)")\n' +
      '  Rel(page, validation, "valida con validateCheckout")\n',
  },
]

const pr77Sections: DidacticSection[] = [
  {
    kind: 'summary',
    markdown:
      '## Qué cambia\n\n' +
      'Este PR agrega un lock optimista por `orderId` en `handlePaymentWebhook` para evitar que dos ' +
      'webhooks de pago casi simultáneos marquen la misma orden como pagada dos veces (y disparen ' +
      'doble notificación al cliente).\n\n' +
      '**Por qué importa:** el handler corre como una función serverless invocada por el gateway de ' +
      'webhooks del proveedor de pago; el proveedor puede reintentar (y de hecho reintenta) la ' +
      'misma notificación, y varias invocaciones concurrentes de la misma función pueden procesar ' +
      'el mismo `orderId` en paralelo.\n\n' +
      '**Qué revisar:**\n' +
      '- El comentario de @mgarcia sigue abierto: `acquireOrderLock` — ¿es un lock en memoria del ' +
      'proceso o uno distribuido? Con varias instancias concurrentes de la función (el caso normal ' +
      'en producción), un lock en memoria no alcanza: cada invocación ve su propia copia y no se ' +
      'bloquean entre sí.\n' +
      '- El job de CI falla intermitentemente (ver descripción del PR) — confirmar si es el fix o ' +
      'un flake del entorno de test antes de aprobar.',
  },
  {
    kind: 'walkthrough',
    markdown: '',
    cohorts: [
      {
        title: 'Idempotencia del webhook',
        layers: [
          {
            title: 'Lock alrededor de la transición a pagada',
            markdown:
              'La secuencia leer-chequear-escribir ahora corre dentro de `acquireOrderLock(orderId)` con liberación en `finally`. Preguntá si el lock es por proceso o distribuido: con varias instancias un lock en memoria no cierra la carrera.',
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
            title: 'Test de regresión de concurrencia',
            markdown:
              'Dispara el mismo webhook dos veces con `Promise.all` y asegura que `markPaid` corre una sola vez. Como la CI está inestable, verificá que el test falle sin el lock.',
            files: [{ path: 'src/webhooks/payment-webhook-handler.test.ts', ranges: [{ start: 41, end: 44 }] }],
          },
        ],
      },
    ],
  },
  {
    kind: 'setup',
    markdown:
      '## Cómo probar este PR\n\n' +
      'El diff no muestra `Dockerfile` ni `docker-compose.yml`, así que no hay evidencia de un flujo ' +
      'Docker en esta demo.\n\n' +
      '**En local:** `handlePaymentWebhook` es una función Node.js invocada por el gateway de ' +
      'webhooks de pago:\n\n' +
      '1. `npm install`\n' +
      '2. `npm run dev` (invoca el handler contra un evento de prueba simulado)\n\n' +
      '**Variables de entorno necesarias:** `DATABASE_URL` (Postgres, vía `OrderRepository`) y las ' +
      'credenciales del lock distribuido (ver sección de infra más abajo).\n\n' +
      '**Variables de entorno NUEVAS de este PR:** este PR no agrega variables de entorno propias ' +
      '— el lock que introduce reutiliza la conexión existente a la base de datos.',
    snippets: [
      {
        label: 'arranque-local',
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
      '## Cómo funciona el sistema desplegado\n\n' +
      '`payment-webhook-handler` no es un servidor persistente: es una función Lambda detrás de un ' +
      'API Gateway que el proveedor de pago invoca por cada evento (pago confirmado, reembolso, ' +
      'etc.). La Lambda lee y actualiza la orden en DynamoDB y, si el pago se confirma, encola un ' +
      'evento en SQS para que otra Lambda (`order-notifier`) le mande el email de confirmación al ' +
      'cliente por SES. Al ser serverless, el proveedor de pago puede disparar varias invocaciones ' +
      'concurrentes de la MISMA Lambda para el mismo `orderId` (reintentos de webhook, picos de ' +
      'tráfico) — no hay una única instancia de proceso que las sirva a todas.\n\n' +
      '## Dónde incide este PR\n\n' +
      'El lock que agrega este PR vive en `payment-webhook-handler` y debe coordinar esas ' +
      'invocaciones concurrentes entre sí. Si `acquireOrderLock` fuera un lock en memoria (la duda ' +
      'de @mgarcia en los comentarios), cada invocación de la Lambda vería su propio estado y el fix ' +
      'no serviría de nada en producción: el lock necesita vivir afuera de la función, en un sitio ' +
      'compartido por todas las invocaciones — por ejemplo una escritura condicional contra la ' +
      'tabla `Orders` de DynamoDB (que ya está en el camino) o una tabla de locks aparte.',
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
