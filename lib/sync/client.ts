import {jsonEqual} from '../value-equal';
import {prepareDesktopSync,withCloudLease,readManifest} from './protocol';
import {capture,materialize,newSyncState,project,resolveConflict,stable,unionOperations,type Operation,type SyncState} from './core';
import type {Notebook} from '../notebook';
export type Envelope={version:number;data:Notebook;sync?:SyncState;syncRevision?:number};
export type SyncProgress={stage:'notes'|'books';message:string;completed?:number;total?:number};
export type SyncTransport=(path:string,body?:unknown)=>Promise<unknown>;
let localTransport:SyncTransport|undefined;
export function setSyncTransport(transport:SyncTransport){localTransport=transport;}
export async function syncApi<T>(path:string,body?:unknown):Promise<T>{
 if(localTransport)return await localTransport(path,body) as T;
 const response=await fetch('/api/sync/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json() as T & {error?:string;code?:number};
 if(!response.ok){const error=new Error(result.error||'同步没有完成') as Error&{status:number;code?:number};error.status=response.status;error.code=result.code;throw error;}return result;
}
export async function updateSync(change:(state:SyncState)=>SyncState):Promise<Envelope>{
 for(let attempt=0;attempt<5;attempt++){
  const current=await syncApi<Envelope>('local');
  try{const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:current.data,sync:change(current.sync||newSyncState())});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}
  catch(error){if((error as {status?:number}).status!==409||attempt===4)throw error;}
 }
 throw Error('本机正在连续保存，请稍后重试。');
}
let running:Promise<Envelope>|null=null;
export type SyncMode='join'|'merge'|'local';
export function syncNow(onProgress?:(progress:SyncProgress)=>void,mode?:SyncMode,rootId?:string):Promise<Envelope>{if(running)return mode?Promise.reject(Error('另一项同步正在进行，请完成后再选择资料库基准。')):running;running=run(onProgress,mode,rootId).finally(()=>{running=null;});return running;}
async function run(progress?: (progress:SyncProgress)=>void,mode?:SyncMode,rootId?:string):Promise<Envelope>{
 const config=await syncApi<{target:string;configured:boolean;verified?:boolean;protocol?:number;autoPaused?:boolean;paused?:boolean;pausedReason?:string}>('identity');
 if(config.paused)throw Error(config.pausedReason||'当前为 Mac 本地试用，跨端同步暂缓。');
 if(!config.configured)throw Error('请先连接同步服务。');if(config.verified===false)throw Error('请先检查连接，通过后再开始同步。');
 if(config.protocol===2){
  // An idle check must not rewrite lease.json, the notebook or its backup.
  // Read immutable journal names first; acquire the writer lease only for work.
  if(!mode&&!config.autoPaused){
   const snapshot=await syncApi<Envelope>('local'),state=snapshot.sync;
   if(state?.lastSync&&state.target===config.target&&!state.pending.length&&jsonEqual(project(snapshot.data),state.observed)){
    const {manifest}=await readManifest(config.target);
    if(manifest&&state.libraryId!==manifest.libraryId)throw Error('本机与云端不是同一资料库，请核对后接入。');
    if(manifest&&manifest.schema===4&&(state.epoch||'legacy')===manifest.epoch){
     const listing=await syncApi<{keys:string[]}>('remote',{action:'list',target:config.target,epoch:manifest.epoch}),received=new Set(state.received);
     if(listing.keys.every(key=>received.has(key))){const latest=await syncApi<Envelope>('local');if(latest.version===snapshot.version&&(latest.syncRevision||0)===(snapshot.syncRevision||0))return latest;}
    }
   }
  }
  return withCloudLease(config.target,async renew=>{const prepared=await prepareDesktopSync(config.target,mode,renew,rootId);return runJournal(progress,prepared.manifest.epoch,renew,config.target);});
 }
 return runJournal(progress);
}
async function runJournal(progress?:(progress:SyncProgress)=>void,epoch='legacy',renew?:(force?:boolean)=>Promise<void>,expectedTarget?:string):Promise<Envelope>{
 const config=await syncApi<{target:string;configured:boolean;verified?:boolean;deviceName?:string;protocol?:number;paused?:boolean;pausedReason?:string}>('identity');
 let snapshot=await syncApi<Envelope>('local'),state=snapshot.sync||newSyncState();
 if(config.paused)throw Error(config.pausedReason||'当前为 Mac 本地试用，跨端同步暂缓。');
 if(!config.configured)throw Error('请先连接同步服务。');if(config.verified===false)throw Error('请先检查连接，通过后再开始同步。');
 if((expectedTarget&&expectedTarget!==config.target)||(state.target&&state.target!==config.target))throw Error('连接的资料库已改变，请在连接设置中处理。');
 const protocol=config.protocol===2?await readManifest(config.target):null;
 if(config.protocol===2&&(!protocol?.manifest||protocol.manifest.epoch!==epoch))throw Error('云端资料库基准刚有变化，请重新同步。');
 state=capture({...state,...(protocol?.manifest?{libraryId:protocol.manifest.libraryId,epoch}:{}),target:config.target,...(config.deviceName?{deviceName:config.deviceName}:{})},snapshot.data);
 // Keep the queue durable before network access. The binding remains provisional
 // until a PUT is acknowledged or remote records are successfully incorporated.
 snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:snapshot.data,sync:state});
 progress?.({stage:'notes',message:'正在读取云端笔记…'});
 const listing=await syncApi<{keys:string[]}>('remote',{action:'list',target:config.target,epoch});
 const received=new Set(state.received),remote:Operation[]=[];
 for(const key of listing.keys){
  if(received.has(key))continue;
  const result=await syncApi<{text:string}>('remote',{action:'get',target:config.target,key});
  const match=/^(?:changes|epochs\/[-a-zA-Z0-9_]{8,100}\/changes)\/([a-f0-9]{64})\.json$/.exec(key);if(!match)throw Error('同步文件名不正确。');
  if(await sha256(result.text)!==match[1])throw Error('同步文件校验失败，未修改本机资料。');
  const batch=JSON.parse(result.text);if(batch.schema!==1||!Array.isArray(batch.operations))throw Error('同步格式暂不支持。');
  remote.push(...batch.operations);received.add(key);
 }
 // Reject corrupt remote records before publishing local records.
 materialize({...state,operations:unionOperations(state.operations,remote)},snapshot.data);
 const batches=operationBatches(state.pending);
 for(const [index,batch] of batches.entries()){
  progress?.({stage:'notes',message:'正在上传笔记…',completed:index,total:batches.length});
  await renew?.();
  const content=stable({schema:1,operations:batch}),key=`${epoch==='legacy'?'changes':'epochs/'+epoch+'/changes'}/${await sha256(content)}.json`;
  await syncApi('remote',{action:'put',target:config.target,key,text:content});
  // Even if a later request fails, remember this acknowledgement. A partially
  // uploaded library must never be treated as an unused, freely replaceable account.
  await updateSync(current=>{if(current.target!==config.target)throw Error('同步连接已变化。');return {...current,published:[...new Set([...(current.published||[]),key])]};});
  received.add(key);
 }
 await renew?.(true);
 for(let attempt=0;attempt<5;attempt++){
  const current=await syncApi<Envelope>('local');if(current.sync?.target!==config.target)throw Error('同步连接已变化。');
  let next=capture(current.sync,current.data);
  next={...next,epoch,operations:unionOperations(next.operations,remote),pending:next.pending.filter(op=>!state.pending.some(sent=>sent.id===op.id)),received:[...new Set([...next.received,...received])],lastSync:new Date().toISOString()};
  const merged=materialize(next,current.data);next.observed=project(merged.data);
  try{const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}
  catch(error){if((error as {status?:number}).status!==409||attempt===4)throw error;}
 }
 throw Error('本机正在连续保存，稍后会重新同步。');
}
export async function syncBooks(snapshot:Envelope,progress?:(progress:SyncProgress)=>void):Promise<Envelope>{
 const connection=await syncApi<{bookPolicy?:string}>('identity');const onDemand=connection.bookPolicy==='on-demand';
 const target=snapshot.sync?.target;if(!target)throw Error('请先完成笔记同步，再同步书籍。');
 const books=snapshot.data.libraryBooks.filter(book=>book.storedFile&&['pdf','epub'].includes(book.format));
 const errors:Record<string,string>={};let uploaded=0,completed=0,transferred=0;
 // A cloudFile is an address, not proof that the object exists in this account.
 // One listing repairs old references without spending one HEAD request per book.
 let index:{keys:string[]};try{index=books.length?await syncApi<{keys:string[]}>('remote',{action:'book-index',target}):{keys:[]};if(!Array.isArray(index.keys)||index.keys.some(key=>!/^books\/[a-f0-9]{64}\.(pdf|epub)$/.test(key)))throw Error('云端书籍目录不完整，请稍后重试。');}
 catch(error){const issue=error instanceof Error?error.message:'书籍目录核对未完成';await updateSync(state=>{if(state.target!==target)throw Error('同步连接已变化。');return {...state,books:{errors:Object.fromEntries(books.map(book=>[book.id,issue]))}};});throw error;}
 const remote=new Set(index.keys);
 for(const [position,book] of books.entries()){
  try{
   const local=await syncApi<{available:boolean;matchesManifest?:boolean}>('book',{action:'status',id:book.id});
   const present=!!book.cloudFile&&remote.has(book.cloudFile.key);
   if(local.available&&(!present||local.matchesManifest===false)){
    progress?.({stage:'books',message:'正在上传《'+book.title+'》',completed,total:books.length});
    await syncApi('book',{action:'upload',target,id:book.id});uploaded++;transferred++;
   }else if(!local.available){
    if(!present){errors[book.id]='云端尚无原件，请在保留原书的任一设备点击同步。';continue;}
    if(onDemand){completed++;continue;}
    progress?.({stage:'books',message:'正在下载《'+book.title+'》',completed,total:books.length});
    await syncApi('book',{action:'download',target,id:book.id});transferred++;
   }
   completed++;
  }catch(error){errors[book.id]=error instanceof Error?error.message:'书籍传输未完成';if([401,403,429,503,507].includes((error as {code?:number}).code||0)){for(const remaining of books.slice(position+1))errors[remaining.id]='连接暂不可用，请稍后重试。';break;}}
 }
 const latest=await syncApi<Envelope>('local');if(latest.sync?.target!==target)throw Error('同步连接已变化，书籍检查已停止。');
 const updated=transferred||!jsonEqual(latest.sync?.books?.errors||{},errors)||books.length>0&&!latest.sync?.books?.lastChecked?await updateSync(state=>{if(state.target!==target)throw Error('同步连接已变化，书籍检查已停止。');return {...state,books:{errors,lastChecked:new Date().toISOString()}};}):latest;
 // A successful original upload is not complete until its metadata reaches peers.
 return uploaded?syncNow(progress):updated;
}
export async function resolveSync(key:string,chosenId:string){const current=await syncApi<Envelope>('local'),state=current.sync;if(!state)throw Error('同步尚未初始化。');const captured=capture(state,current.data);if(captured.pending.some(op=>op.key===key&&!state.pending.some(old=>old.id===op.id)))throw Error('这条记录刚有新修改，请先同步，再选择版本。');const next=resolveConflict(captured,key,chosenId),merged=materialize(next,current.data);next.observed=project(merged.data);const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}
export async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function operationBatches(operations:Operation[]){const batches:Operation[][]=[];let current:Operation[]=[],size=0;for(const op of operations){const length=new TextEncoder().encode(stable(op)).length+1;if(length>12*1024*1024)throw Error('单条内容过大，无法同步。');if(current.length&&size+length>4*1024*1024){batches.push(current);current=[];size=0;}current.push(op);size+=length;}if(current.length)batches.push(current);return batches;}
