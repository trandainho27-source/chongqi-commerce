import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=wranglerRequire('miniflare');
const files=readdirSync('dist/server',{recursive:true}).filter(f=>f.endsWith('.js')||f.endsWith('.mjs'));
files.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
const mf=new Miniflare({modules:files.map(f=>({type:'ESModule',path:resolve('dist/server',f)})),modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'worker-test-db'},bindings:{DEMO_MODE:'true',INVENTORY_KEY:'b'.repeat(64)},assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},cf:false});
try{
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
  for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 }
 const request=async(path,body,cookie='',csrf='')=>mf.dispatchFetch('https://store.test'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://store.test',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie,'x-csrf-token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 for(const path of ['/','/orders','/help','/admin']){const response=await request(path);assert.equal(response.status,200,`${path} should render`);assert.match(await response.text(),/重启|RESTART/);}
 const catalogResponse=await request('/api/catalog');assert.equal(catalogResponse.status,200);const catalog=await catalogResponse.json();assert.equal(catalog.products.length,12);
 const login=await request('/api/auth/demo',{});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
 const ordered=await request('/api/orders',{contact:'workerd-smoke@test.invalid',acceptedTerms:true,items:[{id:catalog.products[0].id,quantity:1}]});assert.equal(ordered.status,201);const order=await ordered.json();
 const confirmed=await request('/api/admin/orders',{id:order.id,reference:'smoke-001',reason:'演示验证，非真实收款'},cookie,csrf);assert.equal(confirmed.status,200);
 const delivered=await request('/api/orders/lookup',{id:order.id,secret:order.secret});assert.equal(delivered.status,200);const result=await delivered.json();assert.equal(result.status,'fulfilled');assert.equal(result.delivery.length,1);
 console.log('Cloudflare workerd verification passed: 4 SSR routes, D1 migrations, catalog, session, order, encrypted fulfillment.');
}finally{await mf.dispose();}

// Production-shaped payment flow: only the upstream chain responses are mocked.
// Requests, D1 transactions, stock encryption and the scheduled handler run in workerd.
const receivingAddress='TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL';
const receivingHex='8840e6c55b9ada326d211d818c34a994aeced808';
const txId='e'.repeat(64);
let invoice;
const prod=new Miniflare({modules:files.map(f=>({type:'ESModule',path:resolve('dist/server',f)})),modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'payment-worker-test-db'},bindings:{DEMO_MODE:'false',INVENTORY_KEY:'b'.repeat(64),BOOTSTRAP_TOKEN:'worker-test-bootstrap',PAYMENT_PROVIDER:'trc20',TRON_RECEIVING_ADDRESS:receivingAddress,TRONGRID_API_KEY:'worker-test-query-key',USDT_CNY_RATE:'7'},assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},cf:false,
 outboundService:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.trongrid.io');assert.equal(request.headers.get('TRON-PRO-API-KEY'),'worker-test-query-key');
  if(url.pathname.includes('/transactions/trc20'))return Response.json({success:true,data:[],meta:{}});
  const body=await request.json();assert.equal(body.value,txId);
  if(url.pathname.endsWith('/gettransactionbyid'))return Response.json({txID:txId,ret:[{contractRet:'SUCCESS'}]});
  assert.ok(url.pathname.endsWith('/gettransactioninfobyid'));
  return Response.json({id:txId,blockNumber:123,blockTimeStamp:invoice.created_at+1,receipt:{result:'SUCCESS'},log:[{address:'a614f803b6fd780986a42c78ec9c7f77e6ded13c',topics:['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0'.repeat(24)+'1'.repeat(40),'0'.repeat(24)+receivingHex],data:BigInt(invoice.amount.replace('.','')).toString(16).padStart(64,'0')}]});
 }
});
try{
 const db=await prod.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 let cookie='',csrf='';
 const request=async(path,body)=>{
  const r=await prod.dispatchFetch('https://store.test/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://store.test',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie,'x-csrf-token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();assert.ok(r.ok,path+': '+JSON.stringify(data));
  if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  if(data.csrf)csrf=data.csrf;return data;
 };
 await request('auth/setup',{username:'worker-owner',password:'worker-test-password-2026',token:'worker-test-bootstrap'});
 await request('admin/categories',{id:'test-category',name:'运行时测试',sort:0,active:true});
 await request('admin/products',{id:'test-product',category_id:'test-category',name:'测试交付商品',price:700,min_qty:1,max_qty:1,active:true});
 await request('admin/inventory',{product_id:'test-product',codes:'WORKER-USDT-DELIVERY-FIXTURE'});
 assert.equal((await request('catalog')).paymentEnabled,true);
 const order=await request('orders',{contact:'payment-runtime@test.invalid',acceptedTerms:true,items:[{id:'test-product',quantity:1}]});
 invoice=await request('payments/create',order);assert.equal(invoice.address,receivingAddress);
 const checked=await request('payments/check',{...order,txId});assert.equal(checked.order.status,'fulfilled');assert.equal(checked.order.delivery[0],'WORKER-USDT-DELIVERY-FIXTURE');
 const again=await request('payments/check',{...order,txId});assert.equal(again.order.payment.status,'confirmed');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM payment_receipts').first()).n,1);
 const worker=await prod.getWorker();await worker.scheduled({cron:'* * * * *'});
 assert.ok((await db.prepare('SELECT last_success_at FROM payment_watchers').first()).last_success_at);
 console.log('Cloudflare workerd TRC20 verification passed: production bootstrap, invoice, upstream receipt verification, atomic delivery, replay, background scheduled handler. No real funds or external RPC used.');
}finally{await prod.dispose();}
