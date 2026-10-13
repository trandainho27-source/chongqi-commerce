import type { RuntimeEnv } from './types.ts';
import { encrypt, sha, uid } from './security.ts';

export class SupplierError extends Error {
    constructor(public status: number, message: string, public requestLogId = '') { super(message); }
}
const base = 'https://didipifa.net/api/v1';
const sql = (db: D1Database, query: string, ...args: any[]) => db.prepare(query).bind(...args);
const fields = 'id,product_id,goods_id,quantity,quoted_total,actual_total,status,order_sn,request_log_id,error,attempts,created_at,expires_at,updated_at';
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const dataOf = (v: any) => object(v) && v.data !== undefined ? v.data : v;
const validId = (v: any) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const safeLogId = (v: string | null) => v && /^[a-zA-Z0-9_.:-]{1,120}$/.test(v) ? v : '';
export function supplierMoney(value: unknown): number {
    if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(value))) throw new SupplierError(502, '供应商金额字段无法识别，请核对 API 返回格式');
    const [a, b = ''] = String(value).split('.');
    return Number(a) * 100 + Number(b.padEnd(2, '0'));
}
export function supplierGood(raw: any) {
    if (!object(raw) || !validId(raw.id ?? raw.goods_id)) throw new SupplierError(502, '供应商商品编号字段无法识别');
    const name = raw.name ?? raw.goods_name;
    const stock = raw.stock ?? raw.in_stock;
    if (typeof name !== 'string' || !name.trim() || !Number.isSafeInteger(Number(stock)) || Number(stock) < 0) throw new SupplierError(502, '供应商商品名称或库存字段无法识别');
    const price = supplierMoney(raw.price ?? raw.actual_price);
    if (!price) throw new SupplierError(502, '供应商商品价格必须大于零');
    const delivery = String(raw.delivery_type ?? '').toLowerCase();
    // Numeric type/status codes are deliberately not guessed without upstream documentation.
    const automatic = ['auto', 'automatic'].includes(delivery) || raw.automatic === true || raw.is_auto === true;
    const manual = ['manual', 'service'].includes(delivery) || raw.automatic === false || raw.is_auto === false;
    return { id: Number(raw.id ?? raw.goods_id), name: name.trim().slice(0, 120), price, stock: Number(stock), delivery: automatic ? 'automatic' : manual ? 'manual' : 'unknown' };
}
async function request(db: D1Database, env: RuntimeEnv, path: string, payload?: unknown) {
    if (!env.DIDIPIFA_API_TOKEN?.trim()) throw new SupplierError(503, '请先在 Cloudflare 配置 DIDIPIFA_API_TOKEN 机密');
    if (!/^\/(account|goods(?:\/\d+)?(?:\?page=\d+)?|orders(?:\/[a-zA-Z0-9_-]+)?)$/.test(path)) throw new SupplierError(400, '供应商请求路径无效');
    const ts = Date.now();
    const usage = await sql(db, 'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', 'didipifa:' + Math.floor(ts / 60000), ts + 120000).first<{count: number}>();
    if (usage!.count > 45) throw new SupplierError(429, '供应商调用已达到本分钟安全限额，请稍后重试');
    let logId = '';
    try {
        const r = await fetch(base + path, { method: payload === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + env.DIDIPIFA_API_TOKEN.trim(), Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
        logId = safeLogId(r.headers.get('Request-Id'));
        if (!r.ok) throw new SupplierError(r.status === 429 ? 429 : 502, r.status === 401 || r.status === 403 ? '供应商拒绝访问，请检查 API Token 和权限' : r.status === 409 ? '供应商幂等参数冲突，请联系供应商核查原采购编号，勿另建采购' : r.status === 429 ? '供应商限流，请稍后使用原采购记录重试' : '供应商请求未成功，请通过原采购记录核对或重试', logId);
        const reader = r.body?.getReader();
        if (!reader) throw new Error('empty');
        let length = 0; const chunks: Uint8Array[] = [];
        for (;;) {
            const {done, value} = await reader.read(); if (done) break;
            length += value.length;
            if (length > (path.startsWith('/orders') ? 60000 : 500000)) { await reader.cancel(); throw new Error('size'); }
            chunks.push(value);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const text = new TextDecoder().decode(bytes), raw = JSON.parse(text);
        if (!object(raw) || raw.success === false || raw.error) throw new SupplierError(502, '供应商返回失败结果，请核对原采购记录', logId);
        return { raw, text, logId };
    } catch (e) {
        if (e instanceof SupplierError) throw e;
        throw new SupplierError(502, '供应商连接超时或响应格式异常；采购请使用原记录重试，勿重新下单', logId);
    }
}
export async function supplierDashboard(db: D1Database, env: RuntimeEnv) {
    return {
        config: { base, tokenConfigured: !!env.DIDIPIFA_API_TOKEN?.trim(), purchaseEnabled: env.DIDIPIFA_PURCHASE_ENABLED === 'true' && env.DEMO_MODE !== 'true', inventoryReady: /^[a-f0-9]{64}$/i.test(env.INVENTORY_KEY || ''), demo: env.DEMO_MODE === 'true' },
        goods: (await sql(db, `SELECT s.*,p.name,p.price,p.category_id,p.icon_key,p.country_code,p.active,(SELECT count(*) FROM inventory i WHERE i.product_id=p.id AND i.status='available') AS local_stock FROM supplier_goods s JOIN products p ON p.id=s.product_id ORDER BY p.category_id,p.created_at DESC`).all()).results,
        purchases: (await sql(db, `SELECT ${fields} FROM supplier_purchases ORDER BY created_at DESC LIMIT 100`).all()).results,
    };
}
export async function supplierAccount(db: D1Database, env: RuntimeEnv) {
    const r = await request(db, env, '/account'), a = dataOf(r.raw);
    if (!object(a)) throw new SupplierError(502, '供应商账户响应格式尚未匹配', r.logId);
    if (a.currency && a.currency !== 'CNY') throw new SupplierError(502, '供应商余额币种不是 CNY，请核对接口');
    return { balance: supplierMoney(a.balance), currency: 'CNY', checkedAt: Date.now(), requestLogId: r.logId };
}
export async function syncSupplier(db: D1Database, env: RuntimeEnv, actor: string) {
    const entries = new Map<number, ReturnType<typeof supplierGood>>();
    let page = 1;
    for (;;) {
        const r = await request(db, env, page === 1 ? '/goods' : '/goods?page=' + page), root = dataOf(r.raw);
        const list = Array.isArray(root) ? root : root?.goods ?? root?.items ?? root?.data;
        if (!Array.isArray(list)) throw new SupplierError(502, '供应商商品列表字段尚未匹配；请提供成功响应示例', r.logId);
        for (const raw of list) { const good = supplierGood(raw); entries.set(good.id, good); }
        const last = r.raw.meta?.last_page ?? root?.last_page ?? 1;
        if (!Number.isSafeInteger(Number(last)) || Number(last) < page || Number(last) > 20 || entries.size > 1000) throw new SupplierError(502, '供应商分页超出支持范围，本次未保存');
        if (page >= Number(last)) break;
        page++;
    }
    const ts = Date.now();
    await sql(db, "INSERT OR IGNORE INTO categories VALUES('dp-api','其他货源商品','box',110,1)").run();
    for (const good of entries.values()) {
        const existing = await sql(db, 'SELECT product_id FROM supplier_goods WHERE goods_id=?', good.id).first<{product_id: string}>();
        const id = existing?.product_id || 'dp-' + good.id;
        await db.batch([
            sql(db, `INSERT OR IGNORE INTO products(id,category_id,name,subtitle,description,instructions,price,created_at,icon_key) VALUES(?,'dp-api',?,'数字商品','请核对商品规格后购买。','交付内容与使用要求以本店商品说明为准。',?,?,'box')`, id, good.name, good.price, ts),
            sql(db, `INSERT INTO supplier_goods(product_id,goods_id,source_url,reference_price,upstream_stock,delivery_type,synced_at,origin) VALUES(?,?,?,?,?,?,?,'api') ON CONFLICT(product_id) DO UPDATE SET reference_price=excluded.reference_price,upstream_stock=excluded.upstream_stock,delivery_type=CASE WHEN excluded.delivery_type='unknown' THEN supplier_goods.delivery_type ELSE excluded.delivery_type END,synced_at=excluded.synced_at,origin='api'`, id, good.id, 'https://didipifa.net/buy/' + good.id, good.price, good.stock, good.delivery, ts),
        ]);
    }
    await sql(db, 'INSERT INTO audits VALUES(?,?,?,?,?,?)', uid(), actor, 'supplier.sync', 'didipifa', `${entries.size} 个商品；本店售价不变`, ts).run();
    return { ok: true, synced: entries.size, message: `已同步 ${entries.size} 个货源商品，本店售价和卡密库存保持独立。` };
}
async function goodForPurchase(db: D1Database, env: RuntimeEnv, goodsId: number, qty: number) {
    const mapped = await sql(db, 'SELECT * FROM supplier_goods WHERE goods_id=?', goodsId).first<any>();
    if (!mapped || mapped.blocked_reason || mapped.delivery_type === 'manual') throw new SupplierError(409, mapped?.blocked_reason || '该商品暂不支持 API 采购');
    const r = await request(db, env, '/goods/' + goodsId), good = supplierGood(dataOf(r.raw));
    if (good.id !== goodsId) throw new SupplierError(502, '供应商返回的商品编号不匹配', r.logId);
    if (good.delivery === 'manual' || (good.delivery !== 'automatic' && mapped.delivery_type !== 'automatic')) throw new SupplierError(409, '尚未确认该商品支持自动发货，请先核对供应商响应字段');
    if (good.stock < qty) throw new SupplierError(409, '供应商实时库存不足');
    return { ...good, productId: mapped.product_id };
}
export async function quoteSupplier(db: D1Database, env: RuntimeEnv, actor: string, goodsId: number, quantity: number) {
    if (!Number.isSafeInteger(goodsId) || goodsId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 30) throw new SupplierError(400, '每次采购 1–30 份，请选择有效商品');
    const good = await goodForPurchase(db, env, goodsId, quantity), ts = Date.now(), id = 'CQ-SUP-' + uid();
    await sql(db, `INSERT INTO supplier_purchases(id,product_id,goods_id,quantity,quoted_total,actor,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, id, good.productId, goodsId, quantity, good.price * quantity, actor, ts, ts + 300000, ts).run();
    return { quote: { id, name: good.name, goodsId, quantity, unitPrice: good.price, total: good.price * quantity, expiresAt: ts + 300000 } };
}
export function supplierDelivery(raw: any, purchase: any) {
    const d = dataOf(raw);
    if (!object(d) || typeof d.order_sn !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(d.order_sn)) throw new SupplierError(502, '订单响应缺少有效 order_sn，需核对 API 格式');
    if (Number(d.goods_id) !== purchase.goods_id || Number(d.quantity) !== purchase.quantity || (d.request_id !== undefined && d.request_id !== purchase.id)) throw new SupplierError(502, '供应商订单商品、数量或采购编号不匹配');
    if (!['fulfilled', 'completed', 'delivered', 'success'].includes(String(d.status).toLowerCase())) throw new SupplierError(502, '供应商订单尚未确认发货，或状态字段需要适配');
    if (!Array.isArray(d.cards) || d.cards.length !== purchase.quantity || d.cards.some((c: unknown) => typeof c !== 'string' || !c.trim() || c.length > 2000) || new Set(d.cards.map((c: string) => c.trim())).size !== purchase.quantity) throw new SupplierError(502, '供应商卡密数量或格式不匹配，已保留采购记录，请核查');
    if (d.currency && d.currency !== 'CNY') throw new SupplierError(502, '供应商采购币种不是 CNY，请核对接口');
    const total = supplierMoney(d.total_price ?? d.total);
    if (total > purchase.quoted_total) throw new SupplierError(502, '供应商实际扣款高于确认报价，请核查采购记录');
    return { orderSn: d.order_sn, cards: d.cards.map((c: string) => c.trim()) as string[], total };
}
export async function purchaseSupplier(db: D1Database, env: RuntimeEnv, actor: string, id: string) {
    let p = await sql(db, 'SELECT * FROM supplier_purchases WHERE id=?', id).first<any>();
    if (!p) throw new SupplierError(404, '采购记录不存在');
    if (p.status === 'imported') return { ok: true, message: '该采购已入库，无需重复操作。' };
    if (env.DEMO_MODE === 'true' || env.DIDIPIFA_PURCHASE_ENABLED !== 'true') throw new SupplierError(403, '采购开关尚未开启；完成 API 响应联调后再启用 DIDIPIFA_PURCHASE_ENABLED');
    if (!/^[a-f0-9]{64}$/i.test(env.INVENTORY_KEY || '')) throw new SupplierError(503, '库存加密密钥未配置');
    if (!p.attempts && p.expires_at < Date.now()) throw new SupplierError(409, '报价已过期，请重新获取报价');
    const leaseUntil = Date.now() + 120000;
    const locked = await sql(db, `UPDATE supplier_purchases SET lease_until=? WHERE id=? AND lease_until<? AND status!='imported' RETURNING id`, leaseUntil, id, Date.now()).first();
    if (!locked) throw new SupplierError(409, '这笔采购正在处理，请稍后刷新原记录');
    try {
        p = await sql(db, 'SELECT * FROM supplier_purchases WHERE id=?', id).first<any>();
        if (!p.attempts) {
            const good = await goodForPurchase(db, env, p.goods_id, p.quantity);
            if (good.price * p.quantity !== p.quoted_total) throw new SupplierError(409, '供应商价格已变化，本次未采购，请重新报价');
            if (p.expires_at < Date.now()) throw new SupplierError(409, '报价已过期，本次未采购');
        }
        const attempt = await sql(db, "UPDATE supplier_purchases SET attempts=attempts+1,status='purchasing',updated_at=? WHERE id=? AND lease_until=? AND status!='imported' RETURNING id", Date.now(), id, leaseUntil).first();
        if (!attempt) throw new SupplierError(409, '采购状态已变化，请刷新原记录');
        const result = await request(db, env, p.order_sn ? '/orders/' + p.order_sn : '/orders', p.order_sn ? undefined : { goods_id: p.goods_id, quantity: p.quantity, request_id: p.id });
        const d = dataOf(result.raw), orderSn = typeof d?.order_sn === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(d.order_sn) ? d.order_sn : p.order_sn;
        // Save an encrypted response before parsing. A crash can be recovered with the same request_id.
        const received = await sql(db, "UPDATE supplier_purchases SET encrypted_response=?,order_sn=?,request_log_id=?,status='received',updated_at=? WHERE id=? AND lease_until=? AND status!='imported' RETURNING id", await encrypt(result.text, env.INVENTORY_KEY!, 'supplier:' + id), orderSn, result.logId, Date.now(), id, leaseUntil).first();
        if (!received) throw new SupplierError(409, '采购状态已变化，请刷新原记录');
        const delivery = supplierDelivery(result.raw, p), statements: D1PreparedStatement[] = [], ts = Date.now();
        const guard = uid();
        statements.push(sql(db, "INSERT INTO transaction_guards(id,passed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM supplier_purchases WHERE id=? AND status='received' AND lease_until=?) THEN 1 ELSE 0 END", guard, id, leaseUntil));
        for (let i = 0; i < delivery.cards.length; i++) {
            const card = delivery.cards[i], inventoryId = uid();
            statements.push(sql(db, "INSERT INTO inventory VALUES(?,?,?,?,'available',NULL,?)", inventoryId, p.product_id, await encrypt(card, env.INVENTORY_KEY!, p.product_id), await sha(p.product_id + ':' + card), ts));
            statements.push(sql(db, 'INSERT INTO supplier_cards VALUES(?,?,?)', id + ':' + i, id, inventoryId));
        }
        statements.push(sql(db, "UPDATE supplier_purchases SET status='imported',actual_total=?,error='',lease_until=0,updated_at=? WHERE id=?", delivery.total, ts, id));
        statements.push(sql(db, 'DELETE FROM transaction_guards WHERE id=?', guard));
        statements.push(sql(db, 'INSERT INTO audits VALUES(?,?,?,?,?,?)', uid(), actor, 'supplier.purchase', id, `商品 ${p.goods_id}，数量 ${p.quantity}`, ts));
        await db.batch(statements);
        return { ok: true, message: `采购成功，${p.quantity} 条卡密已加密入库。`, purchaseId: id };
    } catch (e) {
        const message = e instanceof SupplierError ? e.message : '采购响应或入库未完成，请使用原记录重查，勿另建采购';
        await sql(db, "UPDATE supplier_purchases SET status=CASE WHEN encrypted_response IS NOT NULL THEN 'review' WHEN attempts>0 THEN 'uncertain' ELSE 'quoted' END,error=?,request_log_id=CASE WHEN ?!='' THEN ? ELSE request_log_id END,lease_until=0,updated_at=? WHERE id=? AND lease_until=? AND status!='imported'", message, e instanceof SupplierError ? e.requestLogId : '', e instanceof SupplierError ? e.requestLogId : '', Date.now(), id, leaseUntil).run();
        throw new SupplierError(e instanceof SupplierError ? e.status : 502, message);
    } finally {
        await sql(db, 'UPDATE supplier_purchases SET lease_until=0 WHERE id=? AND lease_until=?', id, leaseUntil).run();
    }
}
