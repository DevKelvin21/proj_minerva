/**
 * HTML diagrams of the mock analyses (`./fixtures.ts`, `./fixtures.es.ts`),
 * written with the diagram kit (`shared/diagram-kit.ts`) the same way the
 * prompt asks a real model to. One builder per diagram, fed the few words
 * that change with the language; code names stay as they are.
 *
 * Quoted strings only, never backtick delimiters (gotcha 3).
 */
import type { AppLocale } from '../../shared/locale'
import type { DidacticDiagram } from '../../shared/types'

interface DiagramWords {
  newTag: string
  changedTag: string
  removedTag: string
  customer: string
  shopsOnShopwave: string
  exposesRest: string
  validatesCoupons: string
  database: string
  delegatesValidation: string
  readsWrites: string
  status200or409: string
  has: string
  computed: string
  missingInDiff: string
  otherEvent: string
  checkoutModule: string
  before: string
  after: string
  orchestratesFlow: string
  usesReducer: string
  validates: string
  pureFunctions: string
  mutableClass: string
  paymentProvider: string
  webhookGateway: string
  webhookHandler: string
  ordersTable: string
  notifyQueue: string
  orderNotifier: string
  email: string
  touchedByPr: string
  lockQuestion: string
  conditionalWrite: string
  enqueue: string
}

const WORDS: Record<AppLocale, DiagramWords> = {
  en: {
    newTag: 'NEW',
    changedTag: 'CHANGED',
    removedTag: 'REMOVED',
    customer: 'Customer',
    shopsOnShopwave: 'Shops on Shopwave',
    exposesRest: 'Node.js · REST for customers',
    validatesCoupons: 'Validates and applies coupons',
    database: 'Database',
    delegatesValidation: 'delegates validation',
    readsWrites: 'reads and writes',
    status200or409: '200 or 409',
    has: 'has',
    computed: 'computed',
    missingInDiff: 'missing in diff',
    otherEvent: 'other event',
    checkoutModule: 'Checkout module',
    before: 'Before',
    after: 'After',
    orchestratesFlow: 'Orchestrates the purchase flow',
    usesReducer: 'useReducer',
    validates: 'validateCheckout',
    pureFunctions: 'Pure functions',
    mutableClass: 'Class with mutable state',
    paymentProvider: 'Payment provider',
    webhookGateway: 'Webhook gateway',
    webhookHandler: 'Webhook handler',
    ordersTable: 'Orders table',
    notifyQueue: 'Notify queue',
    orderNotifier: 'Order notifier',
    email: 'Email',
    touchedByPr: 'Touched by this PR',
    lockQuestion: 'The lock must be shared by every concurrent invocation',
    conditionalWrite: 'conditional write',
    enqueue: 'enqueue',
  },
  es: {
    newTag: 'NUEVO',
    changedTag: 'CAMBIA',
    removedTag: 'ELIMINADO',
    customer: 'Cliente',
    shopsOnShopwave: 'Compra en Shopwave',
    exposesRest: 'Node.js · REST para clientes',
    validatesCoupons: 'Valida y aplica cupones',
    database: 'Base de datos',
    delegatesValidation: 'delega la validación',
    readsWrites: 'lee y escribe',
    status200or409: '200 o 409',
    has: 'tiene',
    computed: 'calculado',
    missingInDiff: 'falta en el diff',
    otherEvent: 'otro evento',
    checkoutModule: 'Módulo de checkout',
    before: 'Antes',
    after: 'Después',
    orchestratesFlow: 'Orquesta el flujo de compra',
    usesReducer: 'useReducer',
    validates: 'validateCheckout',
    pureFunctions: 'Funciones puras',
    mutableClass: 'Clase con estado mutable',
    paymentProvider: 'Proveedor de pagos',
    webhookGateway: 'Gateway del webhook',
    webhookHandler: 'Handler del webhook',
    ordersTable: 'Tabla de órdenes',
    notifyQueue: 'Cola de avisos',
    orderNotifier: 'Notificador de órdenes',
    email: 'Email',
    touchedByPr: 'Lo toca este PR',
    lockQuestion: 'El lock debe ser compartido por todas las invocaciones concurrentes',
    conditionalWrite: 'escritura condicional',
    enqueue: 'encola',
  },
}

function html(source: string): DidacticDiagram {
  return { format: 'html', source }
}

function node(name: string, meta: string, state = ''): string {
  return (
    '<div class="node' +
    (state ? ' ' + state : '') +
    '"><span class="name">' +
    name +
    '</span><span class="meta">' +
    meta +
    '</span></div>'
  )
}

