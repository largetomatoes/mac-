import {capture,materialize,newSyncState,project,stable,tips,unionOperations,resolveConflict,type Operation,type SyncState} from './core';
import {initialNotebook,type Notebook} from '../notebook';
import {syncApi,sha256,operationBatches,type Envelope} from './client';
export type Manifest={schema:1;libraryId:string;epoch:string;snapshots:string[];createdAt:string;retired?:string[]};
export type CloudPreview={manifest:Manifest|null;operations:Operation[];data:Notebook;conflicts:ReturnType<typeof materialize>['conflicts'];keys:string[]};
const remote=<T,>(target:string,body:unknown)=>syncApi<T>('remote',{target,...body as object});
export async function readManifest(target:string):Promise<{manifest:Manifest|null;etag:string|null}>{const r=await remote<{text:string|null;etag:string|null}>(target,{action:'control-get',key:'library.json'});if(!r.text)return {manifest:null,etag:r.etag};const m=JSON.parse(r.text) as Manifest;if(m.schema!==1||!/^[-a-zA-Z0-9_]{8,100}$/.test(m.libraryId)||!(m.epoch==='legacy'||/^[-a-zA-Z0-9_]{8,100}$/.test(m.epoch))||!Array.isArray(m.snapshots)||m.snapshots.some(k=>!/^snapshots\/[a-f0-9]{64}\.json$/.test(k))||(m.retired!==undefined&&(!Array.isArray(m.retired)||m.retired.some(k=>!/^(?:changes|epochs\/[-a-zA-Z0-9_]{8,100}\/changes|snapshots)\/[a-f0-9]{64}\.json$/.test(k)))))throw Error('云端资料库标识无效，未修改本机内容。');return {manifest:m,etag:r.etag};}
export async function cloudPreview(target:string):Promise<CloudPreview>{const {manifest}=await readManifest(target),listing=await remote<{keys:string[]}>(target,{action:'list',epoch:manifest?.epoch||'legacy'});const operations:Operation[]=[];for(const key of [...(manifest?.snapshots||[]),...listing.keys]){const r=await remote<{text:string}>(target,{action:'get',key});if(await sha256(r.text)!==key.split('/').at(-1)?.slice(0,-5))throw Error('云端资料校验失败。');const batch=JSON.parse(r.text);if(batch.schema!==1||!Array.isArray(batch.operations))throw Error('云端同步格式暂不支持。');operations.push(...batch.operations);}const all=unionOperations(operations),local=structuredClone(initialNotebook);const merged=materialize({...newSyncState(),operations:all},local);return {manifest,operations:all,data:merged.data,conflicts:merged.conflicts,keys:listing.keys};}
// Every new desktop client shares this lease. Conditional writes prevent two writers from owning it.
export async function withCloudLease<T>(target:string,job:(renew:()=>Promise<void>)=>Promise<T>):Promise<T>{
 const owner=crypto.randomUUID();let owned=false;
 const claim=async()=>{const current=await remote<{text:string|null;etag:string|null}>(target,{action:'control-get',key:'lease.json'}),old=current.text?JSON.parse(current.text):null;if(old?.owner&&old.owner!==owner&&old.until>Date.now())throw Error('另一台设备正在同步，请稍后重试。');if(current.text&&!current.etag)throw Error('云端未返回并发校验标识，暂不进行同步写入。');await remote(target,{action:'control-put',key:'lease.json',etag:current.etag,text:stable({owner,until:Date.now()+10*60*1000})});owned=true;};
 await claim();try{return await job(claim);}finally{if(owned){try{const r=await remote<{text:string|null;etag:string|null}>(target,{action:'control-get',key:'lease.json'});if(r.text&&JSON.parse(r.text).owner===owner&&r.etag)await remote(target,{action:'control-put',key:'lease.json',etag:r.etag,text:stable({owner:'',until:0})});}catch{/* Expiry also releases an interrupted lease. */}}}
}
export async function prepareDesktopSync(target:string,mode?:'join'|'merge',renew?:()=>Promise<void>,rootId?:string):Promise<{manifest:Manifest;snapshot:Envelope}>{
 let snapshot=await syncApi<Envelope>('local'),state=snapshot.sync||newSyncState(),info=await readManifest(target),manifest=info.manifest;
 if(state.libraryId&&manifest&&state.libraryId!==manifest.libraryId)throw Error('本机与云端不是同一资料库，请核对后接入。');
 const first=!state.lastSync&&!state.received.length&&!state.published?.length;
 if(first||!manifest||(state.epoch||'legacy')!==manifest.epoch){
  const preview=await cloudPreview(target),hasRemote=preview.operations.length>0;
  if(first&&hasRemote&&snapshot.data.setupCompleted!==false&&!mode)throw Error('云端已有资料，请先选择「接入已有资料」或核对后合并。');
  if(!manifest){const root=preview.operations.filter(o=>o.key==='notes/world').sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))[0];manifest={schema:1,libraryId:state.libraryId||(root?'library-'+(await sha256(root.id)).slice(0,32):crypto.randomUUID()),epoch:'legacy',snapshots:[],createdAt:new Date().toISOString()};await remote(target,{action:'control-put',key:'library.json',etag:info.etag,text:stable(manifest)});}
  if(first&&hasRemote&&(mode==='join'||snapshot.data.setupCompleted===false)){
   if(snapshot.data.setupCompleted!==false)await syncApi('backup-local',{});
   // Joining does not upload a temporary core question or copy its local settings over the library.
   state={...newSyncState(state.device),deviceName:state.deviceName,enabled:true,target,libraryId:manifest.libraryId,epoch:manifest.epoch,operations:preview.operations,received:preview.keys,observed:project(preview.data)};
   const rootConflict=preview.conflicts.find(c=>c.key==='notes/world');if(rootConflict){if(!rootId||!rootConflict.options.some(o=>o.id===rootId))throw Error('请先选择云端要使用的核心问题。');state=resolveConflict(state,'notes/world',rootId);}const data={...materialize(state,preview.data).data,zoteroEnabled:snapshot.data.zoteroEnabled};state.observed=project(data);snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data,sync:state});
   window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:snapshot}));
  }else if((state.epoch||'legacy')!==manifest.epoch){
   // Rebase ONLY edits made while offline; unchanged stale contents must never be resurrected.
   const local=project(snapshot.data),heads=tips(preview.operations),created:Operation[]=[];
   for(const key of new Set([...Object.keys(state.observed),...Object.keys(local)])){if(key==='settings/zoteroEnabled'||stable(state.observed[key])===stable(local[key]))continue;const current=heads.get(key)||[],same=stable(state.observed[key])===stable(project(preview.data)[key]);created.push({id:crypto.randomUUID(),key,value:local[key]??null,parents:same?current.map(o=>o.id):[],at:new Date().toISOString(),device:state.device,deviceName:state.deviceName});}
   const next={...state,libraryId:manifest.libraryId,epoch:manifest.epoch,operations:unionOperations(preview.operations,created),pending:created,received:preview.keys,published:[],observed:{}};
   const merged=materialize(next,snapshot.data);next.observed=project(merged.data);snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:snapshot}));
  }
 }
 await renew?.();return {manifest:manifest!,snapshot};
}
export async function compactCloud():Promise<Envelope>{const identity=await syncApi<{target:string;protocol?:number}>('identity');if(identity.protocol!==2)throw Error('请在新版电脑端整理云端。');return withCloudLease(identity.target,async renew=>{
 const snapshot=await syncApi<Envelope>('local'),state=snapshot.sync;if(!state?.lastSync)throw Error('请先完成同步。');if(state.pending.length||stable(project(snapshot.data))!==stable(state.observed))throw Error('本机有待上传修改，请先同步。');if(materialize(state,snapshot.data).conflicts.length)throw Error('请先处理所有冲突。');
 await syncApi('backup-local',{});const preview=await cloudPreview(identity.target);if(stable(project(preview.data))!==stable(project(snapshot.data)))throw Error('云端有新修改，请先同步，再整理。');
 const info=await readManifest(identity.target);if(!info.manifest||!info.etag)throw Error('云端资料库无法校验。');
 const epoch=crypto.randomUUID(),at=new Date().toISOString(),operations:Operation[]=[];
 for(const [key,options] of tips(preview.operations)){if(key==='settings/zoteroEnabled')continue;const value=project(preview.data)[key]??null;operations.push({id:crypto.randomUUID(),key,parents:[],value,at,device:state.device,deviceName:state.deviceName});}
 const snapshots:string[]=[];for(const batch of operationBatches(operations)){await renew();const text=stable({schema:1,operations:batch}),key='snapshots/'+await sha256(text)+'.json';await remote(identity.target,{action:'put',key,text});const saved=await remote<{text:string}>(identity.target,{action:'get',key});if(saved.text!==text)throw Error('新快照校验失败，未清理旧文件。');snapshots.push(key);}
 // Old clients stop instead of bringing discarded history back into the current library.
 await remote(identity.target,{action:'guard'});await renew();
 const manifest={...info.manifest,epoch,snapshots,retired:[...new Set([...(info.manifest.retired||[]),...preview.keys,...info.manifest.snapshots])],createdAt:at};
 await remote(identity.target,{action:'control-put',key:'library.json',etag:info.etag,text:stable(manifest)});
 const next={...state,epoch,operations,pending:[],received:[],published:[],observed:project(preview.data)};const result=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:{...preview.data,zoteroEnabled:snapshot.data.zoteroEnabled},sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));
 // Cleanup is retryable. Only legacy note batches are eligible; never books or arbitrary paths.
 for(const key of manifest.retired){await renew();await remote(identity.target,{action:'delete',key});}
 return result;
 });}
