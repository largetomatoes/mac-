import {materialize,newSyncState,project,stable,tips,unionOperations,resolveConflict,rebaseOffline,type Operation} from './core';
import {initialNotebook,type Notebook} from '../notebook';
import {syncApi,sha256,operationBatches,type Envelope,type SyncMode} from './client';
export type SavedVersion={id:string;epoch:string;snapshots:string[];at:string;deviceName:string};
export type Manifest={schema:1|2|3|4;libraryId:string;epoch:string;snapshots:string[];createdAt:string;retired?:string[];baseline?:{device:string;deviceName:string;at:string};history?:SavedVersion[]};
export type CleanupStatus={remaining:number;deleted:number;paused:boolean;reason?:string};
export type CleanupResult=Envelope&{cleanup:CleanupStatus};
type RenewLease=(force?:boolean)=>Promise<void>;
export type CloudPreview={manifest:Manifest|null;operations:Operation[];data:Notebook;conflicts:ReturnType<typeof materialize>['conflicts'];keys:string[]};
const remote=<T,>(target:string,body:unknown)=>syncApi<T>('remote',{target,...body as object});
function assertLibraryBinding(state:ReturnType<typeof newSyncState>,target:string,manifest:Manifest|null){if(state.target&&state.target!==target)throw Error('连接的资料库已改变，请在连接设置中处理。');if(state.libraryId&&manifest&&state.libraryId!==manifest.libraryId)throw Error('本机与云端不是同一资料库，请核对后接入。');}
export async function readManifest(target:string):Promise<{manifest:Manifest|null;etag:string|null}>{const r=await remote<{text:string|null;etag:string|null}>(target,{action:'control-get',key:'library.json'});if(!r.text)return {manifest:null,etag:r.etag};const m=JSON.parse(r.text) as Manifest;const snapshotKeys=(keys:unknown):keys is string[]=>Array.isArray(keys)&&keys.every(k=>typeof k==='string'&&/^snapshots\/[a-f0-9]{64}\.json$/.test(k));if(![1,2,3,4].includes(m.schema)||!/^[-a-zA-Z0-9_]{8,100}$/.test(m.libraryId)||!(m.epoch==='legacy'||/^[-a-zA-Z0-9_]{8,100}$/.test(m.epoch))||!snapshotKeys(m.snapshots)||(m.retired!==undefined&&(!Array.isArray(m.retired)||m.retired.some(k=>!/^(?:changes|epochs\/[-a-zA-Z0-9_]{8,100}\/changes|snapshots)\/[a-f0-9]{64}\.json$/.test(k))))||(m.history!==undefined&&(!Array.isArray(m.history)||m.history.some(v=>!v||!/^[-a-zA-Z0-9_]{8,100}$/.test(v.id)||!snapshotKeys(v.snapshots)||typeof v.deviceName!=='string'||!Number.isFinite(Date.parse(v.at))))))throw Error('云端资料库标识无效，未修改本机内容。');return {manifest:m,etag:r.etag};}
export async function cloudPreview(target:string):Promise<CloudPreview>{const {manifest}=await readManifest(target),listing=await remote<{keys:string[]}>(target,{action:'list',epoch:manifest?.epoch||'legacy'});const operations:Operation[]=[];for(const key of [...(manifest?.snapshots||[]),...listing.keys]){const r=await remote<{text:string}>(target,{action:'get',key});if(await sha256(r.text)!==key.split('/').at(-1)?.slice(0,-5))throw Error('云端资料校验失败。');const batch=JSON.parse(r.text);if(batch.schema!==1||!Array.isArray(batch.operations))throw Error('云端同步格式暂不支持。');operations.push(...batch.operations);}const all=unionOperations(operations),local=structuredClone(initialNotebook);const merged=materialize({...newSyncState(),operations:all},local);return {manifest,operations:all,data:merged.data,conflicts:merged.conflicts,keys:listing.keys};}
export type LeaseRecovery={begin:(target:string,owner:string)=>Promise<{recoverableOwners:string[];deviceName?:string}>;end:(target:string,owner:string,released:boolean,succeeded:boolean)=>Promise<void>};
let leaseRecovery:LeaseRecovery|undefined;
export function setLeaseRecovery(recovery:LeaseRecovery){leaseRecovery=recovery;}
// Recovery requires the exact locally persisted prior task token, never just a device name.
export async function withCloudLease<T>(target:string,job:(renew:RenewLease)=>Promise<T>):Promise<T>{
 const owner=crypto.randomUUID(),recovery=leaseRecovery;let owned=false,nextRenewal=0,released=false,succeeded=false;
 const saved=await recovery?.begin(target,owner),recoverable=new Set(saved?.recoverableOwners||[]);
 const claim=async(force=false)=>{
  if(owned&&!force&&Date.now()<nextRenewal)return;
  const current=await remote<{text:string|null;etag:string|null}>(target,{action:'control-get',key:'lease.json'}),old=current.text?JSON.parse(current.text):null;
  if(owned&&old?.owner!==owner)throw Error('同步占用已失效，请重新同步。');
  if(old?.owner&&old.owner!==owner&&old.until>Date.now()&&!recoverable.has(old.owner)){
   released=true;
   const device=typeof old.deviceName==='string'?old.deviceName.replace(/[\r\n]/g,' ').slice(0,60):'另一台设备';
   throw Error(device+' 正在同步，请稍后重试。占用到期后可重试；不会覆盖正在进行的同步。');
  }
  if(current.text&&!current.etag)throw Error('云端未返回并发校验标识，暂不进行同步写入。');
  await remote(target,{action:'control-put',key:'lease.json',etag:current.etag,text:stable({owner,until:Date.now()+10*60*1000,...(saved?.deviceName?{deviceName:saved.deviceName}:{})})});
  owned=true;nextRenewal=Date.now()+60*1000;
 };
 try{await claim();const result=await job(claim);succeeded=true;return result;}
 finally{
  if(owned){try{const r=await remote<{text:string|null;etag:string|null}>(target,{action:'control-get',key:'lease.json'});if(r.text&&JSON.parse(r.text).owner===owner){if(r.etag){await remote(target,{action:'control-put',key:'lease.json',etag:r.etag,text:stable({owner:'',until:0})});released=true;}}else released=true;}catch{/* The local task token is retained for verified recovery after interruption. */}}
  await recovery?.end(target,owner,released,succeeded).catch(()=>{});
 }
}

