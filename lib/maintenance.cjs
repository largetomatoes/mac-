function unlink(data,removed){
 const ids=new Set(removed);
 return {...data,links:data.links.filter(l=>!ids.has(l.from)&&!ids.has(l.to)),crossThoughts:data.crossThoughts.map(c=>{const anchors=c.anchorIds.filter(id=>!ids.has(id));return anchors.length===c.anchorIds.length?c:{...c,anchorIds:anchors,anchorRevisions:[...c.anchorRevisions,{from:c.anchorIds,to:anchors,at:new Date().toISOString(),reason:'关联记录在资料维护中移除'}]};})};
}
function removeRecord(data,target){
 if(!target||typeof target.id!=='string'||typeof target.kind!=='string')throw Error('请选择有效的记录。');
 const collection={highlight:'libraryHighlights',process:'readingNotes',reading:'bookThoughts',card:'cards',reply:'thoughtReplies'}[target.kind];
 if(collection){
  if(!data[collection]?.some(item=>item.id===target.id))throw Error('记录已变化，请重新选择。');
  let next={...data,[collection]:data[collection].filter(item=>item.id!==target.id)};
  if(target.kind==='process')next={...next,manuscripts:data.manuscripts.map(m=>({...m,links:m.links.map(l=>l.targetKind==='reading'&&l.questionId===target.id?{...l,unresolved:true}:l)}))};
  if(['card','process','reading'].includes(target.kind)){const removed=[target.id,...(data[collection].find(item=>item.id===target.id)?.thoughts||[]).map(t=>t.id)];const ids=new Set(removed);next={...next,thoughtReplies:next.thoughtReplies.filter(reply=>!ids.has(reply.thoughtId))};return unlink(next,removed);}return next;
 }
 if(target.kind==='thought'){
  let found=false;const clean=items=>items.map(item=>{if(!item.thoughts?.some(t=>t.id===target.id))return item;found=true;return {...item,thoughts:item.thoughts.filter(t=>t.id!==target.id)};});
  const next={...data,notes:clean(data.notes),cards:clean(data.cards),crossThoughts:clean(data.crossThoughts),readingNotes:clean(data.readingNotes),bookThoughts:clean(data.bookThoughts),thoughtReplies:data.thoughtReplies.filter(r=>r.thoughtId!==target.id)};
  if(!found)throw Error('思考记录已变化，请重新选择。');return unlink(next,[target.id]);
 }
 if(target.kind==='zotero'){
  const book=data.libraryBooks.find(book=>book.id===target.bookId),annotation=book?.zotero?.annotations.find(a=>a.attachmentKey+':'+a.key===target.id);
  if(!annotation)throw Error('来源批注已变化，请重新选择。');
  return {...data,libraryBooks:data.libraryBooks.map(b=>b.id===book.id?{...b,hiddenZoteroAnnotations:[...new Set([...(b.hiddenZoteroAnnotations||[]),target.id])]}:b)};
 }
 throw Error('此类型请使用对应的专门管理入口。');
}
const collections={highlight:'libraryHighlights',process:'readingNotes',reading:'bookThoughts',card:'cards',reply:'thoughtReplies'};
const owners=['notes','crossThoughts','cards','readingNotes','bookThoughts'];
function recordFor(data,target){
 if(target.kind==='thought')return owners.flatMap(k=>data[k].flatMap(owner=>owner.thoughts||[])).find(v=>v.id===target.id);
 return data[collections[target.kind]]?.find(v=>v.id===target.id);
}
function maintenanceImpact(data,targets){
 const selected=new Set(targets.map(t=>t.id)),children=new Set();
 for(const target of targets)for(const thought of recordFor(data,target)?.thoughts||[])if(!selected.has(thought.id))children.add(thought.id);
 const replies=data.thoughtReplies.filter(r=>(selected.has(r.thoughtId)||children.has(r.thoughtId))&&!selected.has(r.id));
 const linked=new Set([...selected,...children]);
 return {records:targets.length,thoughts:children.size,replies:replies.length,links:data.links.filter(l=>linked.has(l.from)||linked.has(l.to)).length,hidden:targets.filter(t=>t.kind==='zotero').length};
}
function removeRecords(data,targets,{preserveThoughts=true,id=()=>globalThis.crypto.randomUUID(),at=new Date().toISOString()}={}){
 if(!Array.isArray(targets)||!targets.length||targets.length>10000)throw Error('请选择需要处理的记录。');
 const keys=new Set(),selected=new Set(targets.map(t=>t.id));
 for(const target of targets){const key=target.kind+':'+(target.bookId||'')+':'+target.id;if(keys.has(key))throw Error('记录重复，请重新选择。');keys.add(key);if(target.kind!=='zotero'&&!recordFor(data,target))throw Error('记录已变化，请重新选择。');}
 let next=data;
 // Children are moved intact, with their IDs and replies, before deleting the parent.
 for(const target of targets){
  const collection=collections[target.kind],record=recordFor(next,target);
  const thoughts=(record?.thoughts||[]).filter(t=>!selected.has(t.id));
  if(preserveThoughts&&thoughts.length&&['process','reading','card'].includes(target.kind)){
   const holderId=id();
   if(target.kind==='card'){
    const holder={id:holderId,kind:'idea',text:'保留的后续思考',origin:'自己的思考',source:[record.source,record.text].filter(Boolean).join('\n'),at,thoughts};
    next={...next,cards:[...next.cards,holder]};
   }else{
    const holder={id:holderId,libraryBookId:record.libraryBookId,bookTitle:record.book||record.bookTitle||'',scope:record.scope||'location',locator:record.locator||'',sourceLocation:record.sourceLocation,chapter:record.chapter,quote:record.quote,text:'保留的后续思考',questionIds:record.questionIds||[],at,thoughts,...(record.sources?{sources:record.sources}:{})};
    next={...next,bookThoughts:[...next.bookThoughts,holder]};
   }
   next={...next,[collection]:next[collection].map(v=>v.id===target.id?{...v,thoughts:(v.thoughts||[]).filter(t=>selected.has(t.id))}:v)};
  }
 }
 // Remove children first if both parent and child were explicitly selected.
 const ordered=[...targets].sort((a,b)=>({reply:2,thought:1}[b.kind]||0)-({reply:2,thought:1}[a.kind]||0));
 for(const target of ordered)next=removeRecord(next,target);
 return next;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function maintenanceReceipt(before,after,meta){
 const changes=[];
 for(const collection of ['notes','cards','readingNotes','crossThoughts','thoughtReplies','manuscripts','libraryBooks','libraryHighlights','bookThoughts','links']){
  const a=new Map(before[collection].map(v=>[v.id,v])),b=new Map(after[collection].map(v=>[v.id,v]));
  for(const id of new Set([...a.keys(),...b.keys()]))if(!same(a.get(id),b.get(id)))changes.push({collection,id,before:clone(a.get(id)),after:clone(b.get(id))});
 }
 return {...meta,changes};
}
// Revert only fields changed by this operation. Never overwrite later edits.
function restoreValue(current,after,before){
 if(same(before,after)||same(current,before))return current;
 if(same(current,after))return clone(before);
 if(Array.isArray(before)&&Array.isArray(after)&&Array.isArray(current)){
  if([...before,...after,...current].every(v=>typeof v==='string')){
   const removed=before.filter(v=>!after.includes(v)),added=after.filter(v=>!before.includes(v));
   return [...current.filter(v=>!added.includes(v)),...removed.filter(v=>!current.includes(v))];
  }
  if([...before,...after,...current].every(v=>v&&typeof v.id==='string')){
   const result=[...current],a=new Map(after.map(v=>[v.id,v])),b=new Map(before.map(v=>[v.id,v]));
   for(const id of new Set([...a.keys(),...b.keys()])){const i=result.findIndex(v=>v.id===id),value=restoreValue(i<0?undefined:result[i],a.get(id),b.get(id));if(value===undefined){if(i>=0)result.splice(i,1);}else if(i>=0)result[i]=value;else result.push(value);}
   return result;
  }
 }
 if(before&&after&&current&&!Array.isArray(before)&&!Array.isArray(after)&&!Array.isArray(current)&&typeof before==='object'&&typeof after==='object'&&typeof current==='object'){
  const result={...current};for(const key of new Set([...Object.keys(before),...Object.keys(after)])){const value=restoreValue(current[key],after[key],before[key]);if(value===undefined)delete result[key];else result[key]=value;}return result;
 }
 throw Error('相关内容在删除后又有修改，无法安全自动恢复。当前内容与最近删除副本均已保留。');
}
function restoreMaintenance(data,receipt){
 let next={...data};
 for(const change of receipt.changes){const rows=[...next[change.collection]],index=rows.findIndex(v=>v.id===change.id),value=restoreValue(index<0?undefined:rows[index],change.after,change.before);if(value===undefined){if(index>=0)rows.splice(index,1);}else if(index>=0)rows[index]=value;else rows.push(value);next[change.collection]=rows;}
 const questions=new Set([...next.notes.filter(n=>n.kind==='question'),...next.crossThoughts].map(n=>n.id));
 for(const change of receipt.changes){
  if(!change.before)continue;const value=next[change.collection].find(v=>v.id===change.id);if(!value)continue;
  const required=change.collection==='notes'?[value.parent].filter(Boolean):['readingNotes','bookThoughts'].includes(change.collection)?value.questionIds||[]:change.collection==='cards'?[value.questionId].filter(Boolean):[];
  if(required.some(id=>!questions.has(id)))throw Error('原先关联的问题已移除，请先恢复相关问题，再恢复这条记录。恢复副本已保留。');
 }
 return next;
}
module.exports={removeRecord,removeRecords,maintenanceImpact,maintenanceReceipt,restoreMaintenance};
