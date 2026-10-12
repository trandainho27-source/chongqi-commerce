import type { RuntimeEnv, PaymentInvoice, Order } from './types.ts';
import { uid } from './security.ts';
import { PaymentError, paymentConfiguration, quoteUnits, unitsText, confirmedTransfers, tronRequest, USDT_CONTRACT, type ChainTransfer } from './tron.ts';

const q = (db: D1Database, sql: string, ...values: any[]) => db.prepare(sql).bind(...values);
interface InvoiceRow {
    id: string; order_id: string; address: string; address_hex: string; amount_units: number; base_units: number;
    rate: string; status: string; created_at: number; pay_before: number; watch_until: number; tx_id: string | null; review_reason: string;
}
type Settle = (db: D1Database, id: string, actor: string, reason: string, provider: string, reference: string, amount?: number, extra?: D1PreparedStatement[]) => Promise<unknown>;
function publicInvoice(r: InvoiceRow): PaymentInvoice {
    return { id: r.id, order_id: r.order_id, address: r.address, amount: unitsText(r.amount_units), base_amount: unitsText(r.base_units), adjustment: unitsText(r.amount_units - r.base_units), rate: r.rate, status: r.status, created_at: r.created_at, pay_before: r.pay_before, watch_until: r.watch_until, tx_id: r.tx_id, review_reason: r.review_reason, network: 'TRON / TRC20' };
}
export async function invoiceForOrder(db: D1Database, orderId: string) {
    const row = await q(db, 'SELECT * FROM payment_invoices WHERE order_id=?', orderId).first<InvoiceRow>();
    return row ? publicInvoice(row) : null;
}
export async function createInvoice(db: D1Database, env: RuntimeEnv, order: Order) {
    const config = await paymentConfiguration(env);
    if (!config.enabled) throw new PaymentError(503, env.DEMO_MODE === 'true' ? '演示环境不收取真实 USDT，请勿转账' : 'USDT 收款配置尚未完成，请联系商家');
    const existing = await invoiceForOrder(db, order.id);
    if (existing) return existing;
    const ts = Date.now();
    if (order.status !== 'pending' || order.demo || order.expires_at <= ts + 60000) throw new PaymentError(409, '订单无法付款或剩余时间不足，请重新下单');
    const base = quoteUnits(order.total, config.rate), watchUntil = order.expires_at + 10 * 60000;
    // Permanent address+amount uniqueness prevents even very late transfers from
    // being silently attributed to another order. No expiry-based amount reuse.
    for (let attempt = 0; attempt < 32; attempt++) {
        const suffix = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
        const invoiceId = uid(), guardId = uid();
        try {
            await db.batch([
                q(db, `INSERT INTO payment_invoices(id,order_id,address,address_hex,amount_units,base_units,rate,status,created_at,pay_before,watch_until)
                    SELECT ?,id,?,?,?,?,?,'waiting',?,?,? FROM orders WHERE id=? AND status='pending' AND demo=0 AND ready=1 AND expires_at=? AND expires_at>?`,
                    invoiceId, config.address, config.addressHex, base + suffix, base, config.rate, ts, order.expires_at, watchUntil, order.id, order.expires_at, ts),
                q(db, `INSERT INTO transaction_guards(id,passed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM payment_invoices WHERE id=?) THEN 1 ELSE 0 END`, guardId, invoiceId),
                q(db, 'DELETE FROM transaction_guards WHERE id=?', guardId),
                q(db, "UPDATE orders SET expires_at=? WHERE id=? AND status='pending'", watchUntil, order.id),
                q(db, 'INSERT OR IGNORE INTO payment_watchers(address,address_hex,scan_from) VALUES(?,?,?)', config.address, config.addressHex, ts - 60000),
                q(db, 'INSERT INTO audits VALUES(?,?,?,?,?,?)', uid(), 'payment', 'payment.create', order.id, `${unitsText(base + suffix)} USDT; rate=${config.rate}`, ts),
            ]);
            return (await invoiceForOrder(db, order.id))!;
        } catch (e) {
            // Another request for this order may have won the race.
            const sameOrder = await invoiceForOrder(db, order.id);
            if (sameOrder) return sameOrder;
            const collision = await q(db, 'SELECT id FROM payment_invoices WHERE address=? AND amount_units=?', config.address, base + suffix).first();
            if (!collision) throw new PaymentError(409, '订单状态已变化，无法创建支付单');
        }
    }
    throw new PaymentError(503, '当前收款金额分配繁忙，请联系商家');
}
function receiptInsert(db: D1Database, address: string, transfer: ChainTransfer, invoiceId: string | null, status: string, reason: string) {
    return q(db, `INSERT INTO payment_receipts(event_id,tx_id,address,from_hex,amount_units,block,block_timestamp,invoice_id,status,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        transfer.eventId, transfer.txId, address, transfer.fromHex, transfer.amountUnits, transfer.block, transfer.timestamp, invoiceId, status, reason, Date.now());
}
export async function applyTransfer(db: D1Database, address: string, transfer: ChainTransfer, settle: Settle) {
    const prior = await q(db, 'SELECT status FROM payment_receipts WHERE event_id=?', transfer.eventId).first();
    if (prior) return prior;
    const invoice = BigInt(transfer.amountUnits) <= BigInt(Number.MAX_SAFE_INTEGER)
        ? await q(db, 'SELECT * FROM payment_invoices WHERE address=? AND amount_units=?', address, Number(transfer.amountUnits)).first<InvoiceRow>() : null;
    let status = 'unmatched', reason = '金额未匹配支付单，请人工对账';
    if (invoice) {
        const order = await q(db, 'SELECT * FROM orders WHERE id=?', invoice.order_id).first<Order>();
        if (invoice.status === 'confirmed' || invoice.status === 'review') {
            status = 'duplicate'; reason = '该支付单已有到账记录，请核对重复付款';
        } else if (transfer.timestamp < invoice.created_at || transfer.timestamp > invoice.pay_before) {
            status = 'review'; reason = '到账时间不在支付有效期内，请人工处理';
        } else if (!order || order.status !== 'pending' || order.expires_at <= Date.now() || order.demo) {
            status = 'review'; reason = '到账已确认，但订单已结束或库存保留期已过，请人工处理';
        } else {
            try {
                // Receipt, invoice, paid order, stock delivery and audit commit together.
                await settle(db, invoice.order_id, 'trc20', `TRON 固化到账 ${transfer.eventId}`, 'trc20', transfer.eventId, order.total, [
                    receiptInsert(db, address, transfer, invoice.id, 'confirmed', ''),
                    q(db, "UPDATE payment_invoices SET status='confirmed',tx_id=?,event_id=?,confirmed_at=?,review_reason='' WHERE id=?", transfer.txId, transfer.eventId, Date.now(), invoice.id),
                ]);
                return { status: 'confirmed' };
            } catch {
                const raced = await q(db, 'SELECT status FROM payment_receipts WHERE event_id=?', transfer.eventId).first();
                if (raced) return raced;
                status = 'review'; reason = '链上到账已确认，订单交付冲突，请核对库存与付款记录';
            }
        }
    }
    const statements = [receiptInsert(db, address, transfer, invoice?.id || null, status, reason)];
    if (invoice && status === 'review') statements.push(q(db, "UPDATE payment_invoices SET status='review',tx_id=?,event_id=?,review_reason=? WHERE id=? AND status IN('waiting','expired')", transfer.txId, transfer.eventId, reason, invoice.id));
    statements.push(q(db, 'INSERT INTO audits VALUES(?,?,?,?,?,?)', uid(), 'trc20', 'payment.' + status, invoice?.order_id || transfer.eventId, reason, Date.now()));
    try { await db.batch(statements); }
    catch (e) {
        if (!await q(db, 'SELECT event_id FROM payment_receipts WHERE event_id=?', transfer.eventId).first()) throw e;
    }
    return { status };
}
function canQuery(env: RuntimeEnv) {
    if (env.DEMO_MODE === 'true' || !env.TRONGRID_API_KEY) throw new PaymentError(503, '当前环境未启用真实链上核验');
}
export async function checkTransaction(db: D1Database, env: RuntimeEnv, orderId: string, txId: string, settle: Settle) {
    canQuery(env);
    const invoice = await q(db, 'SELECT * FROM payment_invoices WHERE order_id=?', orderId).first<InvoiceRow>();
    if (!invoice) throw new PaymentError(409, '请先生成 USDT 支付单');
    const transfers = await confirmedTransfers(env, txId, invoice.address_hex);
    if (!transfers.length) return { message: '尚未找到已确认的 USDT 到账。请核对网络和收款地址，稍后再查，请勿重复付款。' };
    // Match by the actual address+amount, never by a customer-supplied order ID.
    for (const transfer of transfers) await applyTransfer(db, invoice.address, transfer, settle);
    await q(db, 'INSERT OR IGNORE INTO payment_transactions VALUES(?,?,?,?)', `${txId.toLowerCase()}:${invoice.address}`, txId.toLowerCase(), invoice.address, Date.now()).run();
    return { message: transfers.some(t => t.amountUnits === String(invoice.amount_units)) ? '已完成链上核验，请查看订单状态。' : '该交易到账金额与本订单不一致，已留存对账记录，请提交售后工单。' };
}
interface Watcher { address: string; address_hex: string; scan_from: number; window_end: number | null; fingerprint: string; }
export async function reconcilePayments(env: RuntimeEnv, settle: Settle, onlyAddress?: string) {
    canQuery(env);
    if (!env.DB) throw new PaymentError(503, '数据库未配置');
    const db = env.DB, started = Date.now();
    const watchers = (await q(db, `SELECT * FROM payment_watchers ${onlyAddress ? 'WHERE address=?' : ''} ORDER BY lease_until LIMIT 5`, ...(onlyAddress ? [onlyAddress] : [])).all<Watcher>()).results;
    let scanned = 0, failed = false;
    for (const watcher of watchers) {
        if (Date.now() - started > 45000) break;
        const leaseToken = uid();
        const acquired = await q(db, 'UPDATE payment_watchers SET lease_until=?,lease_token=? WHERE address=? AND lease_until<=? RETURNING address', Date.now() + 90000, leaseToken, watcher.address, Date.now()).first();
        if (!acquired) continue;
        let from = watcher.scan_from, end = watcher.window_end ?? Math.max(from, Date.now() - 60000), fingerprint = watcher.fingerprint;
        try {
            for (let page = 0; page < 3; page++) {
                const params = new URLSearchParams({ only_confirmed: 'true', only_to: 'true', contract_address: USDT_CONTRACT, limit: '20', order_by: 'block_timestamp,asc', min_timestamp: String(from), max_timestamp: String(end) });
                if (fingerprint) params.set('fingerprint', fingerprint);
                const response = await tronRequest(env, `/v1/accounts/${watcher.address}/transactions/trc20?${params}`);
                if (!Array.isArray(response.data) || response.success !== true) throw new PaymentError(503, '链上列表暂不可用');
                let completed = true;
                const seen = new Set<string>();
                for (const row of response.data) {
                    if (row.type !== 'Transfer' || row.to !== watcher.address || row.token_info?.address !== USDT_CONTRACT) continue;
                    const txId = String(row.transaction_id);
                    if (!/^[0-9a-f]{64}$/i.test(txId)) throw new PaymentError(503, '链上列表数据不完整');
                    if (seen.has(txId) || await q(db, 'SELECT id FROM payment_transactions WHERE tx_id=? AND address=?', txId.toLowerCase(), watcher.address).first()) continue;
                    seen.add(txId);
                    if (Date.now() - started > 45000) { completed = false; break; }
                    const transfers = await confirmedTransfers(env, txId, watcher.address_hex);
                    // Indexing can lead receipt availability. Do not move past it.
                    if (!transfers.length) { completed = false; break; }
                    for (const transfer of transfers) { await applyTransfer(db, watcher.address, transfer, settle); scanned++; }
                    await q(db, 'INSERT OR IGNORE INTO payment_transactions VALUES(?,?,?,?)', `${txId.toLowerCase()}:${watcher.address}`, txId.toLowerCase(), watcher.address, Date.now()).run();
                }
                if (!completed) break;
                const next = response.data.length ? String(response.meta?.fingerprint || '') : '';
                if (next && next === fingerprint) throw new PaymentError(503, '链上分页尚未推进，请稍后重试');
                fingerprint = next;
                if (!next) {
                    // Overlap covers normal confirmation/indexer delay; every event is deduplicated.
                    from = Math.max(0, end - 10 * 60000);
                    await q(db, "UPDATE payment_watchers SET scan_from=?,window_end=NULL,fingerprint='',last_success_at=?,last_error='' WHERE address=? AND lease_token=?", from, Date.now(), watcher.address, leaseToken).run();
                    break;
                }
                await q(db, "UPDATE payment_watchers SET scan_from=?,window_end=?,fingerprint=?,last_success_at=?,last_error='' WHERE address=? AND lease_token=?", from, end, fingerprint, Date.now(), watcher.address, leaseToken).run();
            }
        } catch (e) {
            await q(db, 'UPDATE payment_watchers SET last_error=? WHERE address=? AND lease_token=?', '链上查询未完成，将自动重试；可使用交易哈希补查', watcher.address, leaseToken).run();
            failed = true;
        } finally {
            await q(db, 'UPDATE payment_watchers SET lease_until=? WHERE address=? AND lease_token=?', Date.now() + 15000, watcher.address, leaseToken).run();
        }
    }
    if (failed) throw new PaymentError(503, '部分链上查询尚未完成，将自动重试，请勿重复付款');
    return { ok: true, scanned };
}
export async function paymentDashboard(db: D1Database, env: RuntimeEnv) {
    const config = await paymentConfiguration(env);
    const invoices = (await q(db, 'SELECT * FROM payment_invoices ORDER BY created_at DESC LIMIT 50').all<InvoiceRow>()).results.map(publicInvoice);
    const receipts = (await q(db, 'SELECT r.*,i.order_id FROM payment_receipts r LEFT JOIN payment_invoices i ON r.invoice_id=i.id ORDER BY r.created_at DESC LIMIT 50').all<any>()).results.map(r => ({ ...r, amount: unitsText(r.amount_units) }));
    const watchers = (await q(db, 'SELECT address,last_success_at,last_error FROM payment_watchers').all()).results;
    return { config, invoices, receipts, watchers };
}
