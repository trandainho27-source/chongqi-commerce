import type { RuntimeEnv } from './types.ts';

// Mainnet only. Never select a token by its name or symbol.
export const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const USDT_CONTRACT_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';
export const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export class PaymentError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function unitsText(value: number | bigint | string) {
    const n = BigInt(value);
    return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, '0')}`;
}
export async function addressHex(address: string): Promise<string | null> {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return null;
    let n = 0n;
    for (const c of address) n = n * 58n + BigInt(BASE58.indexOf(c));
    const hex = n.toString(16).padStart(50, '0');
    if (hex.length !== 50 || !hex.startsWith('41')) return null;
    const bytes = Uint8Array.from(hex.match(/../g)!, v => parseInt(v, 16));
    const first = await crypto.subtle.digest('SHA-256', bytes.slice(0, 21));
    const checksum = new Uint8Array(await crypto.subtle.digest('SHA-256', first));
    if (!bytes.slice(21).every((v, i) => v === checksum[i])) return null;
    return hex.slice(2, 42);
}
export function rateUnits(value = '') {
    if (!/^\d{1,4}(\.\d{1,6})?$/.test(value)) return null;
    const [whole, part = ''] = value.split('.');
    const result = BigInt(whole) * 1000000n + BigInt(part.padEnd(6, '0'));
    return result >= 10000n && result <= 1000000000n ? result : null;
}
export function quoteUnits(cnyCents: number, rate: string) {
    const scaledRate = rateUnits(rate);
    if (!scaledRate || !Number.isSafeInteger(cnyCents) || cnyCents <= 0) throw new PaymentError(503, 'USDT 计价配置无效');
    const numerator = BigInt(cnyCents) * 10000000000n;
    const result = (numerator + scaledRate - 1n) / scaledRate;
    if (result > BigInt(Number.MAX_SAFE_INTEGER - 10000)) throw new PaymentError(400, '订单金额超出支付范围');
    return Number(result);
}
export async function paymentConfiguration(env: RuntimeEnv) {
    const address = env.TRON_RECEIVING_ADDRESS?.trim() || '';
    const hex = await addressHex(address);
    const rate = env.USDT_CNY_RATE?.trim() || '';
    const checks = {
        provider: env.PAYMENT_PROVIDER === 'trc20',
        production: env.DEMO_MODE !== 'true',
        address: !!hex && address !== USDT_CONTRACT && hex !== '0'.repeat(40),
        apiKey: !!env.TRONGRID_API_KEY?.trim(),
        rate: rateUnits(rate) !== null,
        inventory: /^[0-9a-f]{64}$/i.test(env.INVENTORY_KEY || ''),
    };
    return { enabled: Object.values(checks).every(Boolean), checks, address, addressHex: hex, rate, network: 'TRON / TRC20' as const, contract: USDT_CONTRACT };
}
export async function tronRequest(env: RuntimeEnv, path: string, payload?: unknown): Promise<any> {
    if (!env.TRONGRID_API_KEY) throw new PaymentError(503, '链上查询尚未配置');
    try {
        const response = await fetch('https://api.trongrid.io' + path, {
            method: payload === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
            headers: { 'TRON-PRO-API-KEY': env.TRONGRID_API_KEY, accept: 'application/json', ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        if (!response.ok) throw new Error('upstream');
        const data = await response.json() as any;
        if (!data || typeof data !== 'object' || data.Error || data.error || data.success === false) throw new Error('upstream');
        return data;
    } catch {
        // Never leak upstream responses or the API key to customers/logs.
        throw new PaymentError(503, '链上查询暂时不可用，请勿重复付款，稍后再核验');
    }
}
export interface ChainTransfer {
    eventId: string;
    txId: string;
    logIndex: number;
    amountUnits: string;
    timestamp: number;
    block: number;
    fromHex: string;
}
export async function confirmedTransfers(env: RuntimeEnv, txId: string, receivingHex: string): Promise<ChainTransfer[]> {
    if (!/^[a-fA-F0-9]{64}$/.test(txId)) throw new PaymentError(400, '交易哈希应为 64 位十六进制字符');
    txId = txId.toLowerCase();
    const tx = await tronRequest(env, '/walletsolidity/gettransactionbyid', { value: txId });
    if (!tx.txID) return [];
    if (tx.txID !== txId || !Array.isArray(tx.ret) || !tx.ret.length || tx.ret.some((r: any) => r.contractRet !== 'SUCCESS')) throw new PaymentError(422, '该交易未成功执行');
    const receipt = await tronRequest(env, '/walletsolidity/gettransactioninfobyid', { value: txId });
    if (!receipt.id) return [];
    if (receipt.id !== txId || receipt.result === 'FAILED' || receipt.receipt?.result !== 'SUCCESS') throw new PaymentError(422, '该交易未成功执行');
    if (!Number.isSafeInteger(receipt.blockTimeStamp) || receipt.blockTimeStamp <= 0 || receipt.blockTimeStamp > Date.now() + 30000 || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber <= 0 || !Array.isArray(receipt.log)) throw new PaymentError(503, '链上回执不完整，请稍后再核验');
    const transfers: ChainTransfer[] = [];
    // A transfer out in the same receipt could cancel an apparent deposit.
    // Route such compound/self transfers to manual review, never automatic credit.
    for (const log of receipt.log) {
        if (String(log.address).toLowerCase() === USDT_CONTRACT_HEX && log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC && String(log.topics?.[1]).toLowerCase() === '0'.repeat(24) + receivingHex && /^[0-9a-fA-F]{64}$/.test(log.data) && BigInt('0x' + log.data) > 0n) throw new PaymentError(422, '交易同时包含收款地址支出，请联系商家人工核对');
    }
    receipt.log.forEach((log: any, index: number) => {
        if (String(log.address).toLowerCase() !== USDT_CONTRACT_HEX || !Array.isArray(log.topics) || log.topics.length !== 3 || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC) return;
        const from = String(log.topics[1]).toLowerCase(), to = String(log.topics[2]).toLowerCase();
        if (!/^0{24}[0-9a-f]{40}$/.test(from) || !/^0{24}[0-9a-f]{40}$/.test(to) || to.slice(24) !== receivingHex || !/^[0-9a-fA-F]{64}$/.test(log.data)) return;
        const amount = BigInt('0x' + log.data);
        if (amount <= 0n) return;
        transfers.push({ eventId: `${txId}:${index}`, txId, logIndex: index, amountUnits: amount.toString(), timestamp: receipt.blockTimeStamp, block: receipt.blockNumber, fromHex: from.slice(24) });
    });
    return transfers;
}
