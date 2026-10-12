'use client';
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, ShieldCheck, RefreshCw, Wallet, ExternalLink } from 'lucide-react';
import { api, date } from '@/lib/commerce/client';
import type { Order, PaymentInvoice } from '@/lib/commerce/types';

export default function UsdtPayment({ order, secret, enabled, onUpdate }: { order: Order; secret: string; enabled: boolean; onUpdate: (order: Order) => void }) {
    const [invoice, setInvoice] = useState<PaymentInvoice | null>(order.payment || null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [txId, setTxId] = useState(''), [clock, setClock] = useState(Date.now());
    const checking = useRef(false), update = useRef(onUpdate);
    update.current = onUpdate;
    useEffect(() => { setInvoice(order.payment || null); }, [order.payment]);
    useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
    useEffect(() => {
        if (!invoice || invoice.status !== 'waiting' || order.status !== 'pending') return;
        let alive = true;
        const timer = setInterval(async () => {
            if (checking.current || document.visibilityState !== 'visible') return;
            checking.current = true;
            try {
                const r = await api<{ order: Order; message: string }>('payments/check', { id: order.id, secret });
                if (alive) { update.current(r.order); setError(''); }
            } catch (e) { if (alive) setError((e as Error).message); }
            finally { checking.current = false; }
        }, 20000);
        return () => { alive = false; clearInterval(timer); };
    }, [invoice?.id, invoice?.status, order.id, order.status, secret]);
    async function create() {
        setBusy(true); setError('');
        try {
            const r = await api<PaymentInvoice>('payments/create', { id: order.id, secret });
            setInvoice(r); onUpdate({ ...order, payment: r, expires_at: r.watch_until });
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    async function check(hash = '') {
        if (checking.current) return;
        checking.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const r = await api<{ order: Order; message: string }>('payments/check', { id: order.id, secret, ...(hash ? { txId: hash.trim() } : {}) });
            onUpdate(r.order); setMessage(r.message);
        } catch (e) { setError((e as Error).message); }
        finally { checking.current = false; setBusy(false); }
    }
    async function copy(value: string) {
        try { await navigator.clipboard.writeText(value); setMessage('已复制，请在钱包中再次核对。'); }
        catch { setError('复制失败，请手动选择文本复制。'); }
    }
    if (!invoice) return <div className="usdt-checkout"><div className="usdt-heading"><Wallet size={22}/><div><h4>USDT 支付</h4><small>TRON 主网 · TRC20</small></div></div>{order.demo ? <p className="info-box">演示订单不收取真实 USDT，请勿转账。</p> : !enabled ? <p className="info-box">商家正在配置 USDT 收款，暂时无法在线付款。</p> : <><p>人民币售价按商家设定的汇率折算，生成支付单后锁定金额。为准确识别订单，另含不超过 0.009999 USDT 的识别尾差，完整金额将在付款前显示。</p><button className="primary" disabled={busy || order.status !== 'pending'} onClick={create}>{busy ? '正在生成…' : '生成 USDT 支付单'}<Wallet size={17}/></button></>}{error && <p role="alert" className="error-text">{error}</p>}</div>;
    const remaining = Math.max(0, Math.ceil((invoice.pay_before - clock) / 1000)), accepting = remaining > 0 && invoice.status === 'waiting' && order.status === 'pending';
    const label = invoice.status === 'confirmed' ? '链上到账已确认' : invoice.status === 'review' ? '到账待人工核对' : accepting ? '等待 USDT 到账' : '付款时间已结束';
    return <section className="usdt-checkout" aria-label="USDT 收银台"><div className="usdt-heading"><span className="usdt-symbol">₮</span><div><h4>{label}</h4><small>TRON 主网 · 仅支持 TRC20 USDT</small></div><span className="tag muted">{accepting ? `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}` : '停止转账'}</span></div>
        {accepting && <div className="usdt-pay-grid"><div className="usdt-qr"><QRCodeSVG value={invoice.address} size={180} marginSize={4} level="M"/><small>仅包含收款地址</small></div><div className="usdt-amount"><small>请确保实际到账金额为</small><strong>{invoice.amount}<span>USDT</span></strong><button className="secondary" onClick={() => copy(invoice.amount)}><Copy size={14}/>复制完整金额</button><p>含识别尾差 {invoice.adjustment} USDT<br />锁定汇率：1 USDT = ¥{invoice.rate}<br />钱包或平台的转账手续费另计</p></div></div>}
        {accepting && <div className="usdt-address"><small>收款地址 · TRON / TRC20</small><code>{invoice.address}</code><button className="text-button" onClick={() => copy(invoice.address)}><Copy size={14}/>复制地址</button></div>}
        <div className="info-box"><ShieldCheck size={17}/><span>{invoice.status === 'confirmed' ? '该笔付款已核验，请查看订单交付内容。' : invoice.status === 'review' ? invoice.review_reason : accepting ? '请一次性转入完整的 6 位小数金额，不要取整或拆分。扫码后仍需手动填写金额，并确认使用 TRC20 网络。' : `请勿继续转账或重复付款。已在 ${date(invoice.pay_before)} 前转账的款项会继续核验；超时或金额不符请提交售后工单。`}</span></div>
        {invoice.tx_id && <a className="text-button mono" target="_blank" rel="noreferrer" href={`https://tronscan.org/#/transaction/${invoice.tx_id}`}>查看链上交易 <ExternalLink size={14}/></a>}
        {invoice.status !== 'confirmed' && <><div className="button-row"><button className="secondary" disabled={busy} onClick={() => check()}><RefreshCw size={15}/>{busy ? '正在核验…' : '我已转账，检查到账'}</button><span className="hint">{invoice.status === 'waiting' && order.status === 'pending' ? '付款页每 20 秒自动检查' : '可补查交易或提交售后工单'}</span></div><details className="usdt-tx"><summary>已经转账，但状态没有更新？</summary><p>粘贴钱包提供的交易哈希（TxID）补查；无需提供钱包密码或私钥。</p><form onSubmit={e => { e.preventDefault(); check(txId); }}><input aria-label="TRON 交易哈希" required pattern="[a-fA-F0-9]{64}" maxLength={64} placeholder="64 位交易哈希 TxID" value={txId} onChange={e => setTxId(e.target.value)}/><button className="secondary" disabled={busy}>核验交易</button></form></details></>}
        {message && <p role="status" className="hint">{message}</p>}{error && <p role="alert" className="error-text">{error}</p>}
    </section>;
}
