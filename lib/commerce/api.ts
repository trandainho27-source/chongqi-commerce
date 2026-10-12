import type { RuntimeEnv, Staff, Product, Order } from './types.ts';
import { uid, randomToken, sha, safeEqual, hashPassword, verifyPassword, encrypt, decrypt, hmac } from './security.ts';
import { categorySeed, productSeed } from './seed.ts';
import { PaymentError, paymentConfiguration } from './tron.ts';
import { createInvoice, invoiceForOrder, checkTransaction, reconcilePayments, paymentDashboard } from './payments.ts';
class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}
function fail(status: number, message: string): never {
    throw new ApiError(status, message);
}
const now = () => Date.now();
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const str = (v: unknown, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const integer = (v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
        fail(400, '数字超出允许范围');
    return v as number;
};
async function body(request: Request): Promise<Record<string, any>> {
    const raw = await request.text();
    if (raw.length > 150000)
        fail(413, '提交内容过大');
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return fail(400, '提交格式无效');
        return parsed as Record<string, any>;
    }
    catch {
        fail(400, '提交格式无效');
    }
}
function database(env: RuntimeEnv) {
    if (!env.DB)
        fail(503, '数据库未配置，请完成 Cloudflare 部署');
    return env.DB!;
}
const stmt = (db: D1Database, sql: string, ...values: any[]) => db.prepare(sql).bind(...values);
async function all<T = any>(db: D1Database, sql: string, ...values: any[]) {
    return (await stmt(db, sql, ...values).all<T>()).results;
}
async function first<T = any>(db: D1Database, sql: string, ...values: any[]) {
    return stmt(db, sql, ...values).first<T>();
}
function audit(db: D1Database, actor: string, action: string, target: string, detail = '') {
    return stmt(db, 'INSERT INTO audits VALUES(?,?,?,?,?,?)', uid(), actor, action, target, detail, now());
}
async function limit(db: D1Database, request: Request, action: string, max: number) {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const bucket = Math.floor(now() / 60000);
    const key = await sha(`${action}:${ip}:${bucket}`);
    const result = await stmt(db, 'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', key, now() + 120000).first<{
        count: number;
    }>();
    if (result!.count > max)
        fail(429, '操作太频繁，请稍后再试');
}
async function expire(db: D1Database) {
    const ts = now();
    await db.batch([stmt(db, "UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<?", ts), stmt(db, "UPDATE inventory SET status='available',order_id=NULL WHERE status='reserved' AND order_id IN(SELECT id FROM orders WHERE status IN('expired','cancelled'))"), stmt(db, "UPDATE payment_invoices SET status='expired' WHERE status='waiting' AND watch_until<?", ts), stmt(db, 'DELETE FROM rate_limits WHERE reset_at<?', ts), stmt(db, 'DELETE FROM sessions WHERE expires_at<?', ts)]);
}
const productQuery = `SELECT p.*, (SELECT count(*) FROM inventory i WHERE i.product_id=p.id AND i.status='available') AS stock FROM products p`;
async function catalog(db: D1Database, env: RuntimeEnv) {
    if (env.DEMO_MODE === 'true' && !(await first<{
        n: number;
    }>(db, 'SELECT count(*) AS n FROM categories'))!.n)
        await seed(db, env, 'system');
    await expire(db);
    const products = await all<Product>(db, productQuery + ' WHERE p.active=1 AND p.category_id IN(SELECT id FROM categories WHERE active=1) ORDER BY featured DESC,created_at DESC');
    const categories = await all(db, 'SELECT * FROM categories WHERE active=1 ORDER BY sort');
    const settings = Object.fromEntries((await all<{
        key: string;
        value: string;
    }>(db, 'SELECT * FROM settings')).map(s => [s.key, s.value]));
    return { products, categories, settings, demo: env.DEMO_MODE === 'true', paymentEnabled: (await paymentConfiguration(env)).enabled };
}
async function authenticated(db: D1Database, request: Request, roles?: string[]) {
    const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('cq_session='))?.slice(11);
    if (!token)
        fail(401, '请先登录管理后台');
    const person = await first<Staff>(db, 'SELECT s.id,s.username,s.role,s.active,x.csrf FROM sessions x JOIN staff s ON x.staff_id=s.id WHERE x.hash=? AND x.expires_at>? AND s.active=1', await sha(token!), now());
    if (!person)
        fail(401, '登录已过期，请重新登录');
    if (roles && !roles.includes(person!.role))
        fail(403, '当前账号没有该操作权限');
    if (request.method !== 'GET' && !safeEqual(request.headers.get('x-csrf-token') || '', person!.csrf!))
        fail(403, '安全校验失败，请刷新后重试');
    return person!;
}
async function loginSession(db: D1Database, id: string) {
    const token = randomToken(), csrf = randomToken();
    await stmt(db, 'INSERT INTO sessions VALUES(?,?,?,?)', await sha(token), id, csrf, now() + 8 * 3600000).run();
    return json({ ok: true, csrf }, 200, { 'Set-Cookie': `cq_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
}
async function lookup(db: D1Database, env: RuntimeEnv, id: string, secret: string) {
    const order = await first<Order & {
        lookup_hash: string;
    }>(db, 'SELECT * FROM orders WHERE id=? AND ready=1', id);
    if (!order || !safeEqual(await sha(secret), order.lookup_hash))
        fail(404, '订单号或查询密钥不正确');
    const { lookup_hash, ...result } = order!;
    result.items = await all(db, 'SELECT product_id,product_name,price,quantity FROM order_items WHERE order_id=?', id);
    result.tickets = await all(db, 'SELECT * FROM tickets WHERE order_id=? ORDER BY created_at DESC', id);
    result.payment = await invoiceForOrder(db, id);
    if (result.status === 'fulfilled') {
        const cards = await all<{
            ciphertext: string;
            product_id: string;
        }>(db, "SELECT ciphertext,product_id FROM inventory WHERE order_id=? AND status='delivered'", id);
        result.delivery = await Promise.all(cards.map(c => decrypt(c.ciphertext, env.INVENTORY_KEY!, c.product_id)));
    }
    return result;
}
// CHECK-constrained guard inserts abort the entire D1 batch on incomplete reservation.
// This avoids trigger SQL, which some hosted migration runners split incorrectly.
export function reservationGuard(db: D1Database, orderId: string) {
    const guardId = uid();
    return [stmt(db, `INSERT INTO transaction_guards(id,passed)
        SELECT ?, CASE WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.status='pending'
            AND EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id)
            AND o.total=(SELECT sum(price*quantity) FROM order_items WHERE order_id=o.id)
            AND NOT EXISTS(SELECT 1 FROM order_items l JOIN products p ON l.product_id=p.id JOIN categories c ON p.category_id=c.id
                WHERE l.order_id=o.id AND (p.active!=1 OR c.active!=1 OR p.price!=l.price OR l.quantity<p.min_qty OR l.quantity>p.max_qty
                OR l.quantity!=(SELECT count(*) FROM inventory i WHERE i.order_id=o.id AND i.product_id=l.product_id AND i.status='reserved'))))
        THEN 1 ELSE 0 END`, guardId, orderId), stmt(db, 'DELETE FROM transaction_guards WHERE id=?', guardId)];
}
function fulfillmentGuard(db: D1Database, orderId: string, provider: string, reference: string) {
    const guardId = uid();
    return [stmt(db, `INSERT INTO transaction_guards(id,passed)
        SELECT ?, CASE WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.status IN('paid','fulfilled') AND o.payment_provider=? AND o.payment_ref=?
            AND EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id)
            AND NOT EXISTS(SELECT 1 FROM order_items l WHERE l.order_id=o.id AND l.quantity!=(SELECT count(*) FROM inventory i WHERE i.order_id=o.id AND i.product_id=l.product_id AND i.status='delivered')))
        THEN 1 ELSE 0 END`, guardId, orderId, provider, reference), stmt(db, 'DELETE FROM transaction_guards WHERE id=?', guardId)];
}
export async function settleOrder(db: D1Database, id: string, actor: string, reason: string, provider: string, reference: string, amount?: number, extra: D1PreparedStatement[] = []) {
    const order = await first<Order>(db, 'SELECT * FROM orders WHERE id=?', id);
    if (!order)
        fail(404, '订单不存在');
    if (amount !== undefined && order!.total !== amount)
        fail(400, '支付金额与订单不一致');
    if (order!.status === 'fulfilled') {
        const payment = await first<{
            payment_ref: string;
            payment_provider: string;
        }>(db, 'SELECT payment_ref,payment_provider FROM orders WHERE id=?', id);
        if (payment!.payment_ref !== reference || payment!.payment_provider !== provider)
            fail(409, '订单已由其他交易付款');
        return { ok: true, idempotent: true };
    }
    if (order!.status !== 'pending' || order!.expires_at <= now())
        fail(409, '订单已过期或无法确认付款');
    const ts = now();
    try {
        await db.batch([
            ...extra,
            stmt(db, "UPDATE orders SET status='paid',paid_at=?,payment_provider=?,payment_ref=? WHERE id=? AND status='pending' AND expires_at>?", ts, provider, reference, id, ts),
            stmt(db, "UPDATE inventory SET status='delivered' WHERE order_id=? AND status='reserved' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='paid')", id, id),
            ...fulfillmentGuard(db, id, provider, reference),
            stmt(db, "UPDATE orders SET status='fulfilled',fulfilled_at=? WHERE id=? AND status='paid'", ts, id), audit(db, actor, 'order.fulfill', id, reason)
        ]);
    }
    catch {
        fail(409, '发货失败：库存状态或交易流水冲突，请核对订单');
    }
    const final = await first<{
        status: string;
    }>(db, 'SELECT status FROM orders WHERE id=?', id);
    if (final!.status !== 'fulfilled')
        fail(409, '订单状态已变化，请刷新确认');
    return { ok: true };
}
async function seed(db: D1Database, env: RuntimeEnv, actor: string) {
    if (env.DEMO_MODE !== 'true')
        fail(403, '只有演示环境可以导入演示商品');
    if (!env.INVENTORY_KEY)
        fail(503, '库存加密密钥未配置');
    const ts = now();
    const statements: D1PreparedStatement[] = [];
    categorySeed.forEach(([id, name, icon], i) => statements.push(stmt(db, 'INSERT OR IGNORE INTO categories VALUES(?,?,?,?,1)', id, name, icon, i)));
    for (const [id, category, name, subtitle, tag, region, price, compare, label] of productSeed) {
        statements.push(stmt(db, 'INSERT OR IGNORE INTO products(id,category_id,name,subtitle,description,instructions,price,compare_price,min_qty,max_qty,featured,active,region,tag,is_example,created_at) VALUES(?,?,?,?,?,?,?,?,1,20,?,1,?,?,1,?)', id, category, name, subtitle, `这是用于展示商城流程的示例商品，不提供真实的第三方账号或授权。正式经营时请替换为有权销售的商品。`, '下单前确认商品适用地区及使用要求。演示卡密仅用于测试系统。', price, compare, label === '热门推荐' ? 1 : 0, region, tag, ts));
        for (let n = 0; n < 1; n++) {
            const code = `DEMO-${id}-${n + 1}`;
            statements.push(stmt(db, 'INSERT OR IGNORE INTO inventory(id,product_id,ciphertext,fingerprint,status,order_id,created_at) VALUES(?,?,?,?,\'available\',NULL,?)', uid(), id, await encrypt(code, env.INVENTORY_KEY!, id as string), await sha(`${id}:${code}`), ts));
        }
    }
    for (const [key, value] of Object.entries({ brand: '重启', tagline: '让每一份数字价值，触手可及。', announcement: '购买前请确认商品适用地区与使用说明。支付接口正在筹备，当前为演示环境。', support: '请通过订单页面提交售后工单', businessHours: '工作日 09:00–18:00', footer: '数字商品交付平台', terms: '购买前请确认商品说明、适用地区及使用条件。数字商品交付后，如有质量问题请凭订单号提交售后工单。', privacy: '仅收集履行订单必需的联系信息。查询密钥用于验证订单访问权限。联系信息仅供客服处理订单使用。' }))
        statements.push(stmt(db, 'INSERT OR IGNORE INTO settings VALUES(?,?)', key, value));
    statements.push(audit(db, actor, 'demo.seed', 'catalog'));
    await db.batch(statements);
    return { ok: true };
}
export async function handleApi(request: Request, env: RuntimeEnv): Promise<Response> {
    try {
        const db = database(env), url = new URL(request.url), path = url.pathname.replace(/^\/api\//, ''), method = request.method;
        if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method))
            fail(405, '请求方法不支持');
        if (method !== 'GET' && path !== 'payments/webhook') {
            const origin = request.headers.get('origin');
            if (origin !== url.origin)
                fail(403, '请求来源不正确');
            if (!request.headers.get('content-type')?.startsWith('application/json'))
                fail(415, '请使用 JSON 格式提交');
        }
        if (path === 'health' && method === 'GET') {
            await first(db, 'SELECT count(*) as n FROM products');
            return json({ ok: true, database: true });
        }
        if (path === 'catalog' && method === 'GET')
            return json(await catalog(db, env));
        if (path === 'auth/status' && method === 'GET') {
            const count = await first<{
                n: number;
            }>(db, 'SELECT count(*) AS n FROM staff');
            return json({ initialized: !!count!.n, demo: env.DEMO_MODE === 'true' });
        }
        if (path === 'auth/setup' && method === 'POST') {
            await limit(db, request, 'setup', 5);
            const b = await body(request);
            if (!env.BOOTSTRAP_TOKEN || !safeEqual(str(b.token, 128), env.BOOTSTRAP_TOKEN))
                fail(403, '初始化令牌不正确');
            if (!/^[a-zA-Z0-9_-]{3,32}$/.test(b.username || '') || typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128)
                fail(400, '账号需为 3–32 位字母或数字，密码至少 12 位');
            const id = uid();
            try {
                await db.batch([stmt(db, "INSERT INTO staff SELECT ?,?,?,'owner',1,? WHERE NOT EXISTS(SELECT 1 FROM staff)", id, b.username, await hashPassword(b.password), now()), audit(db, id, 'auth.setup', 'owner')]);
            }
            catch {
                fail(409, '管理员已初始化');
            }
            const person = await first(db, 'SELECT id FROM staff WHERE id=?', id);
            if (!person)
                fail(409, '管理员已初始化');
            return loginSession(db, id);
        }
        if (path === 'auth/login' && method === 'POST') {
            await limit(db, request, 'login', 8);
            const b = await body(request);
            const s = await first<Staff & {
                password_hash: string;
            }>(db, 'SELECT * FROM staff WHERE username=? AND active=1', str(b.username, 32));
            const hash = s?.password_hash || await hashPassword('constant-time-dummy');
            if (typeof b.password !== 'string' || b.password.length > 128 || !await verifyPassword(b.password, hash) || !s)
                fail(401, '账号或密码不正确');
            return loginSession(db, s!.id);
        }
        if (path === 'auth/demo' && method === 'POST') {
            if (env.DEMO_MODE !== 'true')
                fail(403, '生产环境不提供演示入口');
            await limit(db, request, 'demo', 10);
            const id = 'demo-owner';
            await stmt(db, "INSERT OR IGNORE INTO staff VALUES(?,'demo',?,'owner',1,?)", id, await hashPassword(randomToken()), now()).run();
            await seed(db, env, id);
            return loginSession(db, id);
        }
        if (path === 'auth/me' && method === 'GET')
            return json(await authenticated(db, request));
        if (path === 'auth/logout' && method === 'POST') {
            const p = await authenticated(db, request);
            await stmt(db, 'DELETE FROM sessions WHERE staff_id=? AND csrf=?', p.id, p.csrf).run();
            return json({ ok: true }, 200, { 'Set-Cookie': 'cq_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
        }
        if (path === 'orders' && method === 'POST') {
            await limit(db, request, 'order', 10);
            await expire(db);
            const b = await body(request), contact = str(b.contact, 100);
            if (!contact || !Array.isArray(b.items) || !b.items.length || b.items.length > 12)
                fail(400, '请填写联系方式并选择商品');
            if (b.acceptedTerms !== true)
                fail(400, '请阅读并同意购买说明');
            const combined = new Map<string, number>();
            for (const item of b.items) {
                const id = str(item.id, 64);
                const qty = integer(item.quantity, 1, 100);
                combined.set(id, (combined.get(id) || 0) + qty);
            }
            const lines: {
                p: Product;
                q: number;
            }[] = [];
            for (const [id, q] of combined) {
                const p = await first<Product>(db, productQuery + ' WHERE p.id=? AND p.active=1 AND p.category_id IN(SELECT id FROM categories WHERE active=1)', id);
                if (!p)
                    fail(400, '商品已下架');
                if (p!.is_example && env.DEMO_MODE !== 'true')
                    fail(400, '示例商品不能进行正式交易');
                if (q < p!.min_qty || q > p!.max_qty || q > p!.stock)
                    fail(409, `${p!.name} 库存不足或数量超限`);
                lines.push({ p: p!, q });
            }
            const total = lines.reduce((sum, l) => sum + l.p.price * l.q, 0);
            const id = 'CQ' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + randomToken().slice(0, 12).toUpperCase(), secret = randomToken(), ts = now();
            const statements = [stmt(db, 'INSERT INTO orders(id,lookup_hash,contact,total,status,ready,demo,created_at,expires_at) VALUES(?,?,?,?,\'pending\',0,?,?,?)', id, await sha(secret), contact, total, env.DEMO_MODE === 'true' ? 1 : 0, ts, ts + 15 * 60000)];
            for (const { p, q } of lines) {
                statements.push(stmt(db, 'INSERT INTO order_items VALUES(?,?,?,?,?,?)', uid(), id, p.id, p.name, p.price, q));
                statements.push(stmt(db, "UPDATE inventory SET status='reserved',order_id=? WHERE id IN(SELECT id FROM inventory WHERE product_id=? AND status='available' ORDER BY created_at,id LIMIT ?)", id, p.id, q));
            }
            statements.push(...reservationGuard(db, id), stmt(db, 'UPDATE orders SET ready=1 WHERE id=?', id));
            try {
                await db.batch(statements);
            }
            catch {
                fail(409, '库存或商品已变化，请刷新后重新下单');
            }
            return json({ id, secret, total, expires_at: ts + 15 * 60000, demo: env.DEMO_MODE === 'true' }, 201);
        }
        if (path === 'orders/lookup' && method === 'POST') {
            await limit(db, request, 'lookup', 20);
            await expire(db);
            const b = await body(request);
            return json(await lookup(db, env, str(b.id, 64), str(b.secret, 128)));
        }
        if (path === 'orders/cancel' && method === 'POST') {
            const b = await body(request);
            await lookup(db, env, str(b.id, 64), str(b.secret, 128));
            await db.batch([stmt(db, "UPDATE orders SET status='cancelled' WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM payment_invoices WHERE order_id=?)", b.id, b.id), stmt(db, "UPDATE inventory SET status='available',order_id=NULL WHERE order_id=? AND status='reserved' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='cancelled')", b.id, b.id)]);
            if (await invoiceForOrder(db, b.id)) fail(409, '支付单已生成，系统会在到账核验结束后自动关闭未付款订单');
            return json({ ok: true });
        }
        if (path === 'tickets' && method === 'POST') {
            await limit(db, request, 'ticket', 10);
            const b = await body(request);
            await lookup(db, env, str(b.orderId, 64), str(b.secret, 128));
            const subject = str(b.subject, 100), message = str(b.message, 2000);
            if (!subject || message.length < 5)
                fail(400, '请填写问题主题和详细说明');
            const id = uid();
            await stmt(db, 'INSERT INTO tickets VALUES(?,?,?,?,\'open\',\'\',?,?)', id, b.orderId, subject, message, now(), now()).run();
            return json({ ok: true, id }, 201);
        }
        if (path === 'payments/create' && method === 'POST') {
            await limit(db, request, 'payment-create', 10);
            const b = await body(request);
            const order = await lookup(db, env, str(b.id, 64), str(b.secret, 128));
            return json(await createInvoice(db, env, order));
        }
        if (path === 'payments/check' && method === 'POST') {
            await limit(db, request, 'payment-check', 20);
            const b = await body(request), id = str(b.id, 64), secret = str(b.secret, 128);
            const order = await lookup(db, env, id, secret);
            if (!order.payment) fail(409, '请先生成 USDT 支付单');
            let message = '已检查链上到账，尚未确认时请稍后再查，请勿重复付款。';
            if (b.txId) message = (await checkTransaction(db, env, id, str(b.txId, 100), settleOrder)).message;
            else await reconcilePayments(env, settleOrder, order.payment!.address);
            await expire(db);
            return json({ order: await lookup(db, env, id, secret), message });
        }
        if (path === 'payments/webhook' && method === 'POST') {
            if (!env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_PROVIDER !== 'custom-hmac')
                fail(503, '支付回调未启用');
            await limit(db, request, 'webhook', 60);
            const raw = await request.text();
            if (raw.length > 10000)
                fail(413, '回调内容过大');
            const timestamp = request.headers.get('x-payment-timestamp') || '', signature = request.headers.get('x-payment-signature') || '';
            if (!/^\d{10}$/.test(timestamp) || Math.abs(now() / 1000 - Number(timestamp)) > 300 || !safeEqual(signature, await hmac(`${timestamp}.${raw}`, env.PAYMENT_WEBHOOK_SECRET!)))
                fail(401, '支付签名无效');
            let b: any;
            try {
                b = JSON.parse(raw);
            }
            catch {
                fail(400, '回调内容无效');
            }
            if (b.status !== 'paid' || b.currency !== 'CNY' || !Number.isInteger(b.amount) || !str(b.transactionId, 100))
                fail(400, '支付结果无效');
            await expire(db);
            return json(await settleOrder(db, str(b.orderId, 64), 'payment', '已验证自定义 HMAC 回调', 'custom-hmac', str(b.transactionId, 100), b.amount));
        }
        if (path.startsWith('admin/')) {
            const roleMap: Record<string, string[]> = { products: ['owner', 'operator'], inventory: ['owner', 'operator'], categories: ['owner', 'operator'], settings: ['owner'], staff: ['owner'], audits: ['owner'], payment: ['owner'] };
            const section = path.split('/')[1], p = await authenticated(db, request, roleMap[section]);
            await expire(db);
            if (section === 'payment' && method === 'GET') return json(await paymentDashboard(db, env));
            if (section === 'payment' && method === 'POST') {
                await limit(db, request, 'admin-payment', 10);
                const b = await body(request);
                const result = b.txId ? await checkTransaction(db, env, str(b.orderId, 64), str(b.txId, 100), settleOrder) : await reconcilePayments(env, settleOrder);
                await audit(db, p.id, 'payment.reconcile', str(b.orderId, 64) || 'wallet').run();
                return json(result);
            }
            if (section === 'overview' && method === 'GET') {
                const stats = await first(db, "SELECT count(*) AS orders, coalesce(sum(CASE WHEN status='fulfilled' THEN total ELSE 0 END),0) AS revenue, sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) AS fulfilled FROM orders");
                const stock = await first(db, "SELECT count(*) AS stock FROM inventory WHERE status='available'");
                const tickets = await first(db, "SELECT count(*) AS tickets FROM tickets WHERE status='open'");
                const trend = await all(db, "SELECT date(created_at/1000,'unixepoch','+8 hours') AS day, count(*) AS orders, sum(CASE WHEN status='fulfilled' THEN total ELSE 0 END) AS revenue FROM orders WHERE created_at>? GROUP BY day ORDER BY day", now() - 7 * 86400000);
                return json({ stats: { ...stats, ...stock, ...tickets }, trend, recent: await all(db, 'SELECT id,contact,total,status,created_at,demo FROM orders ORDER BY created_at DESC LIMIT 8'), lowStock: await all(db, productQuery + " WHERE p.active=1 AND (SELECT count(*) FROM inventory i WHERE i.product_id=p.id AND i.status='available')<10 LIMIT 10"), demo: env.DEMO_MODE === 'true' });
            }
            if (section === 'products' && method === 'GET')
                return json({ products: await all(db, productQuery + ' ORDER BY created_at DESC'), categories: await all(db, 'SELECT * FROM categories ORDER BY sort') });
            if (section === 'products' && method === 'POST') {
                const b = await body(request), id = str(b.id, 64) || uid(), name = str(b.name, 120), category = str(b.category_id, 64);
                if (!name || !await first(db, 'SELECT id FROM categories WHERE id=?', category))
                    fail(400, '商品名称或分类无效');
                const price = integer(b.price, 1, 10000000), min = integer(b.min_qty, 1, 100), max = integer(b.max_qty, min, 100);
                await db.batch([stmt(db, `INSERT INTO products(id,category_id,name,subtitle,description,instructions,price,compare_price,min_qty,max_qty,featured,active,region,tag,is_example,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,name=excluded.name,subtitle=excluded.subtitle,description=excluded.description,instructions=excluded.instructions,price=excluded.price,compare_price=excluded.compare_price,min_qty=excluded.min_qty,max_qty=excluded.max_qty,featured=excluded.featured,active=excluded.active,region=excluded.region,tag=excluded.tag`, id, category, name, str(b.subtitle, 150), str(b.description, 4000), str(b.instructions, 4000), price, integer(b.compare_price || 0, 0, 10000000), min, max, b.featured ? 1 : 0, b.active ? 1 : 0, str(b.region, 30), str(b.tag, 30), now()), audit(db, p.id, 'product.save', id, name)]);
                return json({ ok: true, id });
            }
            if (section === 'categories' && method === 'GET')
                return json(await all(db, 'SELECT * FROM categories ORDER BY sort'));
            if (section === 'categories' && method === 'POST') {
                const b = await body(request), id = str(b.id, 64) || uid(), name = str(b.name, 50);
                if (!name)
                    fail(400, '请输入分类名称');
                await db.batch([stmt(db, 'INSERT INTO categories VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,icon=excluded.icon,sort=excluded.sort,active=excluded.active', id, name, str(b.icon, 20) || 'box', integer(b.sort || 0, 0, 1000), b.active ? 1 : 0), audit(db, p.id, 'category.save', id, name)]);
                return json({ ok: true });
            }
            if (section === 'inventory' && method === 'GET')
                return json({ products: await all(db, productQuery), batches: await all(db, 'SELECT product_id,status,count(*) AS count FROM inventory GROUP BY product_id,status') });
            if (section === 'inventory' && method === 'POST') {
                const b = await body(request), productId = str(b.product_id, 64);
                if (!await first(db, 'SELECT id FROM products WHERE id=?', productId))
                    fail(404, '商品不存在');
                if (!env.INVENTORY_KEY)
                    fail(503, '库存加密密钥未配置');
                const codes = String(b.codes || '').split('\n').map(s => s.trim()).filter(Boolean);
                if (!codes.length || codes.length > 30 || codes.some(c => c.length > 2000))
                    fail(400, '每次导入 1–30 条，每行一个，单条最多 2000 字');
                let imported = 0;
                const statements = [];
                for (const code of new Set(codes)) {
                    const fingerprint = await sha(`${productId}:${code}`);
                    statements.push(stmt(db, "INSERT OR IGNORE INTO inventory VALUES(?,?,?,?,'available',NULL,?)", uid(), productId, await encrypt(code, env.INVENTORY_KEY!, productId), fingerprint, now()));
                }
                const results = await db.batch([...statements, audit(db, p.id, 'inventory.import', productId, `提交 ${codes.length} 条`)]);
                results.slice(0, -1).forEach(r => imported += r.meta.changes);
                return json({ ok: true, imported, skipped: codes.length - imported });
            }
            if (section === 'orders' && method === 'GET') {
                const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1)), search = str(url.searchParams.get('q'), 100), status = str(url.searchParams.get('status'), 20);
                const where = ' WHERE id LIKE ? AND (?=\'\' OR status=?)';
                return json({ orders: await all(db, 'SELECT id,contact,total,status,created_at,expires_at,demo FROM orders' + where + ' ORDER BY created_at DESC LIMIT 50 OFFSET ?', `%${search}%`, status, status, (page - 1) * 50), total: (await first<{
                        n: number;
                    }>(db, 'SELECT count(*) AS n FROM orders' + where, `%${search}%`, status, status))!.n, page });
            }
            if (section === 'orders' && method === 'POST') {
                if (p.role !== 'owner')
                    fail(403, '仅店主可以确认收款');
                const b = await body(request);
                if (str(b.reason, 300).length < 5 || !str(b.reference, 100))
                    fail(400, '请填写收款依据和唯一流水号');
                if (b.action === 'refund') {
                    if (!await first(db, "SELECT id FROM orders WHERE id=? AND status='fulfilled'", str(b.id, 64)))
                        fail(409, '仅已发货订单可登记退款');
                    await db.batch([stmt(db, "UPDATE orders SET status='refunded' WHERE id=? AND status='fulfilled'", str(b.id, 64)), audit(db, p.id, 'order.refund', str(b.id, 64), str(b.reason, 300) + ' / ' + str(b.reference, 100))]);
                    return json({ ok: true });
                }
                return json(await settleOrder(db, str(b.id, 64), p.id, str(b.reason, 300), env.DEMO_MODE === 'true' ? 'demo-manual' : 'manual', str(b.reference, 100)));
            }
            if (section === 'tickets' && method === 'GET')
                return json(await all(db, 'SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200'));
            if (section === 'tickets' && method === 'POST') {
                const b = await body(request);
                if (!str(b.reply, 2000))
                    fail(400, '请输入回复内容');
                if (!await first(db, 'SELECT id FROM tickets WHERE id=?', str(b.id, 64)))
                    fail(404, '工单不存在');
                await db.batch([stmt(db, 'UPDATE tickets SET reply=?,status=?,updated_at=? WHERE id=?', str(b.reply, 2000), b.closed ? 'closed' : 'open', now(), str(b.id, 64)), audit(db, p.id, 'ticket.reply', str(b.id, 64))]);
                return json({ ok: true });
            }
            if (section === 'settings' && method === 'GET')
                return json(Object.fromEntries((await all<{
                    key: string;
                    value: string;
                }>(db, 'SELECT * FROM settings')).map(s => [s.key, s.value])));
            if (section === 'settings' && method === 'POST') {
                const b = await body(request), keys = ['brand', 'tagline', 'announcement', 'support', 'businessHours', 'footer', 'terms', 'privacy'];
                const statements = keys.filter(k => typeof b[k] === 'string').map(k => stmt(db, 'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, str(b[k], 4000)));
                await db.batch([...statements, audit(db, p.id, 'settings.save', 'site')]);
                return json({ ok: true });
            }
            if (section === 'staff' && method === 'GET')
                return json(await all(db, 'SELECT id,username,role,active,created_at FROM staff'));
            if (section === 'staff' && method === 'POST') {
                const b = await body(request), id = str(b.id, 64);
                if (id) {
                    const existing = await first<Staff>(db, 'SELECT * FROM staff WHERE id=?', id);
                    if (!existing)
                        fail(404, '员工不存在');
                    if (existing!.role === 'owner')
                        fail(403, '店主账号不能在此停用');
                    await db.batch([stmt(db, 'UPDATE staff SET active=? WHERE id=?', b.active ? 1 : 0, id), stmt(db, 'DELETE FROM sessions WHERE staff_id=?', id), audit(db, p.id, 'staff.status', id)]);
                    return json({ ok: true });
                }
                if (!/^[a-zA-Z0-9_-]{3,32}$/.test(b.username || '') || typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128 || !['operator', 'support'].includes(b.role))
                    fail(400, '账号或密码无效，员工角色必须为运营或客服');
                try {
                    const staffId = uid();
                    await db.batch([stmt(db, 'INSERT INTO staff VALUES(?,?,?,?,1,?)', staffId, b.username, await hashPassword(b.password), b.role, now()), audit(db, p.id, 'staff.create', staffId, b.role)]);
                }
                catch {
                    fail(409, '账号已存在');
                }
                return json({ ok: true });
            }
            if (section === 'password' && method === 'POST') {
                const b = await body(request), s = await first<{
                    password_hash: string;
                }>(db, 'SELECT password_hash FROM staff WHERE id=?', p.id);
                if (typeof b.old !== 'string' || !await verifyPassword(b.old, s!.password_hash))
                    fail(400, '原密码不正确');
                if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128)
                    fail(400, '新密码需为 12–128 位');
                await db.batch([stmt(db, 'UPDATE staff SET password_hash=? WHERE id=?', await hashPassword(b.password), p.id), stmt(db, 'DELETE FROM sessions WHERE staff_id=?', p.id), audit(db, p.id, 'password.change', p.id)]);
                return json({ ok: true });
            }
            if (section === 'audits' && method === 'GET')
                return json(await all(db, 'SELECT a.*, coalesce(s.username,a.actor) AS actor_name FROM audits a LEFT JOIN staff s ON a.actor=s.id ORDER BY a.created_at DESC LIMIT 200'));
            if (section === 'seed' && method === 'POST') {
                if (p.role !== 'owner')
                    fail(403, '仅店主可以导入');
                return json(await seed(db, env, p.id));
            }
        }
        fail(404, '接口不存在');
    }
    catch (error) {
        if (error instanceof ApiError || error instanceof PaymentError)
            return json({ error: error.message }, error.status);
        console.error('commerce request failed', error instanceof Error ? error.message : 'unknown');
        return json({ error: '服务暂时不可用，请稍后重试或联系管理员' }, 500);
    }
}

// Cloudflare Cron invokes this while customer pages are closed.
export async function runPaymentReconciliation(env: RuntimeEnv) {
    if (!env.DB || env.DEMO_MODE === 'true' || !env.TRONGRID_API_KEY) return;
    try { await reconcilePayments(env, settleOrder); }
    finally { await expire(env.DB); }
}
