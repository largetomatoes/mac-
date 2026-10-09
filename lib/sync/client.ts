import {capture,materialize,newSyncState,project,resolveConflict,stable,unionOperations,type Operation,type SyncState} from './core';
import type {Notebook} from '../notebook';
export type Envelope={version:number;data:Notebook;sync?:SyncState;syncRevision?:number};
export type SyncProgress={stage:'notes'|'books';message:string;completed?:number;total?:number};
export async function syncApi<T>(path:string,body?:unknown):Promise<T>{
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
export function syncNow(onProgress?:(progress:SyncProgress)=>void):Promise<Envelope>{if(running)return running;running=run(onProgress).finally(()=>{running=null;});return running;}
async function run(progress?:(progress:SyncProgress)=>void):Promise<Envelope>{
 const config=await syncApi<{target:string;configured:boolean;verified?:boolean}>('identity');
 let snapshot=await syncApi<Envelope>('local'),state=snapshot.sync||newSyncState();
 if(!config.configured)throw Error('请先连接同步服务。');if(config.verified===false)throw Error('请先检查连接，通过后再开始同步。');
 if(state.target&&state.target!==config.target)throw Error('连接的资料库已改变，请在连接设置中处理。');
 state=capture({...state,target:config.target},snapshot.data);
 // Keep the queue durable before network access. The binding remains provisional
 // until a PUT is acknowledged or remote records are successfully incorporated.
 snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:snapshot.data,sync:state});
 progress?.({stage:'notes',message:'正在读取云端笔记…'});
 const listing=await syncApi<{keys:string[]}>('remote',{action:'list',target:config.target});
 const received=new Set(state.received),remote:Operation[]=[];
 for(const key of listing.keys){
  if(received.has(key))continue;
  const result=await syncApi<{text:string}>('remote',{action:'get',target:config.target,key});
  const match=/^changes\/([a-f0-9]{64})\.json$/.exec(key);if(!match)throw Error('同步文件名不正确。');
  if(await sha256(result.text)!==match[1])throw Error('同步文件校验失败，未修改本机资料。');
  const batch=JSON.parse(result.text);if(batch.schema!==1||!Array.isArray(batch.operations))throw Error('同步格式暂不支持。');
  remote.push(...batch.operations);received.add(key);
 }
 // Reject corrupt remote records before publishing local records.
 materialize({...state,operations:unionOperations(state.operations,remote)},snapshot.data);
 const batches=operationBatches(state.pending);
 for(const [index,batch] of batches.entries()){
  progress?.({stage:'notes',message:'正在上传笔记…',completed:index,total:batches.length});
  const content=stable({schema:1,operations:batch}),key=`changes/${await sha256(content)}.json`;
  await syncApi('remote',{action:'put',target:config.target,key,text:content});
  // Even if a later request fails, remember this acknowledgement. A partially
  // uploaded library must never be treated as an unused, freely replaceable account.
  await updateSync(current=>{if(current.target!==config.target)throw Error('同步连接已变化。');return {...current,published:[...new Set([...(current.published||[]),key])]};});
  received.add(key);
 }
 for(let attempt=0;attempt<5;attempt++){
  const current=await syncApi<Envelope>('local');if(current.sync?.target!==config.target)throw Error('同步连接已变化。');
  let next=capture(current.sync,current.data);
  next={...next,operations:unionOperations(next.operations,remote),pending:next.pending.filter(op=>!state.pending.some(sent=>sent.id===op.id)),received:[...new Set([...next.received,...received])],lastSync:new Date().toISOString()};
  const merged=materialize(next,current.data);next.observed=project(merged.data);
  try{const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}
  catch(error){if((error as {status?:number}).status!==409||attempt===4)throw error;}
 }
 throw Error('本机正在连续保存，稍后会重新同步。');
}
export async function syncBooks(snapshot:Envelope,progress?:(progress:SyncProgress)=>void):Promise<Envelope>{
 const books=snapshot.data.libraryBooks.filter(book=>book.storedFile&&['pdf','epub'].includes(book.format));
 const errors:Record<string,string>={};let uploaded=0,completed=books.filter(book=>!!book.cloudFile).length;
 for(const book of books){
  if(book.cloudFile)continue;
  progress?.({stage:'books',message:'正在上传《'+book.title+'》',completed,total:books.length});
  try{
   const local=await syncApi<{available:boolean}>('book',{action:'status',id:book.id});
   if(!local.available){errors[book.id]='本机没有原文件，请在有原书的设备同步。';continue;}
   await syncApi('book',{action:'upload',target:snapshot.sync?.target,id:book.id});completed++;uploaded++;
  }catch(error){errors[book.id]=error instanceof Error?error.message:'书籍上传未完成';if([401,403,429].includes((error as {code?:number}).code||0))break;}
 }
 const updated=await updateSync(state=>({...state,books:{errors,lastChecked:new Date().toISOString()}}));
 // Publish successful book manifests even when a different book failed.
 return uploaded?syncNow(progress):updated;
}
export async function resolveSync(key:string,chosenId:string){const current=await syncApi<Envelope>('local'),state=current.sync;if(!state)throw Error('同步尚未初始化。');const captured=capture(state,current.data);if(captured.pending.some(op=>op.key===key&&!state.pending.some(old=>old.id===op.id)))throw Error('这条记录刚有新修改，请先同步，再选择版本。');const next=resolveConflict(captured,key,chosenId),merged=materialize(next,current.data);next.observed=project(merged.data);const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}
export async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function operationBatches(operations:Operation[]){const batches:Operation[][]=[];let current:Operation[]=[],size=0;for(const op of operations){const length=new TextEncoder().encode(stable(op)).length+1;if(length>12*1024*1024)throw Error('单条内容过大，无法同步。');if(current.length&&size+length>4*1024*1024){batches.push(current);current=[];size=0;}current.push(op);size+=length;}if(current.length)batches.push(current);return batches;}
