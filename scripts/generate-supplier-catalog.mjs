// Reproduce the public catalog migration from a reviewed factual snapshot.
// This script does not call the supplier, purchase goods or connect to any database.
import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('data/didipifa-catalog.json', 'utf8'));
const q = x => x === null ? 'NULL' : typeof x === 'number' ? String(x) : "'" + String(x).replaceAll("'", "''") + "'";
const commands = [], ts = Date.parse(d.snapshotAt);
const icons = { 1: 'send', 10: 'send', 11: 'send', 5: 'twitter', 3: 'apple', 4: 'globe', 6: 'sparkles', 8: 'box', 2: 'headphones' };
d.categories.forEach((c, i) => commands.push('INSERT OR IGNORE INTO categories VALUES(' + ['dp-cat-' + c.id, c.name, icons[c.id], i + 10, 1].map(q).join(',') + ');'));
d.products.forEach((p, i) => {
    const id = p.goodsId ? 'dp-' + p.goodsId : 'dp-unmapped-4a', region = p.region || '全球';
    const category = d.categories.find(c => c.id === p.categoryId).name;
    let reason = p.reviewReasons.join('；');
    if (p.categoryId === 2) reason ||= '供应商业务或服务链接，需人工核对，暂不开放 API 采购';
    if (!p.goodsId) reason = '公开页面未提供商品编号，暂不开放 API 采购';
    const values = [id, 'dp-cat-' + p.categoryId, p.name, category + ' · ' + region, category + '，适用地区：' + region + '。具体规格见商品名称。', '购买前请确认适用地区、有效期、登录方式及商品名称中的限制条件。请妥善保存订单号和查询密钥。', p.displayPriceCents, 0, 1, 30, /💎|👍/.test(p.name) ? 1 : 0, 1, region, p.categoryId === 2 ? '服务目录' : '数字商品', 0, ts - i, p.icon.platform, p.regionCode || ''];
    commands.push('INSERT OR IGNORE INTO products(id,category_id,name,subtitle,description,instructions,price,compare_price,min_qty,max_qty,featured,active,region,tag,is_example,created_at,icon_key,country_code) VALUES(' + values.map(q).join(',') + ');');
    commands.push('INSERT OR IGNORE INTO supplier_goods(product_id,goods_id,source_url,reference_price,upstream_stock,delivery_type,blocked_reason,synced_at,origin) VALUES(' + [id, p.goodsId, p.sourceUrl || d.sourceUrl, p.displayPriceCents, 0, p.deliveryType, reason, null, 'public'].map(q).join(',') + ');');
});
writeFileSync('drizzle/0006_didipifa_catalog.sql', '-- Public catalog snapshot 2026-10-13. No local card stock is created.\n' + commands.join('\n--> statement-breakpoint\n') + '\n');
console.log(`Prepared ${d.products.length} products and ${d.categories.length} categories.`);
