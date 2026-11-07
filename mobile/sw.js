/* Offline shell for /mobile only. User photos and AI POST calls are never cached. */
const CACHE="ee-pocket-shell-v1";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png","../js/wardrobe-db.js","../js/travel-capsule.js"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("ee-pocket-shell-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
 const req=event.request;
 if(req.method!=="GET")return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
 const staticAsset=ASSETS.some(asset=>new URL(asset,self.registration.scope).pathname===url.pathname);
 if(!staticAsset)return;
 event.respondWith(fetch(req).then(response=>{
  if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
  return response;
 }).catch(()=>caches.match(req).then(cached=>cached||Response.error())));
});
