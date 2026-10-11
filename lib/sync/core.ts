import type {Notebook} from '../notebook';
export type SyncValue = unknown;
export type Operation = {id:string;key:string;parents:string[];value:SyncValue;at:string;device:string;deviceName?:string};
export type SyncState = {schema:1;device:string;deviceName?:string;libraryId?:string;epoch?:string;enabled:boolean;target:string;operations:Operation[];pending:Operation[];received:string[];observed:Record<string,SyncValue>;lastSync?:string;published?:string[];books?:{errors:Record<string,string>;lastChecked?:string}};
export type Conflict = {key:string;options:Operation[]};
const collections=['notes','links','cards','readingNotes','crossThoughts','thoughtReplies','manuscripts','libraryBooks','libraryFolders','zoteroCollections','libraryHighlights','bookThoughts','ocrCache'] as const;
const scalars=['setupCompleted','dismissedSuggestions'] as const;
const legacyScalars=[...scalars,'zoteroEnabled'] as const;
const own=(object:object,key:string)=>Object.prototype.hasOwnProperty.call(object,key);
export function stable(value:unknown):string {if(value===undefined)return 'null';if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';}
export function newSyncState(device=crypto.randomUUID()):SyncState{return {schema:1,device,enabled:false,target:'',operations:[],pending:[],received:[],observed:{}};}
export function project(data:Notebook):Record<string,SyncValue>{
 const result:Record<string,SyncValue>={};if(data.setupCompleted===false)return result;
 for(const collection of collections)for(const item of data[collection]||[]){const record=item as unknown as Record<string,unknown>;const id=collection==='ocrCache'?JSON.stringify([record.libraryBookId,record.page]):collection==='zoteroCollections'?JSON.stringify([record.serverId,record.key]):record.id;if(typeof id!=='string'||!id)throw Error('有一条记录缺少编号，未进行同步。');if(collection==='libraryBooks'){const {progress,...metadata}=record;result[`${collection}/${encodeURIComponent(id)}`]=metadata;result[`readingProgress/${encodeURIComponent(id)}`]={id,progress:progress||{}};}else result[`${collection}/${encodeURIComponent(id)}`]=item;}
 for(const key of scalars)result['settings/'+key]=data[key]??(key==='dismissedSuggestions'?[]:true);
 return result;
}
export function validateOperation(value:unknown):value is Operation {
 if(!value||typeof value!=='object')return false;const op=value as Operation;
 if(typeof op.id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(op.id)||typeof op.device!=='string'||op.device.length>100||typeof op.at!=='string'||!Number.isFinite(Date.parse(op.at))||typeof op.key!=='string'||op.key.length>2000||!Array.isArray(op.parents)||op.parents.some(p=>typeof p!=='string'||p===op.id)||!own(op,'value'))return false;
 const [collection,id,...extra]=op.key.split('/');if(extra.length||!id)return false;
 if(collection==='settings')return (legacyScalars as readonly string[]).includes(id)&&(id==='dismissedSuggestions'?Array.isArray(op.value):typeof op.value==='boolean');
 if(collection!=='readingProgress'&&!(collections as readonly string[]).includes(collection))return false;
 if(op.value===null)return !(collection==='notes'&&decodeURIComponent(id)==='world');
 if(typeof op.value!=='object'||Array.isArray(op.value))return false;
 const record=op.value as Record<string,unknown>;
 try{return decodeURIComponent(id)===(collection==='ocrCache'?JSON.stringify([record.libraryBookId,record.page]):collection==='zoteroCollections'?JSON.stringify([record.serverId,record.key]):record.id);}catch{return false;}
}
export function unionOperations(...sets:Operation[][]):Operation[]{const map=new Map<string,Operation>();for(const op of sets.flat()){if(!validateOperation(op))throw Error('云端同步记录格式不正确，未修改本机资料。');const old=map.get(op.id);if(old&&stable(old)!==stable(op))throw Error('同步记录编号发生冲突，已停止合并。');map.set(op.id,op);}return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id));}
export function tips(operations:Operation[]):Map<string,Operation[]>{
 const retired=new Set(operations.flatMap(op=>op.parents));const groups=new Map<string,Operation[]>();
 for(const op of operations)if(!retired.has(op.id)){const list=groups.get(op.key)||[];list.push(op);groups.set(op.key,list);}
 for(const list of groups.values())list.sort((a,b)=>a.id.localeCompare(b.id));return groups;
}
export function distinct(options:Operation[]){return [...new Map(options.map(op=>[stable(op.value),op])).values()];}
// Only merge edits with a shared ancestor. Separate first-run libraries must be reviewed.
function mergedValue(key:string,options:Operation[],operations:Operation[]):{ok:boolean;value:unknown}{
 const values=distinct(options);if(values.length===1)return {ok:true,value:values[0].value};
 if(key==='settings/zoteroEnabled')return {ok:true,value:null};
 if(key==='settings/dismissedSuggestions')return {ok:true,value:[...new Set(values.flatMap(op=>op.value as string[]))].sort()};
 const byId=new Map(operations.map(op=>[op.id,op]));
 const ancestors=(op:Operation)=>{const ids=new Set<string>();const visit=(id:string)=>{if(ids.has(id))return;ids.add(id);byId.get(id)?.parents.forEach(visit);};op.parents.forEach(visit);return ids;};
 const sets=values.map(ancestors),common=operations.filter(op=>op.key===key&&sets.every(set=>set.has(op.id)));
 const base=tips(common).get(key);if(base?.length!==1)return {ok:false,value:null};
 let result=structuredClone(base[0].value);
 for(const op of values){const merge=mergeRecord(base[0].value,result,op.value);if(!merge.ok)return merge;result=merge.value;}
 return {ok:true,value:result};
}
function mergeRecord(base:unknown,a:unknown,b:unknown):{ok:boolean;value:unknown}{
 if(stable(a)===stable(b))return {ok:true,value:a};if(stable(a)===stable(base))return {ok:true,value:b};if(stable(b)===stable(base))return {ok:true,value:a};
 if(!base||!a||!b||typeof base!=='object'||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))return {ok:false,value:null};
 const before=base as Record<string,unknown>,left=a as Record<string,unknown>,right=b as Record<string,unknown>,out:Record<string,unknown>={};
 for(const field of new Set([...Object.keys(before),...Object.keys(left),...Object.keys(right)])){
  let merged: {ok:boolean;value:unknown};
  if(['thoughts','revisions','anchorRevisions'].includes(field)&&Array.isArray(left[field])&&Array.isArray(right[field])){
   const old=(before[field]||[]) as Record<string,unknown>[],aa=left[field] as Record<string,unknown>[],bb=right[field] as Record<string,unknown>[];
   const identity=(item:Record<string,unknown>)=>typeof item.id==='string'?item.id:stable(item);
   const bm=new Map(old.map(item=>[identity(item),item])),am=new Map(aa.map(item=>[identity(item),item])),cm=new Map(bb.map(item=>[identity(item),item]));const items:unknown[]=[];
   for(const id of new Set([...bm.keys(),...am.keys(),...cm.keys()])){const item=mergeRecord(bm.get(id)??null,am.get(id)??null,cm.get(id)??null);if(!item.ok)return item;if(item.value!==null)items.push(item.value);}
   items.sort((x,y)=>String((x as {at?:string}).at||'').localeCompare(String((y as {at?:string}).at||''))||stable(x).localeCompare(stable(y)));merged={ok:true,value:items};
  }else merged=mergeRecord(before[field],left[field],right[field]);
  if(!merged.ok)return merged;if(merged.value!==undefined)out[field]=merged.value;
 }
 return {ok:true,value:out};
}
export function capture(state:SyncState,data:Notebook,id=()=>crypto.randomUUID(),at=new Date().toISOString()):SyncState{
 const next=project(data),heads=tips(state.operations),created:Operation[]=[];
 for(const key of new Set([...Object.keys(state.observed),...Object.keys(next)])){
  if(key==='settings/zoteroEnabled')continue;
  const before=state.observed[key]??null,after=next[key]??null;if(stable(before)===stable(after))continue;
  const options=heads.get(key)||[];
  if(!key.startsWith('readingProgress/')&&!key.startsWith('ocrCache/')&&options.length&&!mergedValue(key,options,state.operations).ok)throw Error('这条记录有不同设备的版本，请先在同步窗口选择要保留的版本。');
  created.push({id:id(),key,parents:options.map(op=>op.id),value:after,at,device:state.device,...(state.deviceName?{deviceName:state.deviceName}:{})});
 }
 return {...state,observed:next,operations:unionOperations(state.operations,created),pending:unionOperations(state.pending,created)};
}
export function materialize(state:SyncState,local:Notebook):{data:Notebook;conflicts:Conflict[]}{
 validateGraph(state.operations);
 const data=structuredClone(local),conflicts:Conflict[]=[],heads=tips(state.operations),localValues=project(local);
 if(!heads.size)return {data,conflicts};
 for(const collection of collections)(data as unknown as Record<string,unknown>)[collection]=[];
 for(const [key,options] of heads){
  if(key==='settings/zoteroEnabled')continue;
  const merge=mergedValue(key,options,state.operations),automatic=key.startsWith('readingProgress/')||key.startsWith('ocrCache/');
  if(!automatic&&!merge.ok)conflicts.push({key,options:distinct(options)});
  const newest=[...options].sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
  const winner=key.startsWith('ocrCache/')?[...newest].sort((a,b)=>Number((b.value as {version?:number})?.version||0)-Number((a.value as {version?:number})?.version||0))[0]:automatic?newest[0]:options.find(op=>op.device===state.device&&stable(op.value)===stable(localValues[key]))||options.find(op=>stable(op.value)===stable(localValues[key]))||newest.find(op=>op.value!==null)||newest[0];
  const value=!automatic&&merge.ok?merge.value:winner.value;if(value===null)continue;
  const [collection,id]=key.split('/');if(collection==='settings')(data as unknown as Record<string,unknown>)[id]=structuredClone(value);
  else if(collection!=='readingProgress')((data as unknown as Record<string,unknown[]>)[collection]).push(structuredClone(value));
 }
 // Preserve existing order. Newly received records use an explicit stable tie breaker.
 for(const collection of collections){const order=new Map((local[collection]||[]).map((v,i)=>[(v as {id?:string}).id,i]));(data[collection] as unknown as {id?:string;at?:string}[]).sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity)||String(a.at||'').localeCompare(String(b.at||''))||String(a.id||'').localeCompare(String(b.id||'')));}
 for(const book of data.libraryBooks){const progress=heads.get('readingProgress/'+encodeURIComponent(book.id));book.progress=progress?.length?structuredClone((([...progress].sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id))[0].value as {progress?:typeof book.progress})?.progress)||{}):{};}
 if(!data.notes.some(n=>n.id==='world'&&!n.parent))throw Error('同步资料缺少核心问题，未修改本机资料。');
 const ids=new Set([...data.notes.map(n=>n.id),...data.crossThoughts.map(n=>n.id)]);
 if(data.notes.some(n=>n.parent&&!ids.has(n.parent)))throw Error('某个问题在一端被删除、另一端添加了子问题。请先恢复该父问题，再同步。');
 return {data,conflicts};
}
export function resolveConflict(state:SyncState,key:string,chosenId:string,id=crypto.randomUUID()):SyncState{
 const options=tips(state.operations).get(key)||[],chosen=options.find(op=>op.id===chosenId);if(!chosen)throw Error('待处理版本已变化，请重新打开同步窗口。');
 const op:Operation={id,key,value:structuredClone(chosen.value),parents:options.map(o=>o.id),device:state.device,at:new Date().toISOString()};
 return {...state,operations:unionOperations(state.operations,[op]),pending:unionOperations(state.pending,[op])};
}

export function validateGraph(operations:Operation[]){const byId=new Map(operations.map(op=>[op.id,op]));const visiting=new Set<string>(),visited=new Set<string>();function visit(op:Operation){if(visiting.has(op.id))throw Error('同步记录依赖出现循环。');if(visited.has(op.id))return;visiting.add(op.id);for(const parent of op.parents){const previous=byId.get(parent);if(!previous||previous.key!==op.key)throw Error('同步记录的前一版本缺失，请重新同步。');visit(previous);}visiting.delete(op.id);visited.add(op.id);}for(const op of operations)visit(op);}
