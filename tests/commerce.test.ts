import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi, reservationGuard } from '../lib/commerce/api.ts';
import { encrypt, decrypt, hmac } from '../lib/commerce/security.ts';
import { addressHex, quoteUnits, unitsText, USDT_CONTRACT, USDT_CONTRACT_HEX, TRANSFER_TOPIC } from '../lib/commerce/tron.ts';
import { runPaymentReconciliation } from '../lib/commerce/api.ts';
class Query {
    constructor(public database: DatabaseSync, public sql: string, public values: any[] = []) {
    }
    bind(...values: any[]) {
        return new Query(this.database, this.sql, values);
    }
    async first() {
        return this.database.prepare(this.sql).get(...this.values) || null;
    }
    async all() {
        return { results: this.database.prepare(this.sql).all(...this.values) };
    }
    async run() {
        const r = this.database.prepare(this.sql).run(...this.values);
        return { success: true, meta: { changes: Number(r.changes) } };
    }
    execute() {
        const statement = this.database.prepare(this.sql);
        if (statement.columns().length) {
            const results = statement.all(...this.values);
            return { results, meta: { changes: Number(this.database.prepare('SELECT changes() AS n').get()!.n) } };
        }
        const result = statement.run(...this.values);
        return { results: [], meta: { changes: Number(result.changes) } };
    }
}
class DB {
    raw = new DatabaseSync(':memory:');
    constructor() {
        this.raw.exec('PRAGMA foreign_keys=ON');
        for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort())
            this.raw.exec(readFileSync('drizzle/' + file, 'utf8'));
    }
    prepare(sql: string) {
        return new Query(this.raw, sql);
    }
    async batch(queries: Query[]) {
        this.raw.exec('BEGIN');
        try {
            const results = queries.map(q => q.execute());
            this.raw.exec('COMMIT');
            return results;
        }
        catch (e) {
            this.raw.exec('ROLLBACK');
            throw e;
        }
    }
}
async function setup(demo = true) {
    const db = new DB(), env: any = { DB: db, DEMO_MODE: demo ? 'true' : 'false', INVENTORY_KEY: 'a'.repeat(64), BOOTSTRAP_TOKEN: 'test-setup-token' };
    let cookie = '', csrf = '';
    async function req(path: string, b?: any, extra: Record<string, string> = {}) {
        const method = b === undefined ? 'GET' : 'POST';
        const r = await handleApi(new Request('https://store.test/api/' + path, { method, headers: { origin: 'https://store.test', ...(b === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie, 'x-csrf-token': csrf } : {}), ...extra }, ...(b === undefined ? {} : { body: JSON.stringify(b) }) }), env);
        const d = await r.json() as any;
        if (r.headers.get('set-cookie'))
            cookie = r.headers.get('set-cookie')!.split(';')[0];
        if (d.csrf)
            csrf = d.csrf;
        return { r, d };
    }
    return { db, env, req };
}
const orderBody = (id: string, q = 1) => ({ contact: 'buyer@example.test', acceptedTerms: true, items: [{ id, quantity: q }], total: 1, price: 1 });
test('production setup is protected, one-time, and administrator sessions are secured', async () => {
    const { req } = await setup(false);
    assert.equal((await req('auth/setup', { username: 'owner', password: 'long-password-123', token: 'wrong' })).r.status, 403);
    const r = await req('auth/setup', { username: 'owner', password: 'long-password-123', token: 'test-setup-token' });
    assert.equal(r.r.status, 200);
    assert.match(r.r.headers.get('set-cookie')!, /HttpOnly; Secure; SameSite=Strict/);
    assert.equal((await req('auth/me')).d.role, 'owner');
    assert.equal((await req('auth/setup', { username: 'other', password: 'long-password-123', token: 'test-setup-token' })).r.status, 409);
    assert.equal((await req('auth/demo', {})).r.status, 403);
});
test('orders use server prices, reserve unique stock, and cancellation releases it', async () => {
    const { req, db } = await setup();
    const { d: catalog } = await req('catalog');
    const p = catalog.products[0];
    const a = await req('orders', orderBody(p.id));
    assert.equal(a.r.status, 201);
    assert.equal(a.d.total, p.price);
    const b = await req('orders', orderBody(p.id));
    assert.equal(b.r.status, 409);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM orders').get()!.n, 1);
    assert.equal((await req('orders/lookup', { id: a.d.id, secret: 'incorrect' })).r.status, 404);
    assert.equal((await req('orders/cancel', { id: a.d.id, secret: a.d.secret })).r.status, 200);
    assert.equal((await req('orders', orderBody(p.id))).r.status, 201);
});
test('competing reservations fail atomically even after both requests read available stock', async () => {
    const { req, db } = await setup();
    const { d: catalog } = await req('catalog');
    const p = catalog.products[0];
    const create = (id: string) => [db.prepare("INSERT INTO orders(id,lookup_hash,contact,total,status,ready,demo,created_at,expires_at) VALUES(?,'hash','contact',?,'pending',0,1,1,9999999999999)").bind(id, p.price), db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,1)').bind(id + '-line', id, p.id, p.name, p.price), db.prepare("UPDATE inventory SET status='reserved',order_id=? WHERE id IN(SELECT id FROM inventory WHERE product_id=? AND status='available' LIMIT 1)").bind(id, p.id), ...reservationGuard(db as any, id) as unknown as Query[], db.prepare('UPDATE orders SET ready=1 WHERE id=?').bind(id)];
    await db.batch(create('FIRST'));
    await assert.rejects(db.batch(create('SECOND')), /CHECK constraint/);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM orders WHERE id='SECOND'").get()!.n, 0);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM inventory WHERE order_id='FIRST'").get()!.n, 1);
});
test('encrypted inventory, deduplication, fulfillment and idempotency work', async () => {
    const { req, db } = await setup();
    await req('auth/demo', {});
    const p = (await req('admin/products')).d.products[0];
    const imported = await req('admin/inventory', { product_id: p.id, codes: 'SECRET-ONE\nSECRET-ONE\nSECRET-TWO' });
    assert.equal(imported.d.imported, 2);
    assert.equal(imported.d.skipped, 1);
    const stored = db.raw.prepare('SELECT ciphertext FROM inventory WHERE product_id=?').all(p.id);
    assert.ok(stored.every(r => !String(r.ciphertext).includes('SECRET')));
    const order = await req('orders', orderBody(p.id, 2));
    assert.equal(order.r.status, 201);
    const confirm = { id: order.d.id, reference: 'payment-001', reason: '已核对真实到账记录' };
    assert.equal((await req('admin/orders', confirm)).r.status, 200);
    assert.equal((await req('admin/orders', confirm)).d.idempotent, true);
    assert.equal((await req('admin/orders', { ...confirm, reference: 'different' })).r.status, 409);
    const delivery = await req('orders/lookup', { id: order.d.id, secret: order.d.secret });
    assert.equal(delivery.d.status, 'fulfilled');
    assert.equal(delivery.d.delivery.length, 2);
    assert.equal((await req('payments/create', { id: order.d.id, secret: order.d.secret })).r.status, 503);
});
test('expired orders release stock and cannot be paid or fulfilled', async () => {
    const { req, db } = await setup();
    await req('auth/demo', {});
    const p = (await req('catalog')).d.products[0];
    const order = await req('orders', orderBody(p.id));
    db.raw.prepare('UPDATE orders SET expires_at=0 WHERE id=?').run(order.d.id);
    const result = await req('orders/lookup', { id: order.d.id, secret: order.d.secret });
    assert.equal(result.d.status, 'expired');
    assert.equal((await req('catalog')).d.products.find((x: any) => x.id === p.id).stock, 1);
    assert.equal((await req('admin/orders', { id: order.d.id, reference: 'expired-payment', reason: '已核对付款记录' })).r.status, 409);
});
test('authorization, CSRF and origin checks reject unauthorized writes', async () => {
    const { req } = await setup();
    assert.equal((await req('admin/settings')).r.status, 401);
    await req('auth/demo', {});
    assert.equal((await req('admin/settings', { brand: 'evil' }, { 'x-csrf-token': 'wrong' })).r.status, 403);
    assert.equal((await req('admin/settings', { brand: 'evil' }, { origin: 'https://attacker.test' })).r.status, 403);
    await req('admin/staff', { username: 'support1', password: 'secure-password-123', role: 'support' });
    await req('auth/logout', {});
    await req('auth/login', { username: 'support1', password: 'secure-password-123' });
    assert.equal((await req('admin/products')).r.status, 403);
    assert.equal((await req('admin/orders', { id: 'x', reference: 'x', reason: 'test reason' })).r.status, 403);
    assert.equal((await req('admin/orders')).r.status, 200);
});
test('refund records preserve delivered inventory and are audited', async () => {
    const { req, db } = await setup();
    await req('auth/demo', {});
    const p = (await req('catalog')).d.products[0];
    const o = (await req('orders', orderBody(p.id))).d;
    await req('admin/orders', { id: o.id, reference: 'pay', reason: '确认真实到账记录' });
    assert.equal((await req('admin/orders', { id: o.id, reference: 'refund', reason: '已在支付平台退款', action: 'refund' })).r.status, 200);
    assert.equal((await req('orders/lookup', { id: o.id, secret: o.secret })).d.status, 'refunded');
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM inventory WHERE order_id=? AND status='delivered'").get(o.id)!.n, 1);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM audits WHERE action='order.refund'").get()!.n, 1);
});
test('tickets verify order ownership and persist support replies', async () => {
    const { req } = await setup();
    const p = (await req('catalog')).d.products[0];
    const o = (await req('orders', orderBody(p.id))).d;
    assert.equal((await req('tickets', { orderId: o.id, secret: 'wrong', subject: 'question', message: 'Need some help' })).r.status, 404);
    const t = await req('tickets', { orderId: o.id, secret: o.secret, subject: '使用问题', message: '请帮助我了解使用方法' });
    assert.equal(t.r.status, 201);
    await req('auth/demo', {});
    await req('admin/tickets', { id: t.d.id, reply: '已协助处理', closed: true });
    const result = await req('orders/lookup', { id: o.id, secret: o.secret });
    assert.equal(result.d.tickets[0].reply, '已协助处理');
    assert.equal(result.d.tickets[0].status, 'closed');
});
test('HMAC callbacks validate timestamp, currency, amount and transaction uniqueness', async () => {
    const { req, env } = await setup();
    await req('auth/demo', {});
    env.PAYMENT_PROVIDER = 'custom-hmac';
    env.PAYMENT_WEBHOOK_SECRET = 'test-payment-secret';
    const p = (await req('catalog')).d.products[0];
    await req('admin/inventory', { product_id: p.id, codes: 'SECOND-CODE' });
    const o = (await req('orders', orderBody(p.id))).d;
    const send = async (b: any, timestamp = String(Math.floor(Date.now() / 1000))) => req('payments/webhook', b, { 'x-payment-timestamp': timestamp, 'x-payment-signature': await hmac(timestamp + '.' + JSON.stringify(b), env.PAYMENT_WEBHOOK_SECRET) });
    const payload = { orderId: o.id, status: 'paid', currency: 'CNY', amount: o.total, transactionId: 'tx-unique' };
    assert.equal((await send(payload, '1000000000')).r.status, 401);
    assert.equal((await send({ ...payload, amount: 1 })).r.status, 400);
    assert.equal((await send(payload)).r.status, 200);
    assert.equal((await send(payload)).d.idempotent, true);
    const second = (await req('orders', orderBody(p.id))).d;
    assert.equal((await send({ ...payload, orderId: second.id })).r.status, 409);
    assert.equal((await req('orders/lookup', { id: second.id, secret: second.secret })).d.status, 'pending');
});
test('AES encryption authenticates each product context', async () => {
    const key = 'a'.repeat(64);
    const cipher = await encrypt('secret-code', key, 'sku-a');
    assert.equal(await decrypt(cipher, key, 'sku-a'), 'secret-code');
    await assert.rejects(decrypt(cipher, key, 'sku-b'));
});

