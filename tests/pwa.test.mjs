import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const dist=path.resolve('dist');
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(dist,'manifest.webmanifest'),'utf8'));
const base='https://timer.example/';
function response(body,{url=base,status=200,type='basic',redirected=false,contentType='text/html'}={}){return {url,status,ok:status>=200&&status<300,type,redirected,headers:new Headers({'content-type':contentType}),text:async()=>body,clone(){return response(body,{url,status,type,redirected,contentType});}};}
function harness(fetchFn, scope=base) {
  const events={}, data=new Map(), stores=new Map();
  const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const m=stores.get(name);return {put:async(r,v)=>m.set(r.url||r,v),match:async r=>m.get(r.url||r)};},keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),match:async request=>{for(const store of stores.values())if(store.has(request.url||request))return store.get(request.url||request);}};
  const context={URL,Request,Response,caches,fetch:(...args)=>fetchFn(...args),self:{location:{href:scope+'sw.js'},addEventListener:(e,cb)=>events[e]=cb,skipWaiting:async()=>{},clients:{claim:async()=>{}}}};
  vm.runInNewContext(fs.readFileSync(path.join(dist,'sw.js'),'utf8'),context);
  return {events,caches,stores,data};
}
async function seed(h,url=base,body=html){const c=await h.caches.open('bar-time:/:shell-v4');await c.put(new Request(url),response(body,{url}));}
async function request(h,url,mode='navigate'){let pending;const req=new Request(url);Object.defineProperty(req,'mode',{value:mode});h.events.fetch({request:req,respondWith:p=>pending=p});return pending ? {intercepted:true,response:await pending} : {intercepted:false};}
test('manifest is Japanese, scoped, standalone, and all icon dimensions match',()=>{
  assert.equal(manifest.lang,'ja');assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');
  for(const icon of manifest.icons){const p=path.resolve(dist,icon.src.split('?')[0]);assert(p.startsWith(dist));const png=fs.readFileSync(p);assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);}
  assert(manifest.icons.some(x=>x.sizes==='192x192'&&x.purpose==='any'));assert(manifest.icons.some(x=>x.sizes==='512x512'&&x.purpose==='maskable'));
});
test('all local HTML references exist, IDs are unique, and no external assets required',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
  for(const m of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))assert(fs.existsSync(path.resolve(dist,m[1].split('?')[0])));
  assert(!/src="https?:/.test(html));assert(html.includes('bar-time-shell'));assert(html.includes('画面を閉じたり'));assert(html.includes('アカウント同期なし'));
});
test('service-worker installs only the validated same-origin shell',async()=>{
  const h=harness(async req=>{const p=new URL(req.url).pathname;const file=p==='/'?'index.html':p.slice(1);const type=p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.webmanifest')?'application/manifest+json':p.endsWith('.png')?'image/png':p.endsWith('.svg')?'image/svg+xml':'text/html';return response(fs.readFileSync(path.join(dist,file),'utf8'),{url:req.url,contentType:type});});
  let done;h.events.install({waitUntil:p=>done=p});await done;const cache=h.stores.get('bar-time:/:shell-v4');assert.equal(cache.size,26);assert(cache.has(base));assert(cache.has(base+'app.mjs'));
});
test('service-worker rejects login HTML during install without caching it',async()=>{
  const h=harness(async req=>response('<h1>Sign in</h1>',{url:req.url}));let done;h.events.install({waitUntil:p=>done=p});await assert.rejects(done,/App shell unavailable/);assert.equal(h.stores.size,0);
});
test('service-worker rejects redirects during install',async()=>{
  const h=harness(async req=>response(html,{url:req.url,redirected:true}));let done;h.events.install({waitUntil:p=>done=p});await assert.rejects(done,/App shell unavailable/);assert.equal(h.stores.size,0);
});
test('auth paths, query-bearing URLs, third-party and arbitrary paths are not intercepted',async()=>{
  const h=harness(async()=>{throw Error('should not fetch');});for(const url of [base+'signin-with-chatgpt',base+'callback?code=abc',base+'?token=private','https://elsewhere.example/',base+'private-record'])assert.equal((await request(h,url)).intercepted,false);
});
test('online authorization denial never falls back to cached HTML',async()=>{
  const h=harness(async req=>response('denied',{url:req.url,status:403}));await seed(h);const result=await request(h,base);assert.equal(result.response.status,403);assert.equal(await result.response.text(),'denied');
});
test('online login response and server failures are preserved and not cached',async()=>{
  for(const status of [200,500]){const h=harness(async req=>response('<h1>Login or error</h1>',{url:req.url,status}));await seed(h);const result=await request(h,base);assert.equal(await result.response.text(),'<h1>Login or error</h1>');assert.equal(await (await h.caches.match(base)).text(),html);}
});
test('a genuine network failure can use cached generic app shell offline',async()=>{
  const h=harness(async()=>{throw Error('offline');});await seed(h);const result=await request(h,base);assert.equal(await result.response.text(),html);
});
test('cached allowlisted static assets work offline',async()=>{
  const h=harness(async()=>{throw Error('offline');});await seed(h,base+'style.css','body{}');const result=await request(h,base+'style.css','cors');assert.equal(await result.response.text(),'body{}');
});

test('v4 assets bypass older installed caches and all versioned imports are precached',()=>{
 assert.match(html,/app\.mjs\?v=4/);assert.match(html,/style\.css\?v=4/);const app=fs.readFileSync(path.join(dist,'app.mjs'),'utf8');assert.match(app,/engine\.mjs\?v=4/);assert.match(app,/alarm\.mjs\?v=4/);const sw=fs.readFileSync(path.join(dist,'sw.js'),'utf8');for(const file of ['app.mjs','style.css','engine.mjs','alarm.mjs','focus.mjs','digits.mjs','manifest.webmanifest'])assert(sw.includes(file+'?v=4'));
});
test('exact versioned static asset is usable offline; arbitrary queries stay outside the cache',async()=>{
 const h=harness(async()=>{throw Error('offline');});await seed(h,base+'style.css?v=4','body{color:black}');const result=await request(h,base+'style.css?v=4','cors');assert.equal(await result.response.text(),'body{color:black}');assert.equal((await request(h,base+'style.css?token=secret','cors')).intercepted,false);
});

test('Pages path activation preserves sibling deployment caches',async()=>{
 const h=harness(async()=>{throw Error('offline');},base+'bar-time/');
 for(const name of ['bar-time:/bar-time/:shell-v2','bar-time:/other/:shell-v2','bar-time:/:shell-v4'])await h.caches.open(name);
 let done;h.events.activate({waitUntil:p=>done=p});await done;
 assert(!h.stores.has('bar-time:/bar-time/:shell-v2'));
 assert(h.stores.has('bar-time:/other/:shell-v2'));assert(h.stores.has('bar-time:/:shell-v4'));
 const c=await h.caches.open('bar-time:/bar-time/:shell-v4');await c.put(base+'bar-time/',response(html,{url:base+'bar-time/'}));
 assert.equal(await (await request(h,base+'bar-time/')).response.text(),html);
 assert.equal((await request(h,base)).intercepted,false);
});
