'use client';
import { useEffect, useState } from 'react';
import { RotateCw, LayoutDashboard, Package, Layers3, KeyRound, ShoppingBag, Headphones, Settings, Users, ShieldCheck, ArrowUpRight, LogOut, Plus, Search, ChevronRight, ArrowRight, Download, AlertCircle, Check, X, RefreshCw, Wallet, Clock3, BarChart3, Lock, Menu, Eye, FileText, TrendingUp } from 'lucide-react';
import { api, money, date, statuses } from '@/lib/commerce/client';
import PaymentPanel from './payment-panel';
import type { Staff, Product, Category } from '@/lib/commerce/types';
const sections = [['overview', '数据概览', LayoutDashboard], ['products', '商品管理', Package], ['categories', '商品分类', Layers3], ['inventory', '卡密库存', KeyRound], ['orders', '订单管理', ShoppingBag], ['tickets', '售后工单', Headphones], ['staff', '员工与权限', Users], ['audits', '操作日志', ShieldCheck], ['settings', '站点设置', Settings], ['payment', '支付接口', Wallet]] as const;
const roleNames: Record<string, string> = { owner: '店主', operator: '运营', support: '客服' };
const blankProduct = { id: '', category_id: '', name: '', subtitle: '', description: '', instructions: '', price: 0, compare_price: 0, min_qty: 1, max_qty: 100, active: 1, featured: 0, region: '全球', tag: '' };
export default function Admin() {
    const [me, setMe] = useState<Staff | null>(null), [auth, setAuth] = useState<{
        initialized: boolean;
        demo: boolean;
    } | null>(null), [loading, setLoading] = useState(true), [section, setSection] = useState('overview'), [data, setData] = useState<any>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [sidebar, setSidebar] = useState(false);
    const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [token, setToken] = useState(''), [editor, setEditor] = useState<any>(null), [editType, setEditType] = useState(''), [stockProduct, setStockProduct] = useState(''), [codes, setCodes] = useState(''), [orderSearch, setOrderSearch] = useState(''), [orderStatus, setOrderStatus] = useState(''), [page, setPage] = useState(1), [reason, setReason] = useState(''), [reference, setReference] = useState(''), [reply, setReply] = useState(''), [closed, setClosed] = useState(true), [oldPassword, setOldPassword] = useState(''), [newPassword, setNewPassword] = useState('');
    async function initialize() {
        try {
            const a = await api('auth/status');
            setAuth(a);
            try {
                setMe(await api<Staff>('auth/me'));
            }
            catch {
            }
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        initialize();
    }, []);
    useEffect(() => {
        if (me)
            load();
    }, [me, section, page]);
    useEffect(() => {
        if (notice) {
            const t = setTimeout(() => setNotice(''), 4000);
            return () => clearTimeout(t);
        }
    }, [notice]);
    async function load() {
        setError('');
        try {
            setData(await api('admin/' + section + (section === 'orders' ? `?q=${encodeURIComponent(orderSearch)}&status=${orderStatus}&page=${page}` : '')));
        }
        catch (e) {
            setError((e as Error).message);
        }
    }
    async function login(kind: string) {
        setBusy(true);
        setError('');
        try {
            await api('auth/' + kind, kind === 'demo' ? {} : kind === 'setup' ? { username, password, token } : { username, password });
            setPassword('');
            setToken('');
            setMe(await api<Staff>('auth/me'));
            setAuth(await api('auth/status'));
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    async function mutate(path: string, values: any) {
        setBusy(true);
        try {
            const r = await api('admin/' + path, values, me!.csrf);
            setNotice(r.imported !== undefined ? `成功导入 ${r.imported} 条，跳过重复 ${r.skipped} 条` : '操作已保存');
            setEditor(null);
            setCodes('');
            await load();
            return true;
        }
        catch (e) {
            setNotice((e as Error).message);
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    function change(key: string) {
        setSection(key);
        setData(null);
        setPage(1);
        setSidebar(false);
        setError('');
    }
    function open(type: string, value: any) {
        setEditType(type);
        setEditor(value);
        setReason('');
        setReference('');
        setReply(value.reply || '');
    }
    function exportOrders() {
        const rows = [['订单号', '联系方式', '金额(元)', '状态', '创建时间'], ...(data.orders || []).map((o: any) => [o.id, o.contact, (o.total / 100).toFixed(2), statuses[o.status], date(o.created_at)])];
        const csv = '\ufeff' + rows.map(row => row.map((v: any) => '"' + String(v).replace(/^[=+@-]/, "'").replaceAll('"', '""') + '"').join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = '重启-当前页订单.csv';
        a.click();
        URL.revokeObjectURL(url);
    }
    const editable = me?.role === 'owner' || me?.role === 'operator';
    if (!me)
        return <div className="admin-login"><a href="/" className="brand"><span className="brand-mark"><RotateCw /></span><span>重启<small>RESTART</small></span></a><div className="login-card"><span className="login-icon"><Lock size={25}/></span><div className="eyebrow">RESTART CONSOLE</div><h1>{auth && !auth.initialized && !auth.demo ? '初始化你的商城' : '欢迎回到管理后台'}</h1><p>{auth && !auth.initialized && !auth.demo ? '创建店主账号，开始管理数字商品业务。' : '从一个工作台，掌握每一份数字价值。'}</p>{loading ? <div className="small-empty">正在连接管理系统…</div> : <><form onSubmit={e => {
            e.preventDefault();
            login(auth && !auth.initialized && !auth.demo ? 'setup' : 'login');
        }}>{auth && !auth.initialized && !auth.demo && <label>初始化令牌<input required type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Cloudflare 中配置的 BOOTSTRAP_TOKEN"/></label>}<label>管理员账号<input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="输入管理员账号"/></label><label>密码<input required type="password" autoComplete="current-password" minLength={auth && !auth.initialized && !auth.demo ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder="输入管理员密码"/></label>{error && <div className="error-text">{error}</div>}<button className="primary" disabled={busy}>{busy ? '正在验证…' : auth && !auth.initialized && !auth.demo ? '创建店主账号' : '安全登录'} <ArrowRight size={17}/></button></form>{auth?.demo && <div className="demo-login"><span>想先了解系统如何运作？</span><button className="secondary" disabled={busy} onClick={() => login('demo')}>进入演示管理后台 <ArrowUpRight size={16}/></button><small>使用测试数据，演示入口在正式环境关闭。</small></div>}</>}<a className="text-button" href="/">返回商品商城 <ArrowUpRight size={14}/></a></div><small className="login-foot">重启运营管理系统 · 安全连接</small></div>;
    return <div className="admin-app"><aside className={'admin-sidebar ' + (sidebar ? 'open' : '')}><a href="/" className="brand"><span className="brand-mark"><RotateCw size={23}/></span><span>重启<small>RESTART CONSOLE</small></span></a><div className="workspace"><span className="workspace-avatar">重</span><div>重启数字商城<small>{auth?.demo ? '演示工作空间' : '商家工作空间'}</small></div><ChevronRight size={15}/></div><div className="nav-caption">业务管理</div><nav>{sections.filter(([key]) => me.role === 'owner' || me.role === 'operator' ? me.role === 'owner' || !['staff', 'audits', 'settings', 'payment'].includes(key) : ['overview', 'orders', 'tickets'].includes(key)).map(([key, label, Icon]) => <button key={key} className={section === key ? 'active' : ''} onClick={() => change(key)}><Icon size={18}/>{label}{section === key && <span />}</button>)}</nav><div className="sidebar-bottom"><a href="/" target="_blank" rel="noreferrer"><GlobeIcon /> 访问商城 <ArrowUpRight size={15}/></a><div className="admin-profile"><span>{me.username.slice(0, 1).toUpperCase()}</span><div>{me.username}<small>{roleNames[me.role]}</small></div><button aria-label="退出登录" onClick={async () => {
        await api('auth/logout', {}, me.csrf);
        setMe(null);
        await initialize();
    }}><LogOut size={17}/></button></div></div></aside>
    <div className="admin-main"><header className="admin-header"><div><button className="icon-button menu-button" aria-label="展开导航" onClick={() => setSidebar(!sidebar)}><Menu /></button><span>工作台</span><ChevronRight size={14}/><strong>{sections.find(x => x[0] === section)?.[1]}</strong></div><div><span className="connection-dot"/>{auth?.demo ? '演示环境' : '系统已连接'}<button className="icon-button" aria-label="刷新数据" onClick={load}><RefreshCw size={17}/></button><button className="admin-avatar" title="修改密码" onClick={() => open('password', {})}>{me.username[0].toUpperCase()}</button></div></header><main className="admin-content"><div className="admin-page-heading"><div><div className="eyebrow">{section === 'overview' ? 'YOUR BUSINESS AT A GLANCE' : 'RESTART OPERATIONS'}</div><h1>{section === 'overview' ? `你好，${me.username}。` : sections.find(x => x[0] === section)?.[1]}</h1><p>{({ overview: '每一笔订单，每一份价值，尽在掌握。', products: '管理商品信息、价格和销售状态。', categories: '整理你的数字商品目录。', inventory: '批量导入卡密，自动去重并加密保存。', orders: '跟进付款、交付与售后，全程有迹可循。', tickets: '及时响应客户的问题，留下完整处理记录。', staff: '为团队分配合适的操作权限。', audits: '追踪后台的关键操作。', settings: '让你的品牌与服务信息保持一致。', payment: '管理 USDT 收款配置，跟进链上到账与异常订单。' } as any)[section]}</p></div><div className="heading-actions">{section === 'overview' ? <span className="date-pill"><Clock3 size={15}/>{new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span> : section === 'products' && editable ? <button className="primary" onClick={() => open('product', { ...blankProduct, category_id: data?.categories[0]?.id || '' })}><Plus size={16}/> 新建商品</button> : section === 'categories' && editable ? <button className="primary" onClick={() => open('category', { id: '', name: '', icon: 'box', sort: 0, active: 1 })}><Plus size={16}/> 新建分类</button> : section === 'staff' ? <button className="primary" onClick={() => open('staff', { username: '', password: '', role: 'operator' })}><Plus size={16}/> 添加员工</button> : section === 'orders' ? <button className="secondary" onClick={exportOrders} disabled={!data}><Download size={15}/> 导出当前页</button> : null}</div></div>
    {auth?.demo && <div className="admin-demo-banner"><span><AlertCircle size={16}/>当前为演示环境，所有示例商品与交付卡密均用于测试。</span><a href="/" target="_blank" rel="noreferrer">查看商城 <ArrowUpRight size={14}/></a></div>}
        {error ? <div className="panel empty"><AlertCircle size={30}/><h3>{error}</h3><button className="secondary" onClick={load}>重新加载</button></div> : !data ? <div className="panel empty">正在加载数据…</div> : <>
        {section === 'overview' && <><div className="stat-grid">{[[Wallet, '累计成交额', money(data.stats.revenue || 0), '已发货订单总额', 'violet'], [ShoppingBag, '累计订单', data.stats.orders || 0, '包含所有订单状态', 'blue'], [Clock3, '待付款订单', data.stats.pending || 0, '需要关注的订单', 'orange'], [KeyRound, '可售库存', data.stats.stock || 0, '尚未分配的卡密', 'green']].map(([Icon, label, value, caption, color]: any) => <div className="stat-card" key={label}><div><span>{label}</span><i className={color}><Icon size={19}/></i></div><strong>{value}</strong><small>{caption}</small></div>)}</div><div className="dashboard-grid"><section className="panel revenue-panel"><div className="panel-title"><h3>成交趋势</h3><span className="tag muted">最近 7 天</span></div><strong>{money(data.trend.reduce((s: number, d: any) => s + d.revenue, 0))}</strong><small>最近 7 天已发货订单金额</small><div className="trend-chart">{Array.from({ length: 7 }, (_, i) => {
            const dateValue = new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
            const item = data.trend.find((d: any) => d.day === dateValue);
            const max = Math.max(1, ...data.trend.map((d: any) => d.revenue));
            return <div key={i} className="trend-column" title={`${dateValue}：${money(item?.revenue || 0)}`}><span>{item?.revenue ? money(item.revenue) : '—'}</span><div style={{ height: Math.max(3, (item?.revenue || 0) / max * 130) }}/><small>{dateValue.slice(5)}</small></div>;
        })}</div></section><section className="panel todo-panel"><div className="panel-title"><h3>待办与提醒</h3><span className="connection-dot"/></div><button onClick={() => change('orders')}><span className="todo-icon orange"><Clock3 size={19}/></span><span>待付款订单<small>核对支付与订单状态</small></span><strong>{data.stats.pending || 0}</strong><ChevronRight size={15}/></button><button onClick={() => change('tickets')}><span className="todo-icon blue"><Headphones size={19}/></span><span>待处理售后<small>及时回复客户问题</small></span><strong>{data.stats.tickets || 0}</strong><ChevronRight size={15}/></button><button onClick={() => change(editable ? 'inventory' : 'orders')}><span className="todo-icon purple"><Package size={19}/></span><span>库存预警商品<small>可售库存低于 10 份</small></span><strong>{data.lowStock.length}</strong><ChevronRight size={15}/></button><div className="payment-reminder"><ShieldCheck size={20}/><p>USDT 收款与对账<small>在支付接口页面查看配置与到账状态。</small></p></div></section></div><section className="panel table-panel"><div className="panel-title"><h3>最近订单</h3><button className="text-button" onClick={() => change('orders')}>查看全部 <ArrowRight size={14}/></button></div><OrdersTable orders={data.recent}/></section><div className="quick-links">{[[Package, '管理商品', '优化你的商品目录', 'products'], [KeyRound, '补充库存', '批量导入新的交付卡密', 'inventory'], [Headphones, '处理售后', '保持与客户的沟通', 'tickets']].filter(x => editable || x[3] === 'tickets').map(([Icon, title, desc, key]: any) => <button key={key} className="panel" onClick={() => change(key)}><Icon size={24}/><span><strong>{title}</strong><small>{desc}</small></span><ArrowUpRight size={19}/></button>)}</div></>}
        {section === 'products' && <section className="panel table-panel"><div className="panel-title"><h3>全部商品 <span className="count">{data.products.length}</span></h3><span className="hint">一个商品对应一个可售规格</span></div><div className="table-scroll"><table><thead><tr><th>商品信息</th><th>分类</th><th>售价</th><th>可售库存</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.products.map((p: Product) => <tr key={p.id}><td><strong>{p.name}</strong><small>{p.subtitle}</small></td><td>{data.categories.find((c: Category) => c.id === p.category_id)?.name}</td><td>{money(p.price)}</td><td><span className={p.stock < 10 ? 'warning-text' : ''}>{p.stock} 份</span></td><td><span className={'status ' + (p.active ? 'fulfilled' : 'expired')}>{p.active ? '销售中' : '已下架'}</span></td><td><button className="text-button" onClick={() => open('product', { ...p })}>编辑</button></td></tr>)}</tbody></table>{!data.products.length && <Empty text="暂无商品，先创建分类，再上架你的第一件商品。"/>}</div></section>}
        {section === 'categories' && <div className="category-admin-grid">{data.map((c: Category) => <div className="panel category-admin-card" key={c.id}><span className="category-circle"><Layers3 size={23}/></span><h3>{c.name}</h3><p>排序权重：{c.sort}</p><span className={'status ' + (c.active ? 'fulfilled' : 'expired')}>{c.active ? '已显示' : '已隐藏'}</span><button className="text-button" onClick={() => open('category', { ...c })}>编辑分类 <ArrowUpRight size={14}/></button></div>)}{!data.length && <Empty text="暂无分类，请新建商品分类。"/>}</div>}
        {section === 'inventory' && <div className="inventory-layout"><form className="panel inventory-import" onSubmit={e => {
            e.preventDefault();
            mutate('inventory', { product_id: stockProduct, codes });
        }}><h3><KeyRound size={19}/> 批量导入卡密</h3><p>每行一条完整卡密，最多 30 条；系统会自动跳过重复内容。</p><label>选择对应商品<select required value={stockProduct} onChange={e => setStockProduct(e.target.value)}><option value="">请选择商品</option>{data.products.map((p: Product) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>卡密内容<textarea required rows={10} value={codes} onChange={e => setCodes(e.target.value)} placeholder="一行一条卡密\n例如：授权码 / 兑换码 / 交付内容"/></label><div className="info-box"><ShieldCheck size={16}/> 导入后加密保存，后台不回显完整卡密。</div><button className="primary" disabled={busy || !stockProduct || !codes.trim()}>{busy ? '正在加密导入…' : '加密并导入'} <ArrowRight size={15}/></button></form><section className="panel table-panel"><div className="panel-title"><h3>库存汇总</h3><span className="tag muted">实时库存</span></div><div className="table-scroll"><table><thead><tr><th>商品</th><th>可售</th><th>锁定</th><th>已交付</th></tr></thead><tbody>{data.products.map((p: Product) => <tr key={p.id}><td>{p.name}</td>{['available', 'reserved', 'delivered'].map(status => <td key={status}>{data.batches.find((b: any) => b.product_id === p.id && b.status === status)?.count || 0}</td>)}</tr>)}</tbody></table></div></section></div>}
        {section === 'orders' && <section className="panel table-panel"><form className="admin-table-filter" onSubmit={e => {
            e.preventDefault();
            setPage(1);
            load();
        }}><label className="search-input"><Search size={17}/><input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="搜索订单号"/></label><select value={orderStatus} onChange={e => setOrderStatus(e.target.value)}><option value="">全部状态</option>{['pending', 'fulfilled', 'expired', 'cancelled', 'refunded'].map(s => <option value={s} key={s}>{statuses[s]}</option>)}</select><button className="secondary">筛选</button></form><OrdersTable orders={data.orders} action={me.role === 'owner' ? (o: any) => open(o.status === 'fulfilled' ? 'refund' : 'confirm', o) : undefined}/><div className="pagination"><span>共 {data.total} 笔订单 · 第 {page} 页</span><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button className="secondary" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>下一页</button></div></div></section>}
        {section === 'tickets' && <div className="admin-tickets">{data.length ? data.map((t: any) => <div className="panel" key={t.id}><div className="panel-title"><h3>{t.subject}</h3><span className={'status ' + t.status}>{statuses[t.status]}</span></div><small className="mono">{t.order_id} · {date(t.created_at)}</small><p className="pre-wrap">{t.message}</p>{t.reply && <div className="ticket-reply">当前回复：{t.reply}</div>}<button className="secondary" onClick={() => open('ticket', t)}>回复与处理 <ArrowRight size={14}/></button></div>) : <div className="panel"><Empty text="暂无售后工单。客户提交的问题会显示在这里。"/></div>}</div>}
        {section === 'staff' && <><div className="permission-cards">{[['店主', '全功能管理、确认收款与退款、员工管理'], ['运营', '商品、分类、库存管理；查看订单、处理售后'], ['客服', '查看订单与概览、回复售后工单']].map(([name, desc]) => <div className="panel" key={name}><ShieldCheck size={22}/><h3>{name}</h3><p>{desc}</p></div>)}</div><section className="panel table-panel"><table><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{data.map((s: Staff & {
            created_at: number;
        }) => <tr key={s.id}><td><strong>{s.username}</strong></td><td>{roleNames[s.role]}</td><td><span className={'status ' + (s.active ? 'fulfilled' : 'expired')}>{s.active ? '已启用' : '已停用'}</span></td><td>{date(s.created_at)}</td><td>{s.role !== 'owner' && <button className="text-button" disabled={busy} onClick={() => mutate('staff', { id: s.id, active: !s.active })}>{s.active ? '停用账号' : '启用账号'}</button>}</td></tr>)}</tbody></table></section></>}
        {section === 'audits' && <section className="panel table-panel"><div className="panel-title"><h3>最近 200 条关键操作</h3><span className="tag muted">仅店主可见</span></div><div className="table-scroll"><table><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>目标</th><th>详情</th></tr></thead><tbody>{data.map((a: any) => <tr key={a.id}><td>{date(a.created_at)}</td><td>{a.actor_name}</td><td><code>{a.action}</code></td><td className="truncate" title={a.target}>{a.target}</td><td>{a.detail || '—'}</td></tr>)}</tbody></table></div></section>}
        {section === 'settings' && <form className="panel settings-form" onSubmit={e => {
            e.preventDefault();
            mutate('settings', data);
        }}><h3>品牌与站点信息</h3><div className="form-grid">{[['brand', '品牌名称'], ['tagline', '商城标语'], ['support', '客服联系方式 / 指引'], ['businessHours', '服务时间'], ['footer', '页脚说明']].map(([key, label]) => <label key={key}>{label}<input value={data[key] || ''} onChange={e => setData({ ...data, [key]: e.target.value })}/></label>)}</div><label>商城公告<textarea rows={3} value={data.announcement || ''} onChange={e => setData({ ...data, announcement: e.target.value })}/></label><label>购买协议<textarea rows={5} value={data.terms || ''} onChange={e => setData({ ...data, terms: e.target.value })}/></label><label>隐私政策<textarea rows={5} value={data.privacy || ''} onChange={e => setData({ ...data, privacy: e.target.value })}/></label><button className="primary" disabled={busy}>保存站点设置 <Check size={16}/></button></form>}
        {section === 'payment' && <PaymentPanel data={data} csrf={me.csrf!} refresh={load}/>}
        </>}
    </main><footer className="admin-footer">RESTART CONSOLE <span>中文管理系统 · Cloudflare Workers + D1</span></footer></div>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}</div>}
        {editor && <div className="modal-backdrop" onClick={() => setEditor(null)}><form className="modal admin-modal" onClick={e => e.stopPropagation()} onSubmit={async (e) => {
            e.preventDefault();
            if (editType === 'product')
                await mutate('products', editor);
            if (editType === 'category')
                await mutate('categories', editor);
            if (editType === 'staff')
                await mutate('staff', editor);
            if (editType === 'ticket')
                await mutate('tickets', { id: editor.id, reply, closed });
            if (editType === 'confirm' || editType === 'refund')
                await mutate('orders', { id: editor.id, reason, reference, action: editType === 'refund' ? 'refund' : 'confirm' });
            if (editType === 'password') {
                const ok = await mutate('password', { old: oldPassword, password: newPassword });
                if (ok) {
                    setOldPassword('');
                    setNewPassword('');
                    setMe(null);
                    await initialize();
                }
            }
        }}><button type="button" className="modal-close" aria-label="关闭弹窗" onClick={() => setEditor(null)}><X /></button><h2>{({ product: editor.id ? '编辑商品' : '新建商品', category: editor.id ? '编辑分类' : '新建分类', staff: '添加员工', ticket: '回复售后工单', confirm: '确认收款并发货', refund: '登记退款结果', password: '修改管理员密码' } as any)[editType]}</h2>
        {editType === 'product' && <><label>商品名称<input required maxLength={120} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })}/></label><div className="form-grid"><label>商品分类<select required value={editor.category_id} onChange={e => setEditor({ ...editor, category_id: e.target.value })}><option value="">请选择</option>{data.categories.map((c: Category) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>适用地区<input value={editor.region} onChange={e => setEditor({ ...editor, region: e.target.value })}/></label><label>售价（元）<input required type="number" min="0.01" step="0.01" value={editor.price / 100} onChange={e => setEditor({ ...editor, price: Math.round(Number(e.target.value) * 100) })}/></label><label>原价（元，可选）<input type="number" min="0" step="0.01" value={editor.compare_price / 100} onChange={e => setEditor({ ...editor, compare_price: Math.round(Number(e.target.value) * 100) })}/></label><label>最少购买数量<input required type="number" min="1" max="100" value={editor.min_qty} onChange={e => setEditor({ ...editor, min_qty: Number(e.target.value) })}/></label><label>最多购买数量<input required type="number" min={editor.min_qty} max="100" value={editor.max_qty} onChange={e => setEditor({ ...editor, max_qty: Number(e.target.value) })}/></label></div><label>商品短说明<input value={editor.subtitle} onChange={e => setEditor({ ...editor, subtitle: e.target.value })}/></label><label>商品标签<input value={editor.tag} onChange={e => setEditor({ ...editor, tag: e.target.value })}/></label><label>商品介绍<textarea rows={3} value={editor.description} onChange={e => setEditor({ ...editor, description: e.target.value })}/></label><label>购买须知<textarea rows={3} value={editor.instructions} onChange={e => setEditor({ ...editor, instructions: e.target.value })}/></label><div className="button-row"><label className="checkbox-label"><input type="checkbox" checked={!!editor.active} onChange={e => setEditor({ ...editor, active: e.target.checked ? 1 : 0 })}/>上架销售</label><label className="checkbox-label"><input type="checkbox" checked={!!editor.featured} onChange={e => setEditor({ ...editor, featured: e.target.checked ? 1 : 0 })}/>首页推荐</label></div></>}
        {editType === 'category' && <><label>分类名称<input required value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })}/></label><label>排序（数字越小越靠前）<input type="number" min="0" max="1000" value={editor.sort} onChange={e => setEditor({ ...editor, sort: Number(e.target.value) })}/></label><label>分类图标<select value={editor.icon} onChange={e => setEditor({ ...editor, icon: e.target.value })}>{[['box', '商品'], ['send', 'Telegram'], ['twitter', 'X / Twitter'], ['apple', 'Apple'], ['globe', '全球服务'], ['sparkles', 'AI'], ['code', '软件'], ['file', '资源'], ['headphones', '支持']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={!!editor.active} onChange={e => setEditor({ ...editor, active: e.target.checked ? 1 : 0 })}/>在商城显示</label></>}
        {editType === 'staff' && <><label>员工账号<input required pattern="[a-zA-Z0-9_-]{3,32}" value={editor.username} onChange={e => setEditor({ ...editor, username: e.target.value })}/></label><label>初始密码（至少 12 位）<input required type="password" minLength={12} maxLength={128} value={editor.password} onChange={e => setEditor({ ...editor, password: e.target.value })}/></label><label>角色<select value={editor.role} onChange={e => setEditor({ ...editor, role: e.target.value })}><option value="operator">运营</option><option value="support">客服</option></select></label></>}
        {editType === 'ticket' && <><div className="info-box">{editor.message}</div><label>客服回复<textarea required rows={5} maxLength={2000} value={reply} onChange={e => setReply(e.target.value)}/></label><label className="checkbox-label"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)}/>回复后关闭工单</label></>}
        {(editType === 'confirm' || editType === 'refund') && <><div className="info-box">{editType === 'confirm' ? '确认真实到账后再操作。系统将交付已锁定的卡密。' : '请先在支付平台完成退款。此操作只登记退款结果，不会调用支付服务或重新出售已交付卡密。'}</div><p className="mono">{editor.id}</p><h3>{money(editor.total)}</h3><label>{editType === 'refund' ? '退款流水号' : '收款流水号'}<input required maxLength={100} value={reference} onChange={e => setReference(e.target.value)}/></label><label>处理依据 / 备注<textarea required minLength={5} rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)}/></label></>}
        {editType === 'password' && <><label>原密码<input required type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)}/></label><label>新密码（至少 12 位）<input required type="password" minLength={12} maxLength={128} value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label><p className="hint">修改后所有登录会话失效，需要重新登录。</p></>}
        <div className="button-row"><button type="button" className="secondary" onClick={() => setEditor(null)}>取消</button><button className="primary" disabled={busy}>{busy ? '正在保存…' : editType === 'confirm' ? '确认到账并发货' : editType === 'refund' ? '登记已退款' : '保存'}<Check size={16}/></button></div></form></div>}
    </div>;
}
function GlobeIcon() {
    return <Eye size={17}/>;
}
function Empty({ text }: {
    text: string;
}) {
    return <div className="empty"><Package size={35}/><p>{text}</p></div>;
}
function OrdersTable({ orders, action }: {
    orders: any[];
    action?: (o: any) => void;
}) {
    return <div className="table-scroll"><table><thead><tr><th>订单编号</th><th>联系信息</th><th>订单金额</th><th>订单状态</th><th>创建时间</th>{action && <th>操作</th>}</tr></thead><tbody>{orders.map(o => <tr key={o.id}><td className="mono">{o.id}{o.demo === 1 && <small>演示订单</small>}</td><td>{o.contact}</td><td><strong>{money(o.total)}</strong></td><td><span className={'status ' + o.status}>{statuses[o.status] || o.status}</span></td><td>{date(o.created_at)}</td>{action && <td>{['pending', 'fulfilled'].includes(o.status) && <button className="text-button" onClick={() => action(o)}>{o.status === 'fulfilled' ? '登记退款' : '确认收款'}</button>}</td>}</tr>)}</tbody></table>{!orders.length && <Empty text="暂无订单，客户创建订单后会显示在这里。"/>}</div>;
}
