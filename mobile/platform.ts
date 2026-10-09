import {App} from '@capacitor/app';
import {PREVIEW_VERSION,validReleaseUrl} from '../lib/app-updates';
import {Capacitor,registerPlugin} from '@capacitor/core';
import {initialNotebook,normalize,type Notebook,type LibraryBook} from '../lib/notebook';
import {validOcrEntry,mergeOcrPage} from '../lib/ocr-cache.cjs';
import {setReaderPlatform} from '../lib/reader-platform';
import type {Envelope} from '../lib/sync/client';
import {newSyncState} from '../lib/sync/core';
type CloudFile={key:string;sha256:string;size:number};
type Config={configured:boolean;region?:string;bucket?:string;prefix?:string;accessKeyId?:string};
interface NativeStorage{appReleases():Promise<{releases:unknown[]}>;openRelease(input:{url:string}):Promise<{ok:boolean}>;connectSync(input:{config:unknown}):Promise<unknown>;detachSync(input:{target:string}):Promise<unknown>;getSyncIdentity():Promise<{provider:string;configured:boolean;target:string}>;setSyncConnection(input:{config:unknown}):Promise<unknown>;readStore():Promise<{text?:string}>;writeStore(input:{text:string}):Promise<{ok:boolean}>;bookInfo(input:{name:string}):Promise<{available:boolean;uri:string}>;importBook():Promise<{cancelled?:boolean;name:string;storedFile:string;format:'pdf'|'epub'}>;getConfig():Promise<Config>;setConfig(input:{config:unknown}):Promise<Config>;remote(input:unknown):Promise<unknown>;transferBook(input:{name:string;action:string;file?:CloudFile;target?:string}):Promise<CloudFile>}
const native=registerPlugin<NativeStorage>('WenjianStorage');
const isNative=Capacitor.isNativePlatform();
type Store=Envelope&{drafts:Record<string,unknown>};
let queue:Promise<unknown>=Promise.resolve(),cached:Store|undefined;
const copy=<T,>(value:T):T=>structuredClone(value);
function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('wenjian-mobile-preview',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function dbGet<T>(key:string):Promise<T|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}}
async function dbPut(key:string,value:unknown){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
async function readStore():Promise<Store>{if(cached)return copy(cached);const text=isNative?(await native.readStore()).text:await dbGet<string>('store');if(text){const value=JSON.parse(text);if(!Number.isSafeInteger(value.version)||!Array.isArray(value.data?.notes))throw Error('本机资料读取失败，未创建空白资料覆盖它。');cached={...value,data:normalize(value.data),drafts:value.drafts||{}};}else cached={version:0,data:copy(initialNotebook),drafts:{},sync:newSyncState()};return copy(cached!);}
async function writeStore(value:Store){const text=JSON.stringify(value);if(isNative)await native.writeStore({text});else await dbPut('store',text);cached=copy(value);return copy(value);}
function serial<T>(operation:()=>Promise<T>):Promise<T>{const result=queue.then(operation);queue=result.catch(()=>{});return result;}
export async function mobileSnapshot(){return serial(readStore);}
export async function mobileSave(data:Notebook,version:number){return serial(async()=>{const current=await readStore();if(current.version!==version)throw Error('有新内容刚同步完成，请保留当前输入后重新保存。');return writeStore({...current,version:version+1,data:copy(data)});});}
async function available(book:LibraryBook){return isNative?(await native.bookInfo({name:book.storedFile})).available:!!await dbGet<Blob>('book/'+book.storedFile);}
export async function mobileBookAvailable(book:LibraryBook){return available(book);}
const objectUrls=new Map<string,string>();
setReaderPlatform({mobile:true,fileUrl:async book=>{if(!await available(book)){if(!book.cloudFile)throw Error('这本书还没有上传，请先在电脑开启三端同步。');if(!isNative)throw Error('浏览器预览不连接个人云端。');await native.transferBook({name:book.storedFile,action:'download',file:book.cloudFile,target:(await mobileSnapshot()).sync?.target});}if(isNative)return Capacitor.convertFileSrc((await native.bookInfo({name:book.storedFile})).uri);if(!objectUrls.has(book.storedFile)){const blob=await dbGet<Blob>('book/'+book.storedFile);objectUrls.set(book.storedFile,URL.createObjectURL(blob!));}return objectUrls.get(book.storedFile)!;}});
export async function importMobileBook(){let imported:{name:string;storedFile:string;format:'pdf'|'epub'};
 if(isNative){const result=await native.importBook();if(result.cancelled)return null;imported=result;}else{const file=await new Promise<File|null>(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.pdf,.epub';input.onchange=()=>resolve(input.files?.[0]||null);input.addEventListener('cancel',()=>resolve(null));input.click();});if(!file)return null;const format=file.name.toLowerCase().endsWith('.epub')?'epub':'pdf';const storedFile=crypto.randomUUID()+'.'+format;await dbPut('book/'+storedFile,file);imported={name:file.name,storedFile,format};}
 return serial(async()=>{const current=await readStore();const existing=current.data.libraryBooks.find(book=>book.storedFile===imported.storedFile);if(existing)return {book:existing,...current};const book:LibraryBook={id:crypto.randomUUID(),title:imported.name.replace(/\.(pdf|epub)$/i,''),author:'',originalName:imported.name,storedFile:imported.storedFile,format:imported.format,addedAt:new Date().toISOString(),progress:{},inReadingLibrary:true};const saved=await writeStore({...current,version:current.version+1,data:{...current.data,libraryBooks:[...current.data.libraryBooks,book]}});return {...saved,book};});
}
export async function mobileConfig():Promise<Config>{return isNative?native.getConfig():{configured:false};}
export async function saveMobileConfig(config:unknown){if(!isNative)throw Error('浏览器预览不保存云端密钥，请在安卓 App 中配置。');return native.setConfig({config});}
const originalFetch=window.fetch.bind(window);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
export function installMobileApi(){window.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;const route=new URL(url,location.origin).pathname;if(!route.startsWith('/api/'))return originalFetch(input,init);
 try{const payload=typeof init?.body==='string'?JSON.parse(init.body):{},method=init?.method||'GET';
  if(route==='/api/app/info')return json(isNative?{...await App.getInfo(),platform:'android',arch:'universal'}:{version:PREVIEW_VERSION,build:'preview',platform:'android',arch:'universal'});
  if(route==='/api/app/releases'){if(isNative)return json((await native.appReleases()).releases);const response=await originalFetch('/api/app/releases');return response;}
  if(route==='/api/app/open'){if(!validReleaseUrl(payload.url))throw Error('发布链接无效');if(isNative)return json(await native.openRelease({url:payload.url}));window.open(payload.url,'_blank','noopener,noreferrer');return json({ok:true});}
  if(route==='/api/library/import'){const result=await importMobileBook();return json(result?{...result,imported:[result.book]}:{cancelled:true});}
  if(route==='/api/sync/identity')return json(isNative?await native.getSyncIdentity():{provider:'oss',configured:false,target:''});
  if(route==='/api/sync/settings'){if(!isNative)throw Error('浏览器预览不保存云端密码，请在 App 中配置。');return await serial(async()=>{try{return json(await native.setSyncConnection({config:payload}));}finally{cached=undefined;}});}
  if(route==='/api/sync/connect'||route==='/api/sync/test'||route==='/api/sync/detach'){if(!isNative)throw Error('浏览器预览不连接个人云端，请在 App 中操作。');return await serial(async()=>{try{if(route.endsWith('/detach'))return json(await native.detachSync({target:payload.target||''}));const identity=await native.getSyncIdentity();return json(await native.connectSync({config:route.endsWith('/test')?{...identity,password:''}:payload}));}finally{cached=undefined;}});}
  if(route==='/api/sync/remote'){if(!isNative)throw Error('预览版本不连接云端');return json(await native.remote(payload));}
  if(route==='/api/sync/book'){
   const book=(await mobileSnapshot()).data.libraryBooks.find(b=>b.id===payload.id);if(!book)throw Error('没有找到这本书');
   if(payload.action==='status')return json({available:await available(book)});
   if(!isNative)throw Error('请在安卓 App 传输书籍');
   const file=await native.transferBook({name:book.storedFile,action:payload.action,file:book.cloudFile,target:payload.target||(await mobileSnapshot()).sync?.target});
   if(payload.action==='upload')await serial(async()=>{const current=await readStore();await writeStore({...current,version:current.version+1,data:{...current.data,libraryBooks:current.data.libraryBooks.map(b=>b.id===book.id?{...b,cloudFile:file}:b)}});});return json({ok:true,cloudFile:file});
  }
  return await serial(async()=>{
   const current=await readStore();
   if(route==='/api/sync/local'||route==='/api/notebook'&&method==='GET')return json(current);
   if(route==='/api/drafts'){if(method==='GET')return json({drafts:current.drafts});if(method==='PUT'&&typeof payload.key==='string'){await writeStore({...current,drafts:{...current.drafts,[payload.key]:payload.value}});return json({ok:true});}}
   if(route==='/api/sync/commit'){if(payload.version!==current.version||(payload.syncRevision||0)!==(current.syncRevision||0))return json({error:'本机刚保存新内容'},409);if(!payload.data?.notes?.length||payload.sync?.schema!==1)throw Error('同步资料不完整');return json(await writeStore({...current,version:current.version+(JSON.stringify(current.data)===JSON.stringify(payload.data)?0:1),syncRevision:(current.syncRevision||0)+1,data:normalize(payload.data),sync:payload.sync}));}
   if(route==='/api/notebook'){
    if(payload.version!==current.version)return json({error:'资料已更新'},409);
    if(method==='PATCH'){if(!validOcrEntry(payload.entry))return json({error:'识别缓存无效'},400);if(!current.data.libraryBooks.some(b=>b.id===payload.entry.libraryBookId))return json({error:'书籍已移除'},404);return json(await writeStore({...current,version:current.version+1,data:mergeOcrPage(current.data,payload.entry)}));}
    if(method==='PUT')return json(await writeStore({...current,version:current.version+1,data:normalize(payload.data)}));
   }
   return json({error:'此操作请在电脑端完成'},501);
  });
 }catch(error){const text=error instanceof Error?error.message:'本地操作没有完成';const match=/（(401|403|429|507)）/.exec(text);return json({error:text,code:match?Number(match[1]):undefined},500);}
};}