const receiver = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL'; // Public TRON documentation example, test fixtures only.
const receiverHex = '8840e6c55b9ada326d211d818c34a994aeced808';
async function paymentSetup() {
    const s = await setup();
    await s.req('auth/demo', {});
    s.db.raw.prepare('UPDATE products SET is_example=0').run();
    Object.assign(s.env, { DEMO_MODE: 'false', PAYMENT_PROVIDER: 'trc20', TRON_RECEIVING_ADDRESS: receiver, TRONGRID_API_KEY: 'test-only-query-key', USDT_CNY_RATE: '7' });
    const p = (await s.req('catalog')).d.products[0];
    await s.req('admin/inventory', { product_id: p.id, codes: 'TRC20-STOCK-2\nTRC20-STOCK-3\nTRC20-STOCK-4' });
    const order = (await s.req('orders', orderBody(p.id))).d;
    const result = await s.req('payments/create', order);
    assert.equal(result.r.status, 200, JSON.stringify(result.d));
    return { ...s, p, order, invoice: result.d };
}
function transferLog(amount: string, overrides: any = {}) {
    return { address: USDT_CONTRACT_HEX, topics: [TRANSFER_TOPIC, '0'.repeat(24) + '1'.repeat(40), '0'.repeat(24) + receiverHex], data: BigInt(amount).toString(16).padStart(64, '0'), ...overrides };
}
function rpcMock(t: any, invoice: any, options: any = {}) {
    const amount = options.amount ?? String(Math.round(Number(invoice.amount) * 1000000));
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string, init: any) => {
        const url = new URL(input); calls.push(url.pathname);
        assert.equal(url.origin, 'https://api.trongrid.io');
        assert.equal(init.headers['TRON-PRO-API-KEY'], 'test-only-query-key');
        if (options.networkError) throw new Error('secret upstream body must never leak');
        const txId = init.body ? JSON.parse(init.body).value : '';
        if (url.pathname === '/walletsolidity/gettransactionbyid') return Response.json(options.unconfirmed ? {} : { txID: txId, ret: [{ contractRet: options.failed ? 'REVERT' : 'SUCCESS' }] });
        if (url.pathname === '/walletsolidity/gettransactioninfobyid') return Response.json({ id: txId, blockNumber: 100, blockTimeStamp: options.timestamp ?? invoice.created_at + 1, receipt: { result: options.receiptFailed ? 'OUT_OF_ENERGY' : 'SUCCESS' }, log: options.logs || [transferLog(amount, options.log || {})] });
        if (url.pathname.includes('/transactions/trc20')) {
            assert.equal(url.searchParams.get('only_confirmed'), 'true');
            assert.equal(url.searchParams.get('contract_address'), USDT_CONTRACT);
            return Response.json(options.list ? options.list(url) : { success: true, data: [], meta: {} });
        }
        throw new Error('Unexpected network request: ' + input);
    });
    return calls;
}
test('TRON addresses require Base58Check and USDT quotes use exact integer arithmetic', async () => {
    assert.equal(await addressHex(receiver), receiverHex);
    assert.equal(await addressHex(USDT_CONTRACT), USDT_CONTRACT_HEX);
    assert.equal(await addressHex(receiver.slice(0, -1) + 'M'), null);
    assert.equal(await addressHex('0x' + receiverHex), null);
    assert.equal(quoteUnits(100, '7'), 142858);
    assert.equal(quoteUnits(700, '7.000000'), 1000000);
    assert.equal(unitsText(142858), '0.142858');
    assert.throws(() => quoteUnits(100, '0'));
    assert.throws(() => quoteUnits(100, '1e3'));
});
test('payment setup fails closed in demo, on invalid configuration, and for wrong order credentials', async () => {
    const s = await setup();
    const p = (await s.req('catalog')).d.products[0];
    const o = (await s.req('orders', orderBody(p.id))).d;
    assert.equal((await s.req('payments/create', o)).r.status, 503);
    assert.equal((await s.req('payments/create', { ...o, secret: 'wrong' })).r.status, 404);
    assert.equal((await s.req('catalog')).d.paymentEnabled, false);
    const r = await paymentSetup();
    r.env.TRON_RECEIVING_ADDRESS = USDT_CONTRACT;
    assert.equal((await r.req('catalog')).d.paymentEnabled, false);
    r.env.TRON_RECEIVING_ADDRESS = receiver;
    r.env.USDT_CNY_RATE = 'NaN';
    assert.equal((await r.req('catalog')).d.paymentEnabled, false);
    r.env.USDT_CNY_RATE = '7'; delete r.env.TRONGRID_API_KEY;
    assert.equal((await r.req('catalog')).d.paymentEnabled, false);
});
test('invoices lock server quotes, are idempotent and permanently unique, and prevent cancellation races', async () => {
    const s = await paymentSetup();
    const base = quoteUnits(s.order.total, '7'), amount = Number(s.invoice.amount) * 1000000;
    assert.ok(amount >= base && amount <= base + 9999);
    assert.equal((await s.req('payments/create', { ...s.order, amount: 1, address: 'attacker', rate: '100' })).d.id, s.invoice.id);
    assert.equal((await s.req('orders/cancel', s.order)).r.status, 409);
    assert.equal((await s.req('orders/lookup', s.order)).d.expires_at, s.invoice.watch_until);
    s.env.USDT_CNY_RATE = '8';
    assert.equal((await s.req('payments/create', s.order)).d.rate, '7');
    const second = (await s.req('orders', orderBody(s.p.id))).d;
    const invoices = await Promise.all([s.req('payments/create', second), s.req('payments/create', second)]);
    assert.equal(invoices[0].r.status, 200); assert.equal(invoices[1].r.status, 200);
    assert.equal(invoices[0].d.id, invoices[1].d.id);
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_invoices').get()!.n, 2);
    assert.throws(() => s.db.raw.prepare('UPDATE payment_invoices SET amount_units=? WHERE id=?').run(Math.round(amount), invoices[0].d.id), /UNIQUE/);
});
test('solidified official USDT receipts atomically deliver goods and replay is idempotent', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice);
    const paid = await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) });
    assert.equal(paid.r.status, 200, JSON.stringify(paid.d));
    assert.equal(paid.d.order.status, 'fulfilled');
    assert.equal(paid.d.order.payment.status, 'confirmed');
    assert.equal(paid.d.order.delivery.length, 1);
    assert.equal((await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) })).d.order.status, 'fulfilled');
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_receipts').get()!.n, 1);
    assert.equal(s.db.raw.prepare("SELECT count(*) AS n FROM audits WHERE action='order.fulfill'").get()!.n, 1);
    const dashboard = await s.req('admin/payment');
    assert.equal(dashboard.d.receipts[0].status, 'confirmed');
    assert.ok(!JSON.stringify(dashboard.d).includes('test-only-query-key'));
    await s.req('payments/check', { ...s.order, txId: 'b'.repeat(64) });
    assert.equal(s.db.raw.prepare("SELECT count(*) AS n FROM payment_receipts WHERE status='duplicate'").get()!.n, 1);
});
test('a submitted hash cannot redirect another invoice payment to the submitting customer', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice);
    const other = (await s.req('orders', orderBody(s.p.id))).d;
    await s.req('payments/create', other);
    const r = await s.req('payments/check', { ...other, txId: 'c'.repeat(64) });
    assert.equal(r.d.order.status, 'pending');
    assert.equal((await s.req('orders/lookup', s.order)).d.status, 'fulfilled');
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_receipts').get()!.n, 1);
});
test('unconfirmed transfers never fulfill orders', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice, { unconfirmed: true });
    const r = await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) });
    assert.equal(r.d.order.status, 'pending');
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_receipts').get()!.n, 0);
});
test('failed contract executions never fulfill orders', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice, { receiptFailed: true });
    assert.equal((await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) })).r.status, 422);
    assert.equal((await s.req('orders/lookup', s.order)).d.status, 'pending');
});
test('lookalike USDT tokens and wrong recipients never fulfill orders', async t => {
    const s = await paymentSetup();
    rpcMock(t, s.invoice, { logs: [transferLog('1000000', { address: '1'.repeat(40) }), transferLog('1000000', { topics: [TRANSFER_TOPIC, '0'.repeat(64), '2'.repeat(64)] })] });
    assert.equal((await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) })).d.order.status, 'pending');
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_receipts').get()!.n, 0);
});
test('underpayments and overpayments are reconciled without automatic credit', async t => {
    const s = await paymentSetup();
    const amount = BigInt(Math.round(Number(s.invoice.amount) * 1000000));
    rpcMock(t, s.invoice, { logs: [transferLog(String(amount - 1n)), transferLog(String(amount + 1n))] });
    assert.equal((await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) })).d.order.status, 'pending');
    assert.equal(s.db.raw.prepare("SELECT count(*) AS n FROM payment_receipts WHERE status='unmatched'").get()!.n, 2);
});
test('transfers outside the invoice window go to review with no delivery', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice, { timestamp: s.invoice.created_at - 1 });
    const r = await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) });
    assert.equal(r.d.order.status, 'pending');
    assert.equal(r.d.order.payment.status, 'review');
});
test('payment recognized after stock expiry is retained for review instead of reselling released stock', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice);
    s.db.raw.prepare('UPDATE orders SET expires_at=0 WHERE id=?').run(s.order.id);
    await s.req('orders/lookup', s.order);
    const r = await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) });
    assert.equal(r.d.order.status, 'expired');
    assert.equal(r.d.order.payment.status, 'review');
    assert.equal(r.d.order.delivery, undefined);
    assert.equal(s.db.raw.prepare("SELECT count(*) AS n FROM inventory WHERE status='delivered'").get()!.n, 0);
});
test('delivery failure rolls back payment confirmation and retains a review receipt', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice);
    s.db.raw.prepare('DELETE FROM inventory WHERE order_id=?').run(s.order.id);
    const r = await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) });
    assert.equal(r.d.order.status, 'pending');
    assert.equal(r.d.order.payment.status, 'review');
    assert.equal(s.db.raw.prepare('SELECT status FROM payment_receipts').get()!.status, 'review');
    assert.equal(s.db.raw.prepare('SELECT payment_ref FROM orders WHERE id=?').get(s.order.id)!.payment_ref, null);
});
test('RPC errors are retryable, leak no upstream detail and never alter inventory', async t => {
    const s = await paymentSetup(); rpcMock(t, s.invoice, { networkError: true });
    const r = await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) });
    assert.equal(r.r.status, 503); assert.ok(!JSON.stringify(r.d).includes('secret upstream'));
    assert.equal((await s.req('orders/lookup', s.order)).d.status, 'pending');
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_receipts').get()!.n, 0);
});
test('background reconciliation paginates confirmed history, deduplicates and fulfills without a browser', async t => {
    const s = await paymentSetup();
    s.invoice.created_at = Date.now() - 120000;
    s.db.raw.prepare('UPDATE payment_invoices SET created_at=?').run(s.invoice.created_at);
    s.db.raw.prepare('UPDATE payment_watchers SET scan_from=?').run(s.invoice.created_at - 60000);
    let pages = 0;
    rpcMock(t, s.invoice, { list: (url: URL) => { pages++; return url.searchParams.has('fingerprint') ? { success: true, data: [], meta: {} } : { success: true, data: [{ type: 'Transfer', to: receiver, token_info: { address: USDT_CONTRACT }, transaction_id: 'f'.repeat(64) }], meta: { fingerprint: 'page-two' } }; } });
    await runPaymentReconciliation(s.env);
    assert.equal(pages, 2);
    assert.equal((await s.req('orders/lookup', s.order)).d.status, 'fulfilled');
    assert.equal(s.db.raw.prepare('SELECT fingerprint FROM payment_watchers').get()!.fingerprint, '');
    assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM payment_transactions').get()!.n, 1);
    await runPaymentReconciliation(s.env); assert.equal(pages, 2); // Database lease throttles concurrent scans.
});
test('only the owner can inspect or trigger payment reconciliation', async () => {
    const s = await paymentSetup();
    await s.req('admin/staff', { username: 'support2', password: 'secure-password-123', role: 'support' });
    await s.req('auth/logout', {}); await s.req('auth/login', { username: 'support2', password: 'secure-password-123' });
    assert.equal((await s.req('admin/payment')).r.status, 403);
    assert.equal((await s.req('admin/payment', {})).r.status, 403);
});
test('self transfers cannot be treated as new funds', async t => {
    const s = await paymentSetup();
    const amount = String(Math.round(Number(s.invoice.amount) * 1000000));
    rpcMock(t, s.invoice, { logs: [transferLog(amount, { topics: [TRANSFER_TOPIC, '0'.repeat(24) + receiverHex, '0'.repeat(24) + receiverHex] })] });
    assert.equal((await s.req('payments/check', { ...s.order, txId: 'a'.repeat(64) })).r.status, 422);
    assert.equal((await s.req('orders/lookup', s.order)).d.status, 'pending');
});
test('failed background pages preserve the cursor and can be resumed', async t => {
    const s = await paymentSetup();
    const initial = s.db.raw.prepare('SELECT scan_from FROM payment_watchers').get()!.scan_from;
    const options: any = { networkError: true }; rpcMock(t, s.invoice, options);
    await assert.rejects(runPaymentReconciliation(s.env));
    const failed = s.db.raw.prepare('SELECT * FROM payment_watchers').get()!;
    assert.equal(failed.scan_from, initial); assert.equal(failed.fingerprint, ''); assert.ok(failed.last_error);
    s.db.raw.prepare('UPDATE payment_watchers SET lease_until=0').run(); options.networkError = false;
    await runPaymentReconciliation(s.env);
    assert.ok(s.db.raw.prepare('SELECT last_success_at FROM payment_watchers').get()!.last_success_at);
    assert.equal(s.db.raw.prepare('SELECT last_error FROM payment_watchers').get()!.last_error, '');
});