function edge(label: string, extra = ''): string {
  return '<div class="edge' + (extra ? ' ' + extra : '') + '">' + label + '</div>'
}

function legend(w: DiagramWords, states: Array<'new' | 'changed' | 'removed'>): string {
  const label = { new: w.newTag, changed: w.changedTag, removed: w.removedTag }
  return (
    '<div class="legend">' +
    states.map((s) => '<span class="tag ' + s + '">' + label[s] + '</span>').join('') +
    '</div>'
  )
}

/** Every mock diagram, in the analysis language. */
export function fixtureDiagrams(locale: AppLocale): {
  pr482Route: DidacticDiagram
  pr482Architecture: DidacticDiagram
  pr479Schema: DidacticDiagram
  pr201Reducer: DidacticDiagram
  pr201Architecture: DidacticDiagram
  pr77Lock: DidacticDiagram
  pr77CloudBigPicture: DidacticDiagram
  pr77CloudZoom: DidacticDiagram
} {
  const w = WORDS[locale]
  return {
    pr482Route: html(
      '<ol class="steps">\n' +
        '  <li><span class="actor">Client</span> → <span class="actor">carts router</span> <span class="msg">POST /carts/:id/apply-coupon</span></li>\n' +
        '  <li class="new"><span class="actor">carts router</span> → <span class="actor">CouponService</span> <span class="msg">apply(cart, code)</span></li>\n' +
        '  <li class="new"><span class="actor">CouponService</span> → <span class="actor">carts router</span> <span class="msg">{ ok, total, reason? }</span></li>\n' +
        '  <li><span class="actor">carts router</span> → <span class="actor">Client</span> <span class="msg">' +
        w.status200or409 +
        '</span></li>\n' +
        '</ol>\n',
    ),

    pr482Architecture: html(
      '<div class="diagram">\n' +
        '  <div class="row">\n' +
        '    ' + node(w.customer, w.shopsOnShopwave, 'external') + '\n' +
        '    ' + edge('POST apply-coupon') + '\n' +
        '    <div class="group">\n' +
        '      <span class="label">Shopwave</span>\n' +
        '      <div class="row">\n' +
        '        ' + node('API', w.exposesRest) + '\n' +
        '        ' + edge(w.delegatesValidation, 'new') + '\n' +
        '        ' + node('CouponService <span class="tag new">' + w.newTag + '</span>', w.validatesCoupons, 'new') + '\n' +
        '        ' + edge(w.readsWrites, 'new') + '\n' +
        '        ' + node(w.database, 'PostgreSQL') + '\n' +
        '      </div>\n' +
        '    </div>\n' +
        '  </div>\n' +
        '  ' + legend(w, ['new']) + '\n' +
        '</div>\n',
    ),

    pr479Schema: html(
      '<div class="diagram">\n' +
        '  <div class="entities">\n' +
        '    <table class="entity">\n' +
        '      <caption>orders</caption>\n' +
        '      <tr><td>id<span class="pk">PK</span></td><td>uuid</td></tr>\n' +
        '      <tr><td>status</td><td>text</td></tr>\n' +
        '      <tr><td>total</td><td>integer</td></tr>\n' +
        '      <tr class="new"><td>refundedAmount</td><td>' + w.computed + '</td></tr>\n' +
        '    </table>\n' +
        '    <span class="rel">1 ── ' + w.has + ' ──&lt; N</span>\n' +
        '    <table class="entity new">\n' +
        '      <caption>refunds <span class="tag new">' + w.newTag + '</span></caption>\n' +
        '      <tr class="new"><td>id<span class="pk">PK</span></td><td>uuid</td></tr>\n' +
        '      <tr class="new"><td>order_id<span class="fk">FK</span></td><td>uuid</td></tr>\n' +
        '      <tr class="new"><td>order_line_id<span class="fk">FK</span></td><td>uuid</td></tr>\n' +
        '      <tr class="new"><td>amount_cents</td><td>integer</td></tr>\n' +
        '      <tr class="new"><td>reason</td><td>text</td></tr>\n' +
        '      <tr class="new"><td>created_at</td><td>timestamptz</td></tr>\n' +
        '    </table>\n' +
        '  </div>\n' +
        '  ' + legend(w, ['new']) + '\n' +
        '</div>\n',
    ),

    pr201Reducer: html(
      '<div class="diagram">\n' +
        '  <div class="row">\n' +
        '    <div class="node"><span class="name">cart</span></div>\n' +
        '    ' + edge('CONTINUE') + '\n' +
        '    <div class="node"><span class="name">shipping</span></div>\n' +
        '    ' + edge('CONTINUE') + '\n' +
        '    <div class="node"><span class="name">payment</span></div>\n' +
        '    ' + edge(w.missingInDiff, 'removed') + '\n' +
        '    <div class="node removed"><span class="name">confirmation</span></div>\n' +
        '  </div>\n' +
        '  <p class="note">shipping → cart: ' + w.otherEvent + '</p>\n' +
        '</div>\n',
    ),

    pr201Architecture: html(
      '<div class="diagram">\n' +
        '  <div class="group">\n' +
        '    <span class="label">' + w.checkoutModule + '</span>\n' +
        '    <div class="grid">\n' +
        '      <div class="col">\n' +
        '        <span class="tag">' + w.before + '</span>\n' +
        '        ' + node('CheckoutPage', w.orchestratesFlow) + '\n' +
        '        ' + edge('new CheckoutMachine()', 'down removed') + '\n' +
        '        ' + node('CheckoutMachine', w.mutableClass, 'removed') + '\n' +
        '      </div>\n' +
        '      <div class="col">\n' +
        '        <span class="tag">' + w.after + '</span>\n' +
        '        ' + node('CheckoutPage', w.orchestratesFlow, 'changed') + '\n' +
        '        ' + edge(w.usesReducer, 'down new') + '\n' +
        '        ' + node('checkoutReducer', w.pureFunctions, 'new') + '\n' +
        '        ' + edge(w.validates, 'down') + '\n' +
        '        ' + node('checkout-validation', w.pureFunctions, 'changed') + '\n' +
        '      </div>\n' +
        '    </div>\n' +
        '  </div>\n' +
        '  ' + legend(w, ['new', 'changed', 'removed']) + '\n' +
        '</div>\n',
    ),

    pr77Lock: html(
      '<ol class="steps">\n' +
        '  <li class="new"><span class="actor">Webhook</span> → <span class="actor">OrderLock</span> <span class="msg">acquire(orderId)</span></li>\n' +
        '  <li><span class="actor">Webhook</span> → <span class="actor">OrderRepository</span> <span class="msg">findById</span></li>\n' +
        '  <li><span class="actor">Webhook</span> → <span class="actor">OrderRepository</span> <span class="msg">markPaid</span></li>\n' +
        '  <li class="new"><span class="actor">Webhook</span> → <span class="actor">OrderLock</span> <span class="msg">release (finally)</span></li>\n' +
        '</ol>\n',
    ),

    pr77CloudBigPicture: html(
      '<div class="diagram">\n' +
        '  <div class="row">\n' +
        '    ' + node(w.paymentProvider, 'Internet', 'external') + '\n' +
        '    ' + edge('HTTPS') + '\n' +
        '    <div class="group">\n' +
        '      <span class="label">AWS</span>\n' +
        '      <div class="row">\n' +
        '        ' + node(w.webhookGateway, 'API Gateway') + '\n' +
        '        ' + edge('') + '\n' +
        '        ' + node(w.webhookHandler, 'Lambda', 'focus') + '\n' +
        '        ' + edge(w.readsWrites) + '\n' +
        '        ' + node(w.ordersTable, 'DynamoDB') + '\n' +
        '      </div>\n' +
        '      ' + edge(w.enqueue, 'down') + '\n' +
        '      <div class="row">\n' +
        '        ' + node(w.notifyQueue, 'SQS') + '\n' +
        '        ' + edge('') + '\n' +
        '        ' + node(w.orderNotifier, 'Lambda') + '\n' +
        '        ' + edge('') + '\n' +
        '        ' + node(w.email, 'SES') + '\n' +
        '      </div>\n' +
        '    </div>\n' +
        '  </div>\n' +
        '</div>\n',
    ),

    pr77CloudZoom: html(
      '<div class="diagram">\n' +
        '  <div class="row">\n' +
        '    ' + node(w.webhookHandler, 'Lambda · acquireOrderLock', 'changed') + '\n' +
        '    ' + edge(w.conditionalWrite, 'changed') + '\n' +
        '    ' + node(w.ordersTable, 'DynamoDB', 'changed') + '\n' +
        '  </div>\n' +
        '  <div class="row">\n' +
        '    ' + node(w.webhookHandler, 'Lambda', 'changed') + '\n' +
        '    ' + edge(w.enqueue) + '\n' +
        '    ' + node(w.notifyQueue, 'SQS') + '\n' +
        '  </div>\n' +
        '  <p class="note">' + w.lockQuestion + '</p>\n' +
        '  <div class="legend"><span class="tag changed">' + w.touchedByPr + '</span></div>\n' +
        '</div>\n',
    ),
  }
}
