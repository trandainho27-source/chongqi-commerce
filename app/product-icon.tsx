import { Apple, Box, Code2, FileText, Globe, Headphones, Mail, Send, Sparkles } from 'lucide-react';
import type { Product } from '@/lib/commerce/types';

const names: Record<string, string> = { telegram: 'Telegram', twitter: 'X', apple: 'Apple', google: 'Google', gpt: 'GPT', ai: 'AI', outlook: 'Outlook', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp' };
const flags = new Set('AR BD BR BZ CA CL CN CO CU EC EG GB GL HK ID IN IR JP KH KR LK MM MY NG PH PK PL RU TH TR TW US UZ VN'.split(' '));
export default function ProductIcon({ product, large = false }: { product: Pick<Product, 'category_id' | 'icon_key' | 'country_code'>; large?: boolean }) {
    const original = product.icon_key || product.category_id;
    const key = original === 'x' ? 'twitter' : original;
    const Icon = ({ telegram: Send, apple: Apple, gpt: Sparkles, ai: Sparkles, outlook: Mail, software: Code2, digital: FileText, service: Headphones } as any)[key] || Box;
    const mark = ({ twitter: '𝕏', google: 'G', instagram: '◎', facebook: 'f', whatsapp: 'W' } as Record<string, string>)[key];
    return <div className={`product-icon brand-product brand-${key.replace(/[^a-z]/g, '')} ${large ? 'large' : ''}`} role="img" aria-label={names[key] || '数字商品'}>
        {mark ? <span className="platform-letter">{mark}</span> : <Icon size={large ? 42 : 29} strokeWidth={key === 'telegram' ? 2.6 : 2} />}
        {product.country_code && flags.has(product.country_code) && <span className="country-badge" title={product.country_code}><img src={'/flags/' + product.country_code.toLowerCase() + '.svg'} width="24" height="18" alt={product.country_code} loading="lazy"/></span>}
    </div>;
}
