import {spawnSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','webapp/vite.config.mjs'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
const source=path.resolve('webapp/dist'),publicDir=path.resolve('webapp/public');
for(const name of ['assets','reader','read'])await rm(path.join(publicDir,name),{recursive:true,force:true});
await mkdir(path.join(publicDir,'read'),{recursive:true});
for(const entry of await readdir(source)){if(entry==='index.html')await cp(path.join(source,entry),path.join(publicDir,'read/index.html'));else await cp(path.join(source,entry),path.join(publicDir,entry),{recursive:true});}
const html=await readFile(path.join(publicDir,'read/index.html'),'utf8');
const assets=['/read/','/manifest.webmanifest','/app-icon.png','/apple-touch-icon.png',...Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),m=>m[1])];
const version=crypto.createHash('sha256').update(html).update(await readFile(new URL(import.meta.url))).update(await readFile(path.join(publicDir,'manifest.webmanifest'))).digest('hex').slice(0,12);
const sw=`const CACHE='wenjian-web-${version}';const SHELL='/read/';const CORE=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const url of CORE){const r=await fetch(url,{cache:'reload',credentials:'same-origin',redirect:'error'});if(!r.ok||url===SHELL&&!(await r.clone().text()).includes('id="root"'))throw Error('离线资源未完整下载');await cache.put(url,r);}})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('wenjian-web-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.includes('signin')||url.pathname.includes('signout')||url.pathname==='/callback')return;
if(request.mode==='navigate'){if(!['/','/read/','/read/index.html'].includes(url.pathname))return;event.respondWith((async()=>{const cache=await caches.open(CACHE),saved=await cache.match(SHELL);if(saved)return saved;return fetch(request);})());return;}
if(!['/assets/','/reader/'].some(prefix=>url.pathname.startsWith(prefix))&&!CORE.includes(url.pathname))return;event.respondWith((async()=>{const cache=await caches.open(CACHE),saved=await cache.match(request);if(saved)return saved;const r=await fetch(request);if(r.ok&&!r.redirected&&r.type==='basic'){try{await cache.put(request,r.clone());}catch{}}return r;})());});`;
await writeFile(path.join(publicDir,'sw.js'),sw);
console.log(JSON.stringify({pwaVersion:version,offlineShell:assets.length,output:publicDir}));
