import type {Notebook} from './notebook';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const key=(value:unknown):string|undefined=>object(value)?typeof value.id==='string'?value.id:typeof value.libraryBookId==='string'&&typeof value.page==='number'?`${value.libraryBookId}:${value.page}`:typeof value.serverId==='string'&&typeof value.key==='string'?`${value.serverId}:${value.key}`:undefined:undefined;

// Apply only the pane's actual changes to the latest saved snapshot.
export function rebaseReading(base:Notebook,edited:Notebook,current:Notebook):Notebook {
 function merge(before:unknown,after:unknown,latest:unknown,path:string):unknown {
  if(same(before,after))return latest;
  if(same(after,latest))return latest;
  if(same(before,latest))return after;
  if(Array.isArray(before)&&Array.isArray(after)&&Array.isArray(latest)&&[...before,...after,...latest].every(value=>key(value)!==undefined)){
   const old=new Map(before.map(value=>[key(value),value])),changed=new Map(after.map(value=>[key(value),value])),now=new Map(latest.map(value=>[key(value),value]));
   const result:unknown[]=[];
   for(const [id,value] of now){
    if(old.has(id)&&!changed.has(id)){if(!same(old.get(id),value))throw Error('这条记录刚在另一处修改，请重新打开后再保存。');continue;}
    result.push(old.has(id)&&changed.has(id)?merge(old.get(id),changed.get(id),value,`${path}.${id}`):value);
   }
   for(const [id,value] of changed)if(!old.has(id)&&!now.has(id))result.push(value);
   // A stale progress update must never resurrect a removed book or note.
   return result;
  }
  if(object(before)&&object(after)&&object(latest)){
   const result={...latest};
   for(const field of new Set([...Object.keys(before),...Object.keys(after)])){
    const value=merge(before[field],after[field],latest[field],`${path}.${field}`);
    if(value===undefined)delete result[field];else result[field]=value;
   }
   return result;
  }
  // The most recently active position wins for the same book; pane positions
  // are additionally retained separately in comparison drafts.
  if(path.includes('.progress.'))return after;
  throw Error('这条内容刚在另一处修改，草稿已保留，请重新打开后再保存。');
 }
 return merge(base,edited,current,'notebook') as Notebook;
}
