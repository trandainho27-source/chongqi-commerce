import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
export const categories = sqliteTable('categories', { id: text('id').primaryKey(), name: text('name').notNull(), icon: text('icon').notNull().default('box'), sort: integer('sort').notNull().default(0), active: integer('active').notNull().default(1) });
export const products = sqliteTable('products', { iconKey: text('icon_key').notNull().default(''), countryCode: text('country_code').notNull().default(''), id: text('id').primaryKey(), categoryId: text('category_id').notNull().references(() => categories.id), name: text('name').notNull(), subtitle: text('subtitle').notNull().default(''), description: text('description').notNull().default(''), instructions: text('instructions').notNull().default(''), price: integer('price').notNull(), comparePrice: integer('compare_price').notNull().default(0), minQty: integer('min_qty').notNull().default(1), maxQty: integer('max_qty').notNull().default(100), featured: integer('featured').notNull().default(0), active: integer('active').notNull().default(1), region: text('region').notNull().default('全球'), tag: text('tag').notNull().default(''), isExample: integer('is_example').notNull().default(0), createdAt: integer('created_at').notNull() });
export const orders = sqliteTable('orders', { id: text('id').primaryKey(), lookupHash: text('lookup_hash').notNull(), contact: text('contact').notNull(), total: integer('total').notNull(), status: text('status').notNull().default('pending'), ready: integer('ready').notNull().default(0), demo: integer('demo').notNull().default(0), paymentRef: text('payment_ref'), paymentProvider: text('payment_provider'), createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(), paidAt: integer('paid_at'), fulfilledAt: integer('fulfilled_at') }, t => [uniqueIndex('orders_payment_reference').on(t.paymentProvider, t.paymentRef), index('orders_created').on(t.createdAt), index('orders_expiry').on(t.status, t.expiresAt)]);
export const orderItems = sqliteTable('order_items', { id: text('id').primaryKey(), orderId: text('order_id').notNull().references(() => orders.id), productId: text('product_id').notNull().references(() => products.id), productName: text('product_name').notNull(), price: integer('price').notNull(), quantity: integer('quantity').notNull() }, t => [uniqueIndex('order_product').on(t.orderId, t.productId)]);
export const inventory = sqliteTable('inventory', { id: text('id').primaryKey(), productId: text('product_id').notNull().references(() => products.id), ciphertext: text('ciphertext').notNull(), fingerprint: text('fingerprint').notNull().unique(), status: text('status').notNull().default('available'), orderId: text('order_id').references(() => orders.id), createdAt: integer('created_at').notNull() }, t => [index('inventory_stock').on(t.productId, t.status)]);
export const staff = sqliteTable('staff', { id: text('id').primaryKey(), username: text('username').notNull().unique(), passwordHash: text('password_hash').notNull(), role: text('role').notNull().default('operator'), active: integer('active').notNull().default(1), createdAt: integer('created_at').notNull() });
export const sessions = sqliteTable('sessions', { hash: text('hash').primaryKey(), staffId: text('staff_id').notNull().references(() => staff.id), csrf: text('csrf').notNull(), expiresAt: integer('expires_at').notNull() });
export const tickets = sqliteTable('tickets', { id: text('id').primaryKey(), orderId: text('order_id').notNull().references(() => orders.id), subject: text('subject').notNull(), message: text('message').notNull(), status: text('status').notNull().default('open'), reply: text('reply').notNull().default(''), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull() }, t => [index('tickets_order').on(t.orderId, t.createdAt)]);
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const audits = sqliteTable('audits', { id: text('id').primaryKey(), actor: text('actor').notNull(), action: text('action').notNull(), target: text('target').notNull(), detail: text('detail').notNull().default(''), createdAt: integer('created_at').notNull() });
export const rateLimits = sqliteTable('rate_limits', { key: text('key').primaryKey(), count: integer('count').notNull(), resetAt: integer('reset_at').notNull() });

