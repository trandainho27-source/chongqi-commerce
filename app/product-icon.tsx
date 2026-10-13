import { Box, Code2, FileText, Headphones } from 'lucide-react';
import type { Product } from '@/lib/commerce/types';

const names: Record<string, string> = { telegram: 'Telegram', x: 'X', apple: 'Apple', google: 'Google', openai: 'ChatGPT / OpenAI', outlook: 'Microsoft Outlook', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp' };
const aliases: Record<string, string> = { twitter: 'x', gpt: 'openai', ai: 'openai', microsoftoutlook: 'outlook', send: 'telegram' };
const categoryBrands: Record<string, string> = { 'dp-cat-1': 'telegram', 'dp-cat-10': 'telegram', 'dp-cat-11': 'telegram', 'dp-cat-2': 'telegram', 'dp-cat-5': 'x', 'dp-cat-3': 'apple', 'dp-cat-4': 'google', 'dp-cat-6': 'openai' };
const flags = new Set('AR BD BR BZ CA CL CN CO CU EC EG GB GL HK ID IN IR JP KH KR LK MM MY NG PH PK PL RU TH TR TW US UZ VN'.split(' '));
type IconProduct = Pick<Product, 'category_id' | 'icon_key' | 'country_code'> & { name?: string };
function brandFor(product: IconProduct) {
    const explicit = product.icon_key?.toLowerCase() || '', key = aliases[explicit] || explicit;
    if (names[key]) return key;
    // API-synced and manually added listings can have a generic icon key.
    const name = product.name || '';
    for (const [pattern, brand] of [[/chatgpt|openai|codex|\bgpt\b/i, 'openai'], [/telegram|电报|\btg\b/i, 'telegram'], [/twitter|推特|\bx\b/i, 'x'], [/outlook|hotmail|微软邮箱/i, 'outlook'], [/google|gmail|谷歌/i, 'google'], [/apple|苹果|美区.?id|香港.?id|日本.?id|韩国.?id/i, 'apple'], [/instagram|\bins\b/i, 'instagram'], [/whatsapp/i, 'whatsapp'], [/facebook/i, 'facebook']] as const) {
        if (pattern.test(name)) return brand;
    }
    return categoryBrands[product.category_id] || aliases[product.category_id] || product.category_id;
}
export default function ProductIcon({ product, large = false }: { product: IconProduct; large?: boolean }) {
    const key = brandFor(product), label = names[key];
    const Icon = ({ software: Code2, digital: FileText, service: Headphones } as any)[key] || Box;
    return <div className={`product-icon brand-product brand-${key.replace(/[^a-z]/g, '')} ${large ? 'large' : ''}`} role="img" aria-label={names[key] || '数字商品'}>
        {label ? <img className="platform-logo" src={'/logos/' + key + '.svg'} alt="" width={large ? 58 : 42} height={large ? 58 : 42} decoding="async"/> : <Icon size={large ? 42 : 29}/>}
        {product.country_code && flags.has(product.country_code) && <span className="country-badge" title={product.country_code}><img src={'/flags/' + product.country_code.toLowerCase() + '.svg'} width="24" height="18" alt={product.country_code} loading="lazy"/></span>}
    </div>;
}
