'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RotateCw, Search, ShoppingBag, ShieldCheck, Zap, Headphones, Send, Globe, Sparkles, Code2, FileText, Box, Apple, AtSign as Twitter, ChevronRight, X, Minus, Plus, ArrowUpRight, Check, Copy, SlidersHorizontal, PackageCheck, Clock3, AlertCircle, ExternalLink, Menu } from 'lucide-react';
import { api, money, date, statuses } from '@/lib/commerce/client';
import UsdtPayment from './usdt-payment';
import type { Catalog, Product, Order } from '@/lib/commerce/types';
const icons: Record<string, any> = { send: Send, twitter: Twitter, apple: Apple, globe: Globe, sparkles: Sparkles, code: Code2, file: FileText, headphones: Headphones, box: Box };
const colors: Record<string, string> = { telegram: 'blue', twitter: 'dark', apple: 'gray', google: 'green', ai: 'purple', software: 'orange', digital: 'pink', service: 'teal' };
function ProductIcon({ product, large = false }: {
    product: Product;
    large?: boolean;
}) {
    const Icon = icons[({ telegram: 'send', twitter: 'twitter', apple: 'apple', google: 'globe', ai: 'sparkles', software: 'code', digital: 'file', service: 'headphones' } as Record<string, string>)[product.category_id]] || Box;
    return <div className={`product-icon ${colors[product.category_id] || 'purple'} ${large ? 'large' : ''}`}><Icon size={large ? 46 : 25}/></div>;
}
export default function Store({ initialPage = 'shop', initialProduct }: {
    initialPage?: string;
    initialProduct?: string;
}) {
    const [catalog, setCatalog] = useState<Catalog | null>(null), [error, setError] = useState(''), [page, setPage] = useState(initialPage), [category, setCategory] = useState('all'), [search, setSearch] = useState(''), [sort, setSort] = useState('recommended'), [stockOnly, setStockOnly] = useState(false), [mobileMenu, setMobileMenu] = useState(false);
    const [cart, setCart] = useState<Record<string, number>>({}), [drawer, setDrawer] = useState(false), [selected, setSelected] = useState<Product | null>(null), [qty, setQty] = useState(1), [notice, setNotice] = useState(''), [contact, setContact] = useState(''), [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<any>(null);
    const [orderId, setOrderId] = useState(''), [secret, setSecret] = useState(''), [order, setOrder] = useState<Order | null>(null), [recent, setRecent] = useState<{
        id: string;
        secret: string;
    }[]>([]), [ticketOpen, setTicketOpen] = useState(false), [ticketSubject, setTicketSubject] = useState(''), [ticketMessage, setTicketMessage] = useState(''), [policy, setPolicy] = useState<string | null>(null);
    async function refresh() {
        try {
            setCatalog(await api<Catalog>('catalog'));
            setError('');
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    useEffect(() => {
        refresh();
        try {
            setCart(JSON.parse(localStorage.getItem('cq-cart') || '{}'));
            setRecent(JSON.parse(localStorage.getItem('cq-recent') || '[]'));
        }
        catch {
        }
    }, []);
    useEffect(() => {
        if (initialProduct && catalog) {
            const p = catalog.products.find(x => x.id === initialProduct);
            if (p) {
                setSelected(p);
                setQty(p.min_qty);
            }
        }
    }, [initialProduct, catalog]);
    useEffect(() => {
        if (notice) {
            const t = setTimeout(() => setNotice(''), 3500);
            return () => clearTimeout(t);
        }
    }, [notice]);
    function updateCart(next: Record<string, number>) {
        setCart(next);
        localStorage.setItem('cq-cart', JSON.stringify(next));
    }
    function add(p: Product, q = 1) {
        if (!p.stock)
            return;
        updateCart({ ...cart, [p.id]: Math.min(p.max_qty, p.stock, (cart[p.id] || 0) + q) });
        setNotice('已加入购物车');
    }
    function navigate(next: string) {
        setPage(next);
        setMobileMenu(false);
        setError('');
        history.replaceState(null, '', next === 'shop' ? '/' : '/' + next);
        window.scrollTo({ top: 0 });
    }
    const filtered = useMemo(() => {
        let list = (catalog?.products || []).filter(p => (category === 'all' || p.category_id === category) && (p.name + p.subtitle + p.region + p.tag).toLowerCase().includes(search.toLowerCase()) && (!stockOnly || p.stock > 0));
        return [...list].sort((a, b) => sort === 'price-asc' ? a.price - b.price : sort === 'price-desc' ? b.price - a.price : sort === 'newest' ? b.created_at - a.created_at : b.featured - a.featured);
    }, [catalog, category, search, sort, stockOnly]);
    const cartLines = Object.entries(cart).map(([id, q]) => ({ p: catalog?.products.find(p => p.id === id), q })).filter(x => x.p) as {
        p: Product;
        q: number;
    }[], total = cartLines.reduce((v, l) => v + l.p.price * l.q, 0), cartCount = cartLines.reduce((v, l) => v + l.q, 0);
    async function checkout() {
        setBusy(true);
        try {
            const r = await api('orders', { contact, acceptedTerms: accepted, items: cartLines.map(l => ({ id: l.p.id, quantity: l.q })) });
            setReceipt(r);
            const next = [{ id: r.id, secret: r.secret }, ...recent].slice(0, 20);
            setRecent(next);
            localStorage.setItem('cq-recent', JSON.stringify(next));
            updateCart({});
            setDrawer(false);
            setSelected(null);
            setOrderId(r.id);
            setSecret(r.secret);
            await refresh();
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function lookup(id = orderId, key = secret) {
        setBusy(true);
        setError('');
        try {
            setOrder(await api<Order>('orders/lookup', { id, secret: key }));
            setOrderId(id);
            setSecret(key);
        }
        catch (e) {
            setError((e as Error).message);
            setOrder(null);
        }
        finally {
            setBusy(false);
        }
    }
    async function copy(s: string) {
        try {
            await navigator.clipboard.writeText(s);
            setNotice('已复制');
        }
        catch {
            setNotice('复制失败，请手动选择文本');
        }
    }
    function download(s: string, name: string) {
        const url = URL.createObjectURL(new Blob([s], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }
    return <div className="store"><div className="topline"><span><ShieldCheck size={13}/> 数字商品 · 安心交付</span><span>中文服务 <i /> 人民币 CNY</span></div>
    <header className="store-header"><div className="header-inner"><a className="brand" href="/" onClick={e => {
        e.preventDefault();
        navigate('shop');
    }}><span className="brand-mark"><RotateCw size={23}/></span><span>{catalog?.settings.brand || '重启'}<small>RESTART</small></span></a><nav className={mobileMenu ? 'open' : ''}>{[['shop', '商品商城'], ['orders', '订单查询'], ['help', '帮助中心']].map(([key, label]) => <a key={key} className={page === key ? 'active' : ''} href={key === 'shop' ? '/' : '/' + key} onClick={e => {
        e.preventDefault();
        navigate(key);
    }}>{label}</a>)}</nav><div className="header-actions"><a href="/admin" className="admin-link">商家后台 <ArrowUpRight size={14}/></a><button className="cart-button" onClick={() => setDrawer(true)}><ShoppingBag size={18}/><span>购物车</span>{cartCount > 0 && <b>{cartCount}</b>}</button><button className="icon-button menu-button" aria-label="打开菜单" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20}/></button></div></div></header>
    <main className="store-main">{page === 'shop' ? <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow"><span /> RESTART DIGITAL STORE</div><h1>数字生活，<br /><em>从这里重启。</em></h1><p>{catalog?.settings.tagline || '让每一份数字价值，触手可及。'}<br />精选数字资源与订阅服务，便捷购买，清晰交付。</p><button className="primary" onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>探索全部商品 <ArrowRight size={17}/></button><div className="hero-proof"><span><Zap size={15}/> 自助购买</span><span><ShieldCheck size={15}/> 订单保障</span><span><Headphones size={15}/> 中文支持</span></div></div><div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="digital-card"><div className="digital-top"><span className="brand-mark"><RotateCw size={22}/></span><span>DIGITAL PASS</span><ArrowUpRight size={21}/></div><div className="digital-dots">● ● ● ● <span>● ● ● ●</span></div><div className="digital-title">开启更多可能</div><div className="digital-bottom"><span>RESTART · 数字权益</span><Sparkles size={24}/></div></div><div className="floating-label"><span className="success-circle"><Check size={15}/></span><div>数字价值，即刻连接<small>一个平台，多种可能</small></div></div><div className="hero-star">✳</div></div></section>
        <div className="announcement"><span className="announcement-label"><AlertCircle size={16}/> 商城公告</span><p>{catalog?.settings.announcement || '下单前请仔细查看商品说明与使用条件。'}</p><a href="/help" onClick={e => {
            e.preventDefault();
            navigate('help');
        }}>购买须知 <ChevronRight size={15}/></a></div>
        <section className="catalog-layout" id="catalog"><aside className="catalog-sidebar"><div className="sidebar-heading">商品分类 <span>{catalog?.categories.length || 0}</span></div><button className={category === 'all' ? 'category active' : 'category'} onClick={() => setCategory('all')}><Box size={17}/> 全部商品 <span>{catalog?.products.length || 0}</span></button>{catalog?.categories.map(c => {
            const Icon = icons[c.icon] || Box;
            return <button key={c.id} className={category === c.id ? 'category active' : 'category'} onClick={() => setCategory(c.id)}><Icon size={17}/> {c.name}<span>{catalog.products.filter(p => p.category_id === c.id).length}</span></button>;
        })}<div className="sidebar-help"><Headphones size={25}/><h4>选购遇到问题？</h4><p>查看购买指南，<br />或提交订单售后工单。</p><button onClick={() => navigate('help')}>前往帮助中心 <ArrowRight size={14}/></button></div></aside><div className="catalog-content"><div className="catalog-heading"><div><h2>{category === 'all' ? '精选数字商品' : catalog?.categories.find(c => c.id === category)?.name}</h2><p>找到适合你的下一份数字体验</p></div>{catalog?.demo && <span className="tag muted"><span className="small-dot"/> 演示商城 · 示例商品</span>}</div><div className="catalog-tools"><label className="search-input"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索商品、地区或关键词"/>{search && <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={14}/></button>}</label><select aria-label="商品排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">推荐排序</option><option value="price-asc">价格从低到高</option><option value="price-desc">价格从高到低</option><option value="newest">最新上架</option></select><label className="stock-filter"><input type="checkbox" checked={stockOnly} onChange={e => setStockOnly(e.target.checked)}/> 仅看有货</label></div><div className="result-count">共 <strong>{filtered.length}</strong> 件商品 <span>价格以人民币计价</span></div>
        {error ? <div className="empty"><AlertCircle size={30}/><h3>暂时无法加载商品</h3><p>{error}</p><button className="secondary" onClick={refresh}>重试</button></div> : !catalog ? <div className="product-grid">{[1, 2, 3, 4, 5, 6].map(x => <div key={x} className="product-card skeleton"/>)}</div> : !filtered.length ? <div className="empty"><Search size={34}/><h3>{catalog.products.length ? '没有找到相关商品' : '商城正在准备中'}</h3><p>{catalog.products.length ? '试试其他关键词，或查看全部分类。' : '商家完成商品上架后，商品会显示在这里。'}</p><button className="secondary" onClick={() => {
            setSearch('');
            setCategory('all');
            setStockOnly(false);
        }}>查看全部商品</button></div> : <div className="product-grid">{filtered.map(p => <article key={p.id} className="product-card"><div className="product-card-top"><ProductIcon product={p}/><span className={`tag ${p.featured ? 'violet' : 'muted'}`}>{p.featured ? '热门推荐' : p.tag || '精选商品'}</span></div><button className="product-title" onClick={() => {
            setSelected(p);
            setQty(p.min_qty);
        }}>{p.name}</button><p className="product-subtitle">{p.subtitle}</p><div className="product-meta"><span><Globe size={12}/>{p.region}</span><span><Zap size={12}/>卡密交付</span></div><div className="product-card-bottom"><div><span className="price">{money(p.price)}</span>{p.compare_price > p.price && <del>{money(p.compare_price)}</del>}<small className={p.stock ? 'stock' : 'out-stock'}><span /> {p.stock ? '库存 ' + p.stock : '暂时缺货'}</small></div><button className="buy-button" disabled={!p.stock} onClick={() => {
            setSelected(p);
            setQty(p.min_qty);
        }}>选购 <ArrowRight size={14}/></button></div></article>)}</div>}
        </div></section><section className="benefit-strip">{[[ShieldCheck, '订单访问保护', '凭订单号与密钥安全查询'], [Zap, '自助获取商品', '确认付款后自动交付库存'], [PackageCheck, '清晰的商品说明', '购买前了解适用条件'], [Headphones, '售后服务支持', '每个问题都有处理记录']].map(([Icon, title, desc]: any) => <div key={title}><Icon size={24}/><span><strong>{title}</strong><small>{desc}</small></span></div>)}</section>
        </> : page === 'orders' ? <section className="subpage"><div className="eyebrow">MY ORDERS</div><h1>每一笔订单，都有迹可循。</h1><p className="subpage-lead">输入订单号与查询密钥，查看付款状态、获取商品和申请售后。</p><div className="order-layout"><div><form className="panel lookup-form" onSubmit={e => {
            e.preventDefault();
            lookup();
        }}><h3><Search size={19}/> 查询订单</h3><label>订单号<input required value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="例如 CQ20261012…"/></label><label>查询密钥<input required type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="下单时获得的查询密钥"/></label><button className="primary" disabled={busy}>{busy ? '正在查询…' : '查询我的订单'}<ArrowRight size={16}/></button>{error && <p className="error-text">{error}</p>}</form><div className="panel local-orders"><h3><Clock3 size={18}/> 本机最近订单</h3><p>仅记录在当前浏览器，请妥善保存查询密钥。</p>{recent.length ? recent.map(o => <button key={o.id} onClick={() => lookup(o.id, o.secret)}><span>{o.id}</span><ChevronRight size={16}/></button>) : <div className="small-empty">当前浏览器暂无订单</div>}</div></div><div>{order ? <div className="panel order-detail"><div className="panel-title"><h3>订单详情</h3><span className={'status ' + order.status}>{statuses[order.status]}</span></div><p className="mono">{order.id}</p><div className="order-timeline">{['创建订单', '确认付款', '商品交付'].map((s, i) => <span key={s} className={i === 0 || order.status === 'fulfilled' ? 'done' : ''}><Check size={14}/>{s}</span>)}</div>{order.items.map((i, n) => <div className="order-line" key={n}><span>{i.product_name}<small>数量 × {i.quantity}</small></span><strong>{money(i.price * i.quantity)}</strong></div>)}<div className="order-line total"><span>订单金额</span><strong>{money(order.total)}</strong></div><p className="hint">创建时间：{date(order.created_at)}<br />联系方式：{order.contact}</p>{order.demo === 1 && <div className="info-box">这是演示订单，交付内容为测试卡密。</div>}{(order.status === 'pending' || order.payment) && <UsdtPayment key={order.id} order={order} secret={secret} enabled={!!catalog?.paymentEnabled} onUpdate={setOrder}/>} {order.status === 'pending' && !order.payment && <><p className="hint">订单有效期至 {date(order.expires_at)}</p><button className="secondary" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
                await api('orders/cancel', { id: orderId, secret });
                await lookup();
                await refresh();
            }
            catch (e) {
                setNotice((e as Error).message);
            }
            finally {
                setBusy(false);
            }
        }}>取消订单</button></>}{order.delivery && <div className="delivery-box"><h4><PackageCheck size={18}/> 商品交付内容</h4><pre>{order.delivery.join('\n')}</pre><div className="button-row"><button className="secondary" onClick={() => copy(order.delivery!.join('\n'))}><Copy size={15}/>复制内容</button><button className="secondary" onClick={() => download(order.delivery!.join('\n'), order.id + '.txt')}>下载 TXT</button></div></div>}<button className="text-button" onClick={() => setTicketOpen(true)}>需要帮助？提交售后工单 <ArrowUpRight size={14}/></button>{order.tickets?.map(t => <div className="ticket-card" key={t.id}><strong>{t.subject}<span className={'status ' + t.status}>{statuses[t.status]}</span></strong><p>{t.message}</p>{t.reply && <div className="ticket-reply">客服回复：{t.reply}</div>}</div>)}</div> : <div className="panel empty order-placeholder"><PackageCheck size={52}/><h3>订单信息将在这里显示</h3><p>查询订单后可查看交付内容和售后进度。</p></div>}</div></div></section> : <section className="subpage help-page"><div className="eyebrow">HELP CENTER</div><h1>购买更轻松，使用更安心。</h1><p className="subpage-lead">从选购到交付，找到你需要的答案。</p><div className="help-steps">{[['01', '选择商品', '确认适用地区、商品说明和购买数量。'], ['02', '提交订单', '填写联系方式，保存订单号与查询密钥。'], ['03', '获取商品', '完成付款后，在订单页面查看交付内容。']].map(([n, t, d]) => <div className="panel" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div><div className="help-layout"><div className="panel faq"><h3>常见问题</h3>{[['订单查询密钥是什么？', '查询密钥是你的订单访问凭证。下单成功时会生成，请保存。任何持有订单号与密钥的人都可以查看交付内容，请勿随意分享。'], ['没有收到商品怎么办？', '先在订单查询页面查看状态。付款未确认时不会发货。确认付款后如有异常，请提交售后工单，客服会核对处理。'], ['商品可以退款吗？', '请在下单前查看商品说明。交付后如发现质量问题，可通过订单提交工单，由商家按商品售后约定处理。'], ['如何使用 USDT 付款？', '正式商城启用收款后，在订单页生成支付单，选择 TRON（TRC20）网络，一次性转入页面显示的完整金额。链上确认后交付商品，金额不符或超时到账请提交工单。演示环境不收真实款项。'], ['找不到订单记录怎么办？', '本机记录可能因清理浏览器而丢失，请使用你保存的订单号与查询密钥查询。']].map(([q, a]) => <details key={q}><summary>{q}<Plus size={16}/></summary><p>{a}</p></details>)}</div><div className="panel contact-card"><Headphones size={33}/><h3>我们随时准备提供帮助</h3><p>{catalog?.settings.support || '请通过订单页面提交售后工单'}</p><div><Clock3 size={15}/>{catalog?.settings.businessHours || '工作日 09:00–18:00'}</div><button className="primary" onClick={() => navigate('orders')}>前往订单与售后 <ArrowRight size={16}/></button></div></div></section>}
    </main><footer className="store-footer"><div><a className="brand" href="/"><span className="brand-mark"><RotateCw size={20}/></span><span>{catalog?.settings.brand || '重启'}<small>RESTART</small></span></a><p>{catalog?.settings.footer || '数字商品交付平台'} · 让数字价值触手可及</p></div><div className="footer-links"><button onClick={() => setPolicy('terms')}>购买协议</button><button onClick={() => setPolicy('privacy')}>隐私政策</button><a href="/admin">商家后台 <ArrowUpRight size={12}/></a><small>© {new Date().getFullYear()} RESTART</small></div></footer>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}</div>}
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><div className="modal product-modal" role="dialog" aria-modal="true" aria-label="商品详情" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭" onClick={() => setSelected(null)}><X size={22}/></button><ProductIcon product={selected} large/><span className="tag violet">{selected.tag}</span><h2>{selected.name}</h2><p>{selected.subtitle}</p><div className="detail-price">{money(selected.price)} <span>/ 份</span></div><div className="detail-spec"><span>适用地区 <strong>{selected.region}</strong></span><span>可售库存 <strong>{selected.stock} 份</strong></span></div><h4>商品介绍</h4><p className="pre-wrap">{selected.description}</p><h4>购买须知</h4><p className="pre-wrap">{selected.instructions}</p><div className="quantity-row"><span>购买数量</span><div className="quantity"><button aria-label="减少数量" disabled={qty <= selected.min_qty} onClick={() => setQty(qty - 1)}><Minus size={14}/></button><span>{qty}</span><button aria-label="增加数量" disabled={qty >= Math.min(selected.max_qty, selected.stock)} onClick={() => setQty(qty + 1)}><Plus size={14}/></button></div></div><div className="button-row"><button className="secondary" disabled={!selected.stock} onClick={() => add(selected, qty)}>加入购物车</button><button className="primary" disabled={!selected.stock} onClick={() => {
        add(selected, qty);
        setSelected(null);
        setDrawer(true);
    }}>立即购买 <ArrowRight size={16}/></button></div></div></div>}
    {drawer && <div className="modal-backdrop drawer-backdrop" onClick={() => setDrawer(false)}><aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="购物车" onClick={e => e.stopPropagation()}><div className="drawer-title"><h2><ShoppingBag size={21}/> 我的购物车 <span>{cartCount}</span></h2><button className="icon-button" aria-label="关闭购物车" onClick={() => setDrawer(false)}><X size={22}/></button></div>{cartLines.length ? <><div className="cart-items">{cartLines.map(({ p, q }) => <div className="cart-item" key={p.id}><ProductIcon product={p}/><div><strong>{p.name}</strong><small>{money(p.price)} / 份</small><div className="quantity"><button aria-label="减少" onClick={() => {
        if (q <= p.min_qty) {
            const next = { ...cart };
            delete next[p.id];
            updateCart(next);
        }
        else
            updateCart({ ...cart, [p.id]: q - 1 });
    }}><Minus size={12}/></button><span>{q}</span><button aria-label="增加" disabled={q >= Math.min(p.stock, p.max_qty)} onClick={() => updateCart({ ...cart, [p.id]: q + 1 })}><Plus size={12}/></button></div></div><button className="icon-button" aria-label="删除商品" onClick={() => {
        const next = { ...cart };
        delete next[p.id];
        updateCart(next);
    }}><X size={15}/></button></div>)}</div><div className="cart-checkout"><label>联系方式<input value={contact} onChange={e => setContact(e.target.value)} placeholder="邮箱或其他可联系信息" maxLength={100}/></label><label className="checkbox-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>我已阅读商品说明并同意<button onClick={() => setPolicy('terms')}>购买协议</button></label><div className="cart-total"><span>应付金额</span><strong>{money(total)}</strong></div>{catalog?.demo && <div className="info-box">演示环境：提交测试订单，不收取款项。</div>}<button className="primary" disabled={busy || !accepted || !contact.trim()} onClick={checkout}>{busy ? '正在创建订单…' : '提交订单'} <ArrowRight size={17}/></button><small><ShieldCheck size={12}/> 订单号与查询密钥用于安全获取商品</small></div></> : <div className="empty"><ShoppingBag size={44}/><h3>购物车还是空的</h3><p>去发现值得入手的数字商品。</p><button className="primary" onClick={() => {
        setDrawer(false);
        navigate('shop');
    }}>去逛逛 <ArrowRight size={16}/></button></div>}</aside></div>}
    {receipt && <div className="modal-backdrop"><div className="modal receipt-modal" role="dialog" aria-modal="true" aria-label="订单创建成功"><span className="receipt-icon"><Check size={30}/></span><h2>订单已创建</h2><p>请保存以下信息，凭密钥查询订单与获取商品。</p><div className="credential"><small>订单号</small><code>{receipt.id}</code><small>查询密钥</small><code>{receipt.secret}</code></div><div className="info-box">{receipt.demo ? '这是测试订单，请勿付款。' : catalog?.paymentEnabled ? '订单已保存，前往订单页面使用 TRC20 USDT 付款。' : '商家尚未启用在线收款，请联系商家。'}</div><div className="button-row"><button className="secondary" onClick={() => download(`订单号：${receipt.id}\n查询密钥：${receipt.secret}\n订单金额：${money(receipt.total)}`, receipt.id + '-凭证.txt')}>保存凭证</button><button className="primary" onClick={() => {
        setReceipt(null);
        navigate('orders');
        lookup(receipt.id, receipt.secret);
    }}>查看订单 <ArrowRight size={15}/></button></div></div></div>}
    {ticketOpen && <div className="modal-backdrop" onClick={() => setTicketOpen(false)}><form className="modal" onClick={e => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            await api('tickets', { orderId, secret, subject: ticketSubject, message: ticketMessage });
            setTicketOpen(false);
            setTicketSubject('');
            setTicketMessage('');
            await lookup();
            setNotice('工单已提交');
        }
        catch (e) {
            setNotice((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }}><button type="button" className="modal-close" aria-label="关闭" onClick={() => setTicketOpen(false)}><X /></button><h2>提交售后工单</h2><label>问题主题<input required value={ticketSubject} onChange={e => setTicketSubject(e.target.value)} maxLength={100}/></label><label>详细说明<textarea required minLength={5} value={ticketMessage} onChange={e => setTicketMessage(e.target.value)} rows={5} maxLength={2000}/></label><button className="primary" disabled={busy}>提交工单 <ArrowRight size={15}/></button></form></div>}
    {policy && <div className="modal-backdrop" onClick={() => setPolicy(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="商城协议" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭" onClick={() => setPolicy(null)}><X /></button><h2>{policy === 'terms' ? '购买协议' : '隐私政策'}</h2><p className="pre-wrap">{catalog?.settings[policy] || '商家暂未填写，请联系商家确认。'}</p><button className="primary" onClick={() => setPolicy(null)}>我已了解</button></div></div>}
    </div>;
}