export const transactionGuards = sqliteTable('transaction_guards', { id: text('id').primaryKey(), passed: integer('passed').notNull() }, t => [check('transaction_must_pass', sql`${t.passed} = 1`)]);

export const paymentInvoices = sqliteTable('payment_invoices', {
    id: text('id').primaryKey(), orderId: text('order_id').notNull().unique().references(() => orders.id),
    address: text('address').notNull(), addressHex: text('address_hex').notNull(), amountUnits: integer('amount_units').notNull(),
    baseUnits: integer('base_units').notNull(), rate: text('rate').notNull(), status: text('status').notNull().default('waiting'),
    createdAt: integer('created_at').notNull(), payBefore: integer('pay_before').notNull(), watchUntil: integer('watch_until').notNull(),
    txId: text('tx_id'), eventId: text('event_id').unique(), confirmedAt: integer('confirmed_at'), reviewReason: text('review_reason').notNull().default(''),
}, t => [uniqueIndex('payment_amount_never_reused').on(t.address, t.amountUnits), index('payment_invoice_status').on(t.status, t.createdAt)]);
export const paymentReceipts = sqliteTable('payment_receipts', {
    eventId: text('event_id').primaryKey(), txId: text('tx_id').notNull(), address: text('address').notNull(), fromHex: text('from_hex').notNull(),
    amountUnits: text('amount_units').notNull(), block: integer('block').notNull(), blockTimestamp: integer('block_timestamp').notNull(),
    invoiceId: text('invoice_id').references(() => paymentInvoices.id), status: text('status').notNull(), reason: text('reason').notNull().default(''),
    createdAt: integer('created_at').notNull(),
}, t => [index('payment_receipts_created').on(t.createdAt)]);
export const paymentWatchers = sqliteTable('payment_watchers', {
    address: text('address').primaryKey(), addressHex: text('address_hex').notNull(), scanFrom: integer('scan_from').notNull(),
    windowEnd: integer('window_end'), fingerprint: text('fingerprint').notNull().default(''), leaseUntil: integer('lease_until').notNull().default(0),
    leaseToken: text('lease_token').notNull().default(''), lastSuccessAt: integer('last_success_at'), lastError: text('last_error').notNull().default(''),
});
export const paymentTransactions = sqliteTable('payment_transactions', {
    id: text('id').primaryKey(), txId: text('tx_id').notNull(), address: text('address').notNull(), processedAt: integer('processed_at').notNull(),
}, t => [uniqueIndex('payment_transaction_address').on(t.txId, t.address)]);

export const supplierGoods = sqliteTable('supplier_goods', {
    productId: text('product_id').primaryKey().references(() => products.id),
    goodsId: integer('goods_id').unique(), sourceUrl: text('source_url').notNull(),
    referencePrice: integer('reference_price').notNull(), upstreamStock: integer('upstream_stock').notNull().default(0),
    deliveryType: text('delivery_type').notNull().default('unknown'),
    blockedReason: text('blocked_reason').notNull().default(''),
    syncedAt: integer('synced_at'), origin: text('origin').notNull().default('public'),
});
export const supplierPurchases = sqliteTable('supplier_purchases', {
    id: text('id').primaryKey(), productId: text('product_id').notNull().references(() => products.id),
    goodsId: integer('goods_id').notNull(), quantity: integer('quantity').notNull(),
    quotedTotal: integer('quoted_total').notNull(), actualTotal: integer('actual_total'),
    status: text('status').notNull().default('quoted'), orderSn: text('order_sn').unique(),
    requestLogId: text('request_log_id').notNull().default(''),
    encryptedResponse: text('encrypted_response'), error: text('error').notNull().default(''),
    attempts: integer('attempts').notNull().default(0), leaseUntil: integer('lease_until').notNull().default(0),
    actor: text('actor').notNull(), createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const supplierCards = sqliteTable('supplier_cards', {
    id: text('id').primaryKey(), purchaseId: text('purchase_id').notNull().references(() => supplierPurchases.id),
    inventoryId: text('inventory_id').notNull().unique().references(() => inventory.id),
});
