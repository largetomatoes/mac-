import {capture,materialize,newSyncState,project,resolveConflict,stable,unionOperations,type Operation,type SyncState} from './core';
import type {Notebook} from '../notebook';
export type Envelope={version:number;data:Notebook;sync?:SyncState;syncRevision?:number};
export async function syncApi<T>(path:string,body?:unknown):Promise<T>{const response=await fetch('/api/sync/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json() as T & {error?:string};if(!response.ok){const error=new Error(result.error||'同步没有完成') as Error&{status:number};error.status=response.status;throw error;}return result;}
let running:Promise<Envelope>|null=null;
export function syncNow():Promise<Envelope>{if(running)return running;running=run().finally(()=>{running=null;});return running;}
async function run():Promise<Envelope>{
 const config=await syncApi<{target:string;configured:boolean}>('identity');
 let snapshot=await syncApi<Envelope>('local'),state=snapshot.sync||newSyncState();
 if(!state.enabled)throw Error('尚未开启三端同步。');if(!config.configured)throw Error('请先填写同步服务的连接设置。');
 if(state.target&&state.target!==config.target)throw Error('云端位置已改变。请恢复原同步位置，避免混合两个资料库。');
 state=capture({...state,target:config.target},snapshot.data);
 // Persist pending edits before the first network request. A failure/restart cannot forget an edit.
 snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:snapshot.data,sync:state});
 for(const batch of operationBatches(state.pending)){
  const content=stable({schema:1,operations:batch}),digest=await sha256(content);
  await syncApi('remote',{action:'put',target:config.target,key:`changes/${digest}.json`,text:content});
 }
 const listing=await syncApi<{keys:string[]}>('remote',{action:'list',target:config.target}),received=new Set(state.received),remote:Operation[]=[];
 for(const key of listing.keys){if(received.has(key))continue;const result=await syncApi<{text:string}>('remote',{action:'get',target:config.target,key});const match=/^changes\/([a-f0-9]{64})\.json$/.exec(key);if(!match)throw Error('同步文件名不正确。');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(result.text)))).map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==match[1])throw Error('同步文件校验失败，未修改本机资料。');const batch=JSON.parse(result.text);if(batch.schema!==1||!Array.isArray(batch.operations))throw Error('同步格式暂不支持。');remote.push(...batch.operations);received.add(key);}
 // A save during network transfer wins the local CAS; capture it before integrating remote operations.
 for(let attempt=0;attempt<4;attempt++){
  const current=await syncApi<Envelope>('local');let next=capture(current.sync||state,current.data);
  next={...next,operations:unionOperations(next.operations,remote),pending:next.pending.filter(op=>!state.pending.some(sent=>sent.id===op.id)),received:[...new Set([...next.received,...received])],lastSync:new Date().toISOString()};
  const merged=materialize(next,current.data);next.observed=project(merged.data);
  try{const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}catch(error){if((error as {status?:number}).status!==409||attempt===3)throw error;}
 }
 throw Error('本机正在连续保存，稍后会重新同步。');
}
export async function resolveSync(key:string,chosenId:string){const current=await syncApi<Envelope>('local'),state=current.sync;if(!state)throw Error('同步尚未初始化。');const captured=capture(state,current.data);if(captured.pending.some(op=>op.key===key&&!state.pending.some(old=>old.id===op.id)))throw Error('这条记录刚有新修改，请先同步，再选择版本。');const next=resolveConflict(captured,key,chosenId),merged=materialize(next,current.data);next.observed=project(merged.data);const result=await syncApi<Envelope>('commit',{version:current.version,syncRevision:current.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return result;}

export async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function operationBatches(operations:Operation[]){const batches:Operation[][]=[];let current:Operation[]=[],size=0;for(const op of operations){const length=new TextEncoder().encode(stable(op)).length+1;if(length>12*1024*1024)throw Error('单条内容过大，无法同步。');if(current.length&&size+length>4*1024*1024){batches.push(current);current=[];size=0;}current.push(op);size+=length;}if(current.length)batches.push(current);return batches;}