async function saveSnapshots(target:string,operations:Operation[],renew?:RenewLease){const snapshots:string[]=[];for(const batch of operationBatches(operations)){await renew?.();const text=stable({schema:1,operations:batch}),key='snapshots/'+await sha256(text)+'.json';await remote(target,{action:'put',key,text});const saved=await remote<{text:string}>(target,{action:'get',key});if(saved.text!==text)throw Error('新快照校验失败，未切换资料库基准。');snapshots.push(key);}return snapshots;}
async function publishBaseline(target:string,snapshot:Envelope,data:Notebook,renew?:RenewLease):Promise<{manifest:Manifest;snapshot:Envelope}>{
 if(data.setupCompleted===false)throw Error('这台设备尚未建立书库，请先完成设置。');
 const identity=await syncApi<{target:string;deviceName?:string}>('identity');if(identity.target!==target)throw Error('同步连接已变化，请重新核对基准。');
 const state={...(snapshot.sync||newSyncState()),...(identity.deviceName?{deviceName:identity.deviceName}:{})};
 const previous=await cloudPreview(target),info=await readManifest(target);assertLibraryBinding(state,target,info.manifest);if(stable(previous.manifest)!==stable(info.manifest))throw Error('云端资料刚有变化，请重新核对基准。');if(info.manifest&&!info.etag)throw Error('云端未返回并发校验标识，未切换基准。');
 await syncApi('backup-local',{});
 const latest=await syncApi<Envelope>('local');if(latest.version!==snapshot.version||(latest.syncRevision||0)!==(snapshot.syncRevision||0))throw Error('本机刚有新修改，请重新核对基准。');
 const history=[...(info.manifest?.history||[])],at=new Date().toISOString(),deviceName=state.deviceName||'本机';
 const values=project(data),operations:Operation[]=[];
 for(const key of new Set([...tips(previous.operations).keys(),...Object.keys(values)])){if(key==='settings/zoteroEnabled')continue;operations.push({id:crypto.randomUUID(),key,value:values[key]??null,parents:[],at,device:state.device,deviceName});}
 // Validate the complete chosen graph before any snapshot or manifest is published.
 materialize({...state,operations:unionOperations(operations)},data);
 if(previous.operations.length){const snapshots=await saveSnapshots(target,previous.operations,renew);history.push({id:crypto.randomUUID(),epoch:info.manifest?.epoch||'legacy',snapshots,at:info.manifest?.baseline?.at||at,deviceName:info.manifest?.baseline?.deviceName||'切换前的云端资料'});}
 const snapshots=await saveSnapshots(target,operations,renew),epoch=crypto.randomUUID();
 // Schema 2 makes older writers stop before they can restore a discarded baseline.
 const manifest:Manifest={schema:4,libraryId:info.manifest?.libraryId||state.libraryId||crypto.randomUUID(),epoch,snapshots,createdAt:at,baseline:{device:state.device,deviceName,at},history,retired:[...new Set([...(info.manifest?.retired||[]),...previous.keys,...(info.manifest?.snapshots||[])])]};
 await remote(target,{action:'guard'});await renew?.(true);await remote(target,{action:'control-put',key:'library.json',etag:info.etag,text:stable(manifest)});
 const next={...state,target,libraryId:manifest.libraryId,epoch,operations,pending:[],received:[],published:[],observed:project(data)};
 const result=await syncApi<Envelope>('commit',{version:latest.version,syncRevision:latest.syncRevision||0,data:{...data,zoteroEnabled:latest.data.zoteroEnabled},sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));return {manifest,snapshot:result};
}
export async function restoreCloudVersion(id:string):Promise<Envelope>{const identity=await syncApi<{target:string;protocol?:number}>('identity');if(identity.protocol!==2)throw Error('请在新版客户端选择资料库版本。');return withCloudLease(identity.target,async renew=>{const {manifest}=await readManifest(identity.target),version=manifest?.history?.find(v=>v.id===id);if(!version)throw Error('资料库版本已变化，请重新读取。');const operations:Operation[]=[];for(const key of version.snapshots){const r=await remote<{text:string}>(identity.target,{action:'get',key});if(await sha256(r.text)!==key.split('/').at(-1)?.slice(0,-5))throw Error('历史快照校验失败。');const batch=JSON.parse(r.text);if(batch.schema!==1||!Array.isArray(batch.operations))throw Error('历史快照格式无效。');operations.push(...batch.operations);}const snapshot=await syncApi<Envelope>('local'),merged=materialize({...newSyncState(),operations:unionOperations(operations)},structuredClone(initialNotebook));if(merged.conflicts.length)throw Error('这份历史版本有未解决的冲突，请先接入并核对。');return (await publishBaseline(identity.target,snapshot,merged.data,renew)).snapshot;});}
export async function prepareDesktopSync(target:string,mode?:SyncMode,renew?:RenewLease,rootId?:string):Promise<{manifest:Manifest;snapshot:Envelope}>{
 let snapshot=await syncApi<Envelope>('local'),state=snapshot.sync||newSyncState();const info=await readManifest(target);let manifest=info.manifest;
 assertLibraryBinding(state,target,manifest);
 if(mode==='local')return publishBaseline(target,snapshot,snapshot.data,renew);
 const first=!state.lastSync&&!state.received.length&&!state.published?.length;
 if(first||!manifest||(state.epoch||'legacy')!==manifest.epoch){
  const preview=await cloudPreview(target),hasRemote=preview.operations.length>0;
  if(first&&hasRemote&&snapshot.data.setupCompleted!==false&&!mode)throw Error('云端已有资料，请先选择「接入已有资料」或核对后合并。');
  if(!manifest){const root=preview.operations.filter(o=>o.key==='notes/world').sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))[0];manifest={schema:1,libraryId:state.libraryId||(root?'library-'+(await sha256(root.id)).slice(0,32):crypto.randomUUID()),epoch:'legacy',snapshots:[],createdAt:new Date().toISOString()};await remote(target,{action:'control-put',key:'library.json',etag:info.etag,text:stable(manifest)});}
  if(first&&hasRemote&&(mode==='join'||snapshot.data.setupCompleted===false)){
   if(snapshot.data.setupCompleted!==false)await syncApi('backup-local',{});
   // Joining does not upload a temporary core question or copy its local settings over the library.
   state={...newSyncState(state.device),deviceName:state.deviceName,enabled:state.enabled,target,libraryId:manifest.libraryId,epoch:manifest.epoch,operations:preview.operations,received:preview.keys,observed:project(preview.data)};
   const rootConflict=preview.conflicts.find(c=>c.key==='notes/world');if(rootConflict){if(!rootId||!rootConflict.options.some(o=>o.id===rootId))throw Error('请先选择云端要使用的核心问题。');state=resolveConflict(state,'notes/world',rootId);}const data={...materialize(state,preview.data).data,zoteroEnabled:snapshot.data.zoteroEnabled};state.observed=project(data);await renew?.(true);snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data,sync:state});
   window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:snapshot}));
  }else if((state.epoch||'legacy')!==manifest.epoch){
   // Rebase ONLY edits made while offline; unchanged stale contents must never be resurrected.
   const created=rebaseOffline(state,snapshot.data,preview.operations,preview.data);
   const next={...state,libraryId:manifest.libraryId,epoch:manifest.epoch,operations:unionOperations(preview.operations,created),pending:created,received:preview.keys,published:[],observed:{}};
   const merged=materialize(next,snapshot.data);next.observed=project(merged.data);await renew?.(true);snapshot=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:merged.data,sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:snapshot}));
  }
 }
 if(manifest!.schema!==4){
  const latest=await readManifest(target);if(!latest.etag)throw Error('云端未返回并发校验标识，未升级资料格式。');
  if(latest.manifest?.epoch!==manifest!.epoch)throw Error('云端资料刚有变化，请重新同步。');
  await renew?.(true);manifest={...manifest!,schema:4};
  await remote(target,{action:'control-put',key:'library.json',etag:latest.etag,text:stable(manifest)});
 }
 await renew?.();return {manifest:manifest!,snapshot};
}
// Retired objects are a persistent work queue. Keep each user-triggered batch
// bounded, and stop immediately on a failed request instead of consuming quota.
async function cleanupRetired(target:string,snapshot:Envelope,renew:RenewLease):Promise<CleanupResult>{
 const info=await readManifest(target),manifest=info.manifest;if(!manifest||!info.etag)throw Error('云端资料库无法校验。');
 assertLibraryBinding(snapshot.sync||newSyncState(),target,manifest);
 const retired=[...new Set(manifest.retired||[])],protectedSnapshots=new Set([...manifest.snapshots,...(manifest.history||[]).flatMap(version=>version.snapshots)]);
 const eligible=retired.filter(key=>!protectedSnapshots.has(key)),deleted=new Set<string>();let reason:string|undefined;
 for(const key of eligible.slice(0,40)){
  try{await renew();await remote(target,{action:'delete',key});deleted.add(key);}
  catch(error){reason=error instanceof Error?error.message:'连接暂时不可用。';break;}
 }
 let remaining=eligible.filter(key=>!deleted.has(key));
 // A quota failure may also reject the checkpoint. In that case the next pass
 // safely retries at most this small batch; deleting an absent object is a no-op.
 if(!reason&&stable(retired)!==stable(remaining)){
  try{await renew(true);await remote(target,{action:'control-put',key:'library.json',etag:info.etag,text:stable({...manifest,retired:remaining})});}
  catch(error){reason=error instanceof Error?error.message:'清理进度暂未保存。';remaining=eligible;}
 }
 return {...snapshot,cleanup:{remaining:remaining.length,deleted:deleted.size,paused:remaining.length>0||!!reason,...(reason?{reason}:{})}};
}
export async function compactCloud():Promise<CleanupResult>{const identity=await syncApi<{target:string;protocol?:number}>('identity');if(identity.protocol!==2)throw Error('请在新版电脑端整理云端。');return withCloudLease(identity.target,async renew=>{
 const snapshot=await syncApi<Envelope>('local'),state=snapshot.sync;if(!state?.lastSync)throw Error('请先完成同步。');
 const info=await readManifest(identity.target);assertLibraryBinding(state,identity.target,info.manifest);if(!info.manifest||!info.etag)throw Error('云端资料库无法校验。');
 // Resume the existing queue without another backup, epoch or snapshot.
 if(info.manifest.retired?.length)return cleanupRetired(identity.target,snapshot,renew);
 if(state.pending.length||stable(project(snapshot.data))!==stable(state.observed))throw Error('本机有待上传修改，请先同步。');if(materialize(state,snapshot.data).conflicts.length)throw Error('请先处理所有冲突。');
 await syncApi('backup-local',{});const preview=await cloudPreview(identity.target);if(stable(project(preview.data))!==stable(project(snapshot.data)))throw Error('云端有新修改，请先同步，再整理。');
 if(stable(preview.manifest)!==stable(info.manifest))throw Error('云端资料刚有变化，请重新同步。');
 const epoch=crypto.randomUUID(),at=new Date().toISOString(),operations:Operation[]=[];
 for(const key of tips(preview.operations).keys()){if(key==='settings/zoteroEnabled')continue;const value=project(preview.data)[key]??null;operations.push({id:crypto.randomUUID(),key,parents:[],value,at,device:state.device,deviceName:state.deviceName});}
 const snapshots=await saveSnapshots(identity.target,operations,renew);
 // Old clients stop instead of bringing discarded history back into the current library.
 await remote(identity.target,{action:'guard'});await renew(true);
 const manifest={...info.manifest,epoch,snapshots,retired:[...new Set([...(info.manifest.retired||[]),...preview.keys,...info.manifest.snapshots])],createdAt:at};
 await remote(identity.target,{action:'control-put',key:'library.json',etag:info.etag,text:stable(manifest)});
 const next={...state,epoch,operations,pending:[],received:[],published:[],observed:project(preview.data)};const result=await syncApi<Envelope>('commit',{version:snapshot.version,syncRevision:snapshot.syncRevision||0,data:{...preview.data,zoteroEnabled:snapshot.data.zoteroEnabled},sync:next});window.dispatchEvent(new CustomEvent('wenjian-sync-updated',{detail:result}));
 return cleanupRetired(identity.target,result,renew);
 });}
