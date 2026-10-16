import {beginWebLease,endWebLease} from './lease';
import {dbGet,dbPut,dbDelete,dbKeys} from './storage';
import * as webCloud from './nutstore';
import {downloadBook as webDownload,uploadBook as webUpload} from './books';
import {jsonEqual} from '../lib/value-equal';
import {readChunkedStore,writeChunkedStore,type StoreChunks} from '../mobile/native-store';
import {setSyncTransport} from '../lib/sync/client';
import {setLeaseRecovery} from '../lib/sync/protocol';
import {archiveRecords,restoreArchived,archiveGroups,purgeArchiveBatch,visibleNotebook} from '../lib/record-archives.cjs';
import {validSettings,validateCoreTransition,validateReadingTransition} from '../lib/notebook-settings.cjs';
import {removeRecords,maintenanceReceipt,restoreMaintenance,type MaintenanceReceipt} from '../lib/maintenance.cjs';
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
interface NativeStorage extends StoreChunks{beginSyncLease(input:{target:string;owner:string}):Promise<{recoverableOwners:string[];deviceName:string}>;finishSyncLease(input:{target:string;owner:string;released:boolean;succeeded:boolean}):Promise<unknown>;exportDiagnostics():Promise<unknown>;appUpdate(input:{action:string;version?:string;manifestUrl?:string}):Promise<unknown>;backupLocal():Promise<{backupPath:string}>;appReleases():Promise<{releases:unknown[]}>;openRelease(input:{url:string}):Promise<{ok:boolean}>;connectSync(input:{config:unknown}):Promise<unknown>;detachSync(input:{target:string}):Promise<unknown>;getSyncIdentity():Promise<{provider:string;configured:boolean;target:string}>;setSyncConnection(input:{config:unknown}):Promise<unknown>;readStore():Promise<{text?:string}>;writeStore(input:{text:string}):Promise<{ok:boolean}>;bookInfo(input:{name:string}):Promise<{available:boolean;uri:string;size:number}>;importBook():Promise<{cancelled?:boolean;name:string;storedFile:string;format:'pdf'|'epub'}>;getConfig():Promise<Config>;setConfig(input:{config:unknown}):Promise<Config>;remote(input:unknown):Promise<unknown>;transferBook(input:{name:string;action:string;file?:CloudFile;target?:string}):Promise<CloudFile>}
const native=registerPlugin<NativeStorage>('WenjianStorage');
const isNative=Capacitor.isNativePlatform();
const chunked=isNative&&Capacitor.getPlatform?.()==='android';
type Store=Envelope&{drafts:Record<string,unknown>;localTrash?:MaintenanceReceipt[]};
const webChannel=!isNative&&typeof BroadcastChannel!=='undefined'?new BroadcastChannel('wenjian-web-data'):null;
webChannel?.addEventListener('message',()=>{void mobileViewSnapshot().then(value=>window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:value}))).catch(()=>{});});
let queue:Promise<unknown>=Promise.resolve(),cached:Store|undefined;
const copy=<T,>(value:T):T=>structuredClone(value);
async function peekStore():Promise<Store>{if(cached)return cached;const text=isNative?(chunked?await readChunkedStore(native):(await native.readStore()).text):await dbGet<string>('store');if(text){const value=JSON.parse(text);if(!Number.isSafeInteger(value.version)||!Array.isArray(value.data?.notes))throw Error('本机资料读取失败，未创建空白资料覆盖它。');cached={...value,data:normalize(value.data),drafts:value.drafts||{}};}else cached={version:0,data:copy(initialNotebook),drafts:{},sync:newSyncState()};return cached!;}
const authoringView=(store:Store):Store=>({version:store.version,syncRevision:store.syncRevision,data:store.data,drafts:store.drafts});
async function readStore(viewOnly=false):Promise<Store>{const store=await peekStore();return copy(viewOnly?authoringView(store):store);}
async function writeStore(value:Store){if(cached&&jsonEqual(cached,value))return cached;const text=JSON.stringify(value);if(isNative){if(chunked)await writeChunkedStore(native,text);else await native.writeStore({text});}else await dbPut('store',text);cached=value;if(!isNative){window.dispatchEvent(new Event('wenjian-web-saved'));webChannel?.postMessage({version:value.version});}return value;}

