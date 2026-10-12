export async function api<T = any>(path: string, body?: unknown, csrf?: string): Promise<T> {
    const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json() as any;
    if (!response.ok)
        throw new Error(data.error || '请求失败');
    return data;
}
export const money = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
export const date = (value: number) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
export const statuses: Record<string, string> = { pending: '待付款', paid: '已支付', fulfilled: '已发货', expired: '已过期', cancelled: '已取消', refunded: '已退款', available: '可售', reserved: '已锁定', delivered: '已交付', open: '待处理', closed: '已关闭' };
