/* Generic app shell only. Never cache login redirects, auth routes, cookies,
   user pages, external URLs, or an arbitrary navigation. Local timer data is
   kept by the app in localStorage, not copied into any server response cache. */
const BASE=new URL('./',self.location.href);
const CACHE_PREFIX=`bar-time:${BASE.pathname}:`;
const CACHE=`${CACHE_PREFIX}shell-v4`;
const FILES=['./','./index.html','./style.css','./app.mjs','./engine.mjs','./alarm.mjs','./focus.mjs','./digits.mjs','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png','./style.css?v=4','./app.mjs?v=4','./engine.mjs?v=4','./alarm.mjs?v=4','./focus.mjs?v=4','./digits.mjs?v=4','./manifest.webmanifest?v=4','./icons/icon.svg?v=4','./icons/icon-192.png?v=4','./icons/icon-512.png?v=4','./icons/maskable-512.png?v=4','./icons/apple-touch-icon.png?v=4'];
const ALLOWED=new Set(FILES.map(p=>new URL(p,BASE).href));
function allowed(request){const url=new URL(request.url);return request.method==='GET'&&url.origin===BASE.origin&&ALLOWED.has(url.href);}
async function valid(request,response){
  if(!response.ok||response.redirected||response.type==='opaque'||response.url!==request.url)return false;
  const p=new URL(request.url).pathname;
  if(p===BASE.pathname||p===BASE.pathname+'index.html')return response.headers.get('content-type')?.includes('text/html')&&(await response.clone().text()).includes('<meta name="bar-time-shell" content="v4">');
  const type=response.headers.get('content-type')||'';
  if(p.endsWith('.js')||p.endsWith('.mjs'))return /javascript/.test(type);
  if(p.endsWith('.css'))return type.includes('text/css');
  if(p.endsWith('.webmanifest'))return /json|manifest/.test(type);
  return type.startsWith('image/');
}
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const responses=await Promise.all(FILES.map(async path=>{const request=new Request(new URL(path,BASE),{credentials:'same-origin',cache:'reload'});const response=await fetch(request);if(!await valid(request,response))throw new Error('App shell unavailable');return [request,response];}));
  const cache=await caches.open(CACHE);for(const [request,response]of responses)await cache.put(request,response);
  await self.skipWaiting();
})());});
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(CACHE_PREFIX)&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const request=event.request;if(!allowed(request))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{try{
      // Online authorization always wins: return 401/403/login as-is; never fall
      // back to cached HTML on an authorization response or server error.
      const response=await fetch(new Request(request,{cache:'no-store'}));
      if(await valid(request,response)){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}
      return response;
    }catch{return await (await caches.open(CACHE)).match(request)||Response.error();}})());
  }else event.respondWith((async()=>{const cached=await (await caches.open(CACHE)).match(request);if(cached)return cached;const response=await fetch(request);if(await valid(request,response)){const cache=await caches.open(CACHE);await cache.put(request,response.clone());}return response;})());
});