function serial<T>(operation:()=>Promise<T>):Promise<T>{const run=async()=>{if(!isNative){return navigator.locks.request('wenjian-web-store',()=>{cached=undefined;return operation();});}return operation();};const result=queue.then(run);queue=result.catch(()=>{});return result;}
export async function mobileSnapshot(){return serial(readStore);}
export async function mobileViewSnapshot(){return serial(()=>readStore(true));}
export async function mobileSave(data:Notebook,version:number){return serial(async()=>{const current=await peekStore();if(current.version!==version)throw Error('有新内容刚同步完成，请保留当前输入后重新保存。');const normalized=normalize(data);const invalid=validateCoreTransition(current.data,normalized)||validateReadingTransition(current.data,normalized);if(invalid)throw Error(invalid);if(jsonEqual(current.data,normalized))return copy(authoringView(current));return copy(authoringView(await writeStore({...current,version:version+1,data:copy(normalized)})));});}
async function available(book:LibraryBook){const info=isNative?await native.bookInfo({name:book.storedFile}):await dbGet<Blob>('book/'+book.storedFile);return !!info&&(isNative?!!(info as {available?:boolean}).available:(info as Blob).size>0)&&(!book.cloudFile||info.size===book.cloudFile.size);}
export async function mobileBookAvailable(book:LibraryBook){return available(book);}
const objectUrls=new Map<string,string>();
setReaderPlatform({mobile:true,fileUrl:async book=>{if(!await available(book)){if(!book.cloudFile)throw Error('这本书还没有上传，请先在电脑开启三端同步。');if(!isNative)await webDownload(book,(await peekStore()).sync?.target);else await native.transferBook({name:book.storedFile,action:'download',file:book.cloudFile,target:(await peekStore()).sync?.target});}if(isNative)return Capacitor.convertFileSrc((await native.bookInfo({name:book.storedFile})).uri);if(!objectUrls.has(book.storedFile)){const blob=await dbGet<Blob>('book/'+book.storedFile);objectUrls.set(book.storedFile,URL.createObjectURL(blob!));}return objectUrls.get(book.storedFile)!;}});
export async function importMobileBook(){let imported:{name:string;storedFile:string;format:'pdf'|'epub'};
 if(isNative){const result=await native.importBook();if(result.cancelled)return null;imported=result;}else{const file=await new Promise<File|null>(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.pdf,.epub';input.onchange=()=>resolve(input.files?.[0]||null);input.addEventListener('cancel',()=>resolve(null));input.click();});if(!file)return null;if(!/\.(pdf|epub)$/i.test(file.name)||file.size<1||file.size>80*1024*1024)throw Error('请选择 80 MB 以内的 PDF 或 EPUB。');const format=file.name.toLowerCase().endsWith('.epub')?'epub':'pdf';const storedFile=crypto.randomUUID()+'.'+format;await dbPut('book/'+storedFile,file);imported={name:file.name,storedFile,format};}
 return serial(async()=>{const current=await peekStore();const existing=current.data.libraryBooks.find(book=>book.storedFile===imported.storedFile);if(existing)return {book:existing,...current};const book:LibraryBook={id:crypto.randomUUID(),title:imported.name.replace(/\.(pdf|epub)$/i,''),author:'',originalName:imported.name,storedFile:imported.storedFile,format:imported.format,addedAt:new Date().toISOString(),progress:{},inReadingLibrary:true};const saved=await writeStore({...current,version:current.version+1,data:{...current.data,libraryBooks:[...current.data.libraryBooks,book]}});return {...saved,book};});
}
export async function mobileConfig():Promise<Config>{return isNative?native.getConfig():{configured:false};}
export async function saveMobileConfig(config:unknown){if(!isNative)throw Error('浏览器预览不保存云端密钥，请在安卓 App 中配置。');return native.setConfig({config});}
async function commitSync(payload:Record<string,any>){const current=await peekStore();if(payload.version!==current.version||(payload.syncRevision||0)!==(current.syncRevision||0))throw Object.assign(Error('本机刚保存新内容'),{status:409});if(!validSettings(payload.data)||payload.sync?.schema!==1)throw Error('同步资料不完整');if(jsonEqual(current.data,normalize(payload.data))&&jsonEqual(current.sync,payload.sync))return current;return await writeStore({...current,version:current.version+(jsonEqual(current.data,payload.data)?0:1),syncRevision:(current.syncRevision||0)+1,data:normalize(payload.data),sync:payload.sync});}
const originalFetch=window.fetch.bind(window);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
export async function exportMobileDiagnostics(){if(!isNative)return exportWebNotes();if(!chunked)throw Error('请在安卓修复版导出诊断记录');return native.exportDiagnostics();}
export function installMobileApi(){
 if(!isNative)setLeaseRecovery({begin:beginWebLease,end:endWebLease});
 if(chunked)setLeaseRecovery({begin:(target,owner)=>native.beginSyncLease({target,owner}),end:(target,owner,released,succeeded)=>native.finishSyncLease({target,owner,released,succeeded}).then(()=>{})});
 setSyncTransport(async(path,body)=>{
  const payload=(body||{}) as Record<string,any>;
  if(path==='local')return serial(peekStore);
  if(path==='revision')return serial(async()=>{const current=await peekStore();return {version:current.version,syncRevision:current.syncRevision||0};});
  if(path==='commit')return serial(()=>commitSync(payload));
  if(path==='book'){
   const current=await serial(peekStore),book=current.data.libraryBooks.find(b=>b.id===payload.id);if(!book)throw Error('没有找到这本书');
   if(payload.action==='status'){const info=isNative?await native.bookInfo({name:book.storedFile}):await dbGet<Blob>('book/'+book.storedFile);return {available:!!info&&(isNative?!!(info as {available?:boolean}).available:(info as Blob).size>0),matchesManifest:!book.cloudFile||info?.size===book.cloudFile.size};}
  }
  if(path==='identity')return isNative?native.getSyncIdentity():webCloud.identity();
  if(path==='remote'){if(!isNative)return (await webCloud.currentClient(payload.target)).remote(payload);try{return await native.remote(payload);}catch(error){const text=error instanceof Error?error.message:String(error);const match=/（(401|403|429|503|507)）/.exec(text);throw Object.assign(Error(text),{code:match?Number(match[1]):undefined});}}
  const response=await window.fetch('/api/sync/'+path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),result=await response.json() as {error?:string;code?:number};if(!response.ok)throw Object.assign(Error(result.error||'同步没有完成'),{status:response.status,code:result.code});return result;
 });
 window.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;const route=new URL(url,location.origin).pathname;if(!route.startsWith('/api/')||route==='/api/webdav')return originalFetch(input,init);
 try{const payload=typeof init?.body==='string'?JSON.parse(init.body):{},method=init?.method||'GET';
  if(route==='/api/app/info')return json(isNative?{...await App.getInfo(),platform:'android',arch:'universal'}:{version:PREVIEW_VERSION,build:'web-1',platform:'web',arch:'universal'});
  if(route==='/api/app/releases'){if(!isNative)return json([]);if(isNative)return json((await native.appReleases()).releases);const response=await originalFetch('/api/app/releases');return response;}
  if(route==='/api/app/update'){
   if(!isNative)return json({state:'idle'});
   if(!payload.action)return json(await native.appUpdate({action:'status'}));
   if(payload.action==='download'){const releases=(await native.appReleases()).releases as {tag_name:string;draft?:boolean;prerelease?:boolean;assets:{name:string;browser_download_url:string;state:string}[]}[];const release=releases.find(r=>!r.draft&&!r.prerelease&&(r.tag_name==='v'+payload.version+'-build'+payload.build||r.tag_name==='v'+payload.version));const asset=release?.assets.find(a=>a.name===(payload.build?'update-manifest-'+payload.build+'.json':'update-manifest.json')&&a.state==='uploaded');if(!asset)throw Error('此版本尚未提供应用内更新清单');return json(await native.appUpdate({action:'download',version:payload.version,manifestUrl:asset.browser_download_url}));}
   return json(await native.appUpdate({action:payload.action}));
  }
  if(route==='/api/app/open'){if(!validReleaseUrl(payload.url))throw Error('发布链接无效');if(isNative)return json(await native.openRelease({url:payload.url}));window.open(payload.url,'_blank','noopener,noreferrer');return json({ok:true});}
  if(route==='/api/library/import'){const result=await importMobileBook();return json(result?{...result,imported:[result.book]}:{cancelled:true});}
  if(route==='/api/sync/identity')return json(isNative?await native.getSyncIdentity():{provider:'oss',configured:false,target:''});
  if(route==='/api/sync/settings'){if(!isNative)return json(await connectWeb(payload));return await serial(async()=>{try{return json(await native.setSyncConnection({config:payload}));}finally{cached=undefined;}});}
  if(route==='/api/sync/connect'||route==='/api/sync/test'||route==='/api/sync/detach'){if(!isNative)return json(route.endsWith('/detach')?await detachWeb():await connectWeb(payload));return await serial(async()=>{try{if(route.endsWith('/detach'))return json(await native.detachSync({target:payload.target||''}));const identity=await native.getSyncIdentity();return json(await native.connectSync({config:route.endsWith('/test')?{...identity,password:''}:payload}));}finally{cached=undefined;}});}
  if(route==='/api/sync/backup-local'){if(!isNative)return json(await backupWeb());return await serial(async()=>json(await native.backupLocal()));}
  if(route==='/api/sync/remote'){if(!isNative)return json(await (await webCloud.currentClient(payload.target)).remote(payload));return json(await native.remote(payload));}
  if(route==='/api/sync/book'){
   const book=(await peekStore()).data.libraryBooks.find(b=>b.id===payload.id);if(!book)throw Error('没有找到这本书');
   if(payload.action==='status'){const info=isNative?await native.bookInfo({name:book.storedFile}):await dbGet<Blob>('book/'+book.storedFile);return json({available:!!info&&(isNative?!!(info as {available?:boolean}).available:(info as Blob).size>0),matchesManifest:!book.cloudFile||info?.size===book.cloudFile.size});}
   if(!isNative){const target=payload.target||(await peekStore()).sync?.target;if(payload.action==='download'){await webDownload(book,target);return json({ok:true,cloudFile:book.cloudFile});}if(payload.action!=='upload')throw Error('书籍操作无效。');const file=await webUpload(book,target);await serial(async()=>{const now=await peekStore();if(now.sync?.target!==target)throw Error('同步连接已变化');await writeStore({...now,version:now.version+1,data:{...now.data,libraryBooks:now.data.libraryBooks.map(b=>b.id===book.id&&b.storedFile===book.storedFile?{...b,cloudFile:file}:b)}});});return json({ok:true,cloudFile:file});}
   const target=payload.target||(await peekStore()).sync?.target;
   const file=await native.transferBook({name:book.storedFile,action:payload.action,file:book.cloudFile,target});
   if(payload.action==='upload')await serial(async()=>{const current=await peekStore();if(current.sync?.target!==target)throw Error('同步连接已变化，书籍清单暂未写入。');if(!current.data.libraryBooks.some(b=>b.id===book.id&&b.storedFile===book.storedFile))throw Error('书籍原件已变化，请重新同步。');await writeStore({...current,version:current.version+1,data:{...current.data,libraryBooks:current.data.libraryBooks.map(b=>b.id===book.id?{...b,cloudFile:file}:b)}});});return json({ok:true,cloudFile:file});
  }
  return await serial(async()=>{
   if(route==='/api/sync/revision'){if(!cached)await readStore();return json({version:cached!.version,syncRevision:cached!.syncRevision||0});}
   const current=await peekStore();
   if(route==='/api/sync/local'||route==='/api/notebook'&&method==='GET')return json(current);
   if(route==='/api/drafts'){if(method==='GET')return json({drafts:current.drafts});if(method==='PUT'&&typeof payload.key==='string'){await writeStore({...current,drafts:{...current.drafts,[payload.key]:payload.value}});return json({ok:true});}}
   if(route==='/api/sync/commit')return json(await commitSync(payload));
   if(route==='/api/notebook/maintenance'){
    const trash=current.localTrash||[];
    if(method==='GET')return json({entries:[...archiveGroups(current.data),...trash.map(({id,at,label,count})=>({id,at,label,count})).reverse()]});
    if(payload.version!==current.version)return json({error:'资料刚有修改'},409);
    if(payload.confirmation!==(payload.action==='purge'?'永久清除':'删除')||payload.confirmed!==true)throw Error('请先核对操作范围');
    let data=current.data,localTrash=trash,receiptId:string|undefined;
    if(payload.action==='restore'||payload.action==='purge'){
     const archived=archiveGroups(data).some(r=>r.id===payload.receiptId);if(archived)data=payload.action==='restore'?restoreArchived(data,payload.receiptId):purgeArchiveBatch(data,payload.receiptId,removeRecords);else{const receipt=trash.find(r=>r.id===payload.receiptId);if(!receipt)throw Error('恢复副本已变化，请重新打开最近删除');if(payload.action==='restore')data=restoreMaintenance(data,receipt);localTrash=trash.filter(r=>r.id!==receipt.id);}
    }else{
     const targets=payload.targets||(payload.target?[payload.target]:[]);
     receiptId=crypto.randomUUID();data=archiveRecords(data,targets,{batchId:receiptId});
    }
    return json({...await writeStore({...current,version:current.version+1,data,localTrash}),receiptId});
   }
   if(route==='/api/notebook'){
    if(payload.version!==current.version)return json({error:'资料已更新'},409);
    if(method==='PATCH'){if(!validOcrEntry(payload.entry))return json({error:'识别缓存无效'},400);if(!current.data.libraryBooks.some(b=>b.id===payload.entry.libraryBookId))return json({error:'书籍已移除'},404);return json(await writeStore({...current,version:current.version+1,data:mergeOcrPage(current.data,payload.entry)}));}
    if(method==='PUT'){const data=normalize(payload.data),invalid=validateCoreTransition(current.data,data)||validateReadingTransition(current.data,data);if(invalid)return json({error:invalid},400);if(jsonEqual(current.data,data))return json(current);return json(await writeStore({...current,version:current.version+1,data}));}
   }
   return json({error:'此操作请在电脑端完成'},501);
  });
 }catch(error){const text=error instanceof Error?error.message:'本地操作没有完成';const match=/（(401|403|429|503|507)）/.exec(text);return json({error:text,code:match?Number(match[1]):undefined},(error as {status?:number}).status||500);}
};}

export async function connectWeb(payload:Record<string,any>){
 if(payload.provider&&payload.provider!=='nutstore')throw Error('iPhone Web 版先使用坚果云同步。');
 const previous=await webCloud.credentials();
 const config=webCloud.validateConnection({username:payload.username||previous?.username,password:payload.password||(previous?.username===(payload.username||previous?.username)?.trim().toLowerCase()?previous?.password:''),remember:payload.remember??previous?.remember});
 const before=await mobileSnapshot(),target=webCloud.targetFor(config.username);
 if(before.sync?.target&&before.sync.target!==target&&(before.sync.lastSync||before.sync.published?.length||before.sync.received.length))throw Error('当前已连接另一资料库。请先导出笔记，再在连接设置中备份后更换。');
 await webCloud.createDavClient(config).test();
 return serial(async()=>{const current=await peekStore();if(current.sync?.target&&current.sync.target!==target&&(current.sync.lastSync||current.sync.published?.length||current.sync.received.length))throw Error('资料库刚有更新，请重新核对连接。');return webCloud.saveConnection(config);});
}
export async function backupWeb(){return serial(async()=>{const store=await peekStore(),at=new Date().toISOString(),key='web-backup/'+at+'-'+crypto.randomUUID();await dbPut(key,JSON.stringify({format:'wenjian-web-notes',schema:1,createdAt:at,store}));return {backupPath:'本机笔记与草稿恢复副本 · '+new Date(at).toLocaleString('zh-CN')};});}
export async function detachWeb(){const snapshot=await mobileSnapshot();for(const book of snapshot.data.libraryBooks.filter(b=>b.storedFile&&b.format!=='reference'))if(!await available(book))throw Error('请先下载尚未离线的书籍，或保留当前连接；更换前需要完整保留原件。');const backup=await backupWeb();return serial(async()=>{const current=await peekStore();if(current.version!==snapshot.version)throw Error('本机内容刚有变化，请重试更换连接。');await writeStore({...current,version:current.version+1,syncRevision:(current.syncRevision||0)+1,sync:newSyncState()});await webCloud.forgetConnection();return backup;});}
export function downloadText(text:string,name:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export async function exportWebNotes(){const store=await mobileSnapshot();downloadText(JSON.stringify({format:'wenjian-web-notes',schema:1,createdAt:new Date().toISOString(),store}),'问间-笔记与草稿-'+new Date().toISOString().slice(0,10)+'.json');return {ok:true};}
export async function importWebNotes(){const file=await new Promise<File|null>(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=()=>resolve(input.files?.[0]||null);input.addEventListener('cancel',()=>resolve(null));input.click();});if(!file)return;if(file.size>32*1024*1024)throw Error('笔记文件过大，请使用坚果云接入。');const input=JSON.parse(await file.text());if(input.format!=='wenjian-web-notes'||input.schema!==1||!Number.isSafeInteger(input.store?.version)||!validSettings(input.store?.data)||!Array.isArray(input.store?.data?.notes))throw Error('请导入 Web 版导出的笔记 JSON；电脑完整备份请先在电脑恢复后同步。');await backupWeb();await serial(async()=>{const current=await peekStore();if(current.data.setupCompleted!==false)throw Error('为避免覆盖已有资料，导入仅用于新建的空白 Web 资料库；已有内容请通过同步合并。');await writeStore({...current,version:current.version+1,data:normalize(input.store.data),drafts:input.store.drafts||{},sync:newSyncState()});});window.location.reload();}
export async function webStorageInfo(){const estimate=await navigator.storage?.estimate();return {...estimate,persistent:await navigator.storage?.persisted(),backups:(await dbKeys()).filter(k=>String(k).startsWith('web-backup/')).length};}
export async function restoreWebBackup(key:string){const text=await dbGet<string>(key);if(!text)throw Error('恢复副本不存在。');const backup=JSON.parse(text);if(backup.format!=='wenjian-web-notes'||!validSettings(backup.store?.data))throw Error('恢复副本校验失败。');await backupWeb();await serial(async()=>{const current=await peekStore();await writeStore({...backup.store,version:current.version+1,syncRevision:(current.syncRevision||0)+1,sync:newSyncState()});});window.location.reload();}
export async function listWebBackups(){return (await dbKeys()).map(String).filter(k=>k.startsWith('web-backup/')).sort().reverse();}
