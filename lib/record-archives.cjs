const columns={question:'notes',cross:'crossThoughts',card:'cards',process:'readingNotes',reading:'bookThoughts',highlight:'libraryHighlights',book:'libraryBooks',reply:'thoughtReplies'};
const owners=['notes','crossThoughts','cards','readingNotes','bookThoughts'];
const key=target=>[target.kind,target.bookId||'',target.id].join(':');
function record(data,target){if(target.kind==='thought')return owners.flatMap(c=>(data[c]||[]).flatMap(v=>v.thoughts||[])).find(v=>v.id===target.id);if(target.kind==='zotero')return data.libraryBooks.find(b=>b.id===target.bookId)?.zotero?.annotations?.find(a=>a.attachmentKey+':'+a.key===target.id);return (data[columns[target.kind]]||[]).find(v=>v.id===target.id);}
function archiveRecords(data,targets,{at=new Date().toISOString(),batchId=globalThis.crypto.randomUUID()}={}){
 if(!Array.isArray(targets)||!targets.length)throw Error('请选择需要归档的记录。');
 const unique=[...new Map(targets.map(t=>[key(t),t])).values()],archives=[...(data.recordArchives||[])];
 for(const target of unique){const item=record(data,target);if(!item)throw Error('记录已变化，请重新核对。');if(target.kind==='question'&&!item.parent)throw Error('核心问题请使用问题页归档。');const i=archives.findIndex(a=>a.id===key(target)),previous=i>=0?archives[i]:null;if(previous?.archived)continue;const value={id:key(target),kind:target.kind,recordId:target.id,...(target.bookId?{bookId:target.bookId}:{}),archived:true,at,batchId,label:item.title||item.bookTitle||item.book||item.text?.slice(0,60)||item.quote?.slice(0,60)||'记录',events:[...(previous?.events||[]),{action:'archive',at,batchId}]};if(i<0)archives.push(value);else archives[i]=value;}
 return {...data,recordArchives:archives};
}
function archiveQuestionBranch(data,recordId,options){const ids=new Set([recordId]);let changed=true;while(changed){changed=false;for(const n of data.notes)if(ids.has(n.parent)&&!ids.has(n.id)){ids.add(n.id);changed=true;}}return archiveRecords(data,data.notes.filter(n=>ids.has(n.id)).map(n=>({kind:'question',id:n.id})),options);}
function restoreArchived(data,batchId,at=new Date().toISOString()){
 const selected=(data.recordArchives||[]).filter(a=>a.archived&&a.batchId===batchId&&!a.purgedAt);if(!selected.length)throw Error('归档内容已变化。');
 for(const entry of selected)if(!record(data,{kind:entry.kind,id:entry.recordId,bookId:entry.bookId}))throw Error('原记录暂时不可用，尚未恢复。');
 return {...data,recordArchives:data.recordArchives.map(a=>selected.includes(a)?{...a,archived:false,at,events:[...a.events,{action:'restore',at,batchId}]}:a)};
}
function archiveGroups(data){const groups=new Map();for(const a of data.recordArchives||[]){if(!a.archived||a.purgedAt)continue;const group=groups.get(a.batchId)||{id:a.batchId,at:a.at,label:a.label,count:0,archive:true,purgeable:true,records:[]};group.count++;group.purgeable=group.purgeable&&!['question','cross','book'].includes(a.kind);const item=record(data,{kind:a.kind,id:a.recordId,bookId:a.bookId});group.records.push({title:a.label,text:item?.interpretation||item?.body||item?.text||'',quote:item?.quote||''});groups.set(a.batchId,group);}return [...groups.values()].sort((a,b)=>b.at.localeCompare(a.at));}
function visibleNotebook(data){
 const entries=(data.recordArchives||[]).filter(a=>a.archived&&!a.purgedAt);if(!entries.length)return data;
 const hidden=new Set(entries.filter(a=>a.kind!=='zotero').map(a=>a.recordId)),next={...data};
 for(const column of Object.values(columns))next[column]=(data[column]||[]).filter(v=>!hidden.has(v.id));
 for(const column of owners)next[column]=(next[column]||[]).map(v=>v.thoughts?.some(t=>hidden.has(t.id))?{...v,thoughts:v.thoughts.filter(t=>!hidden.has(t.id))}:v);
 const hiddenThoughts=new Set(owners.flatMap(column=>(data[column]||[]).filter(v=>hidden.has(v.id)).flatMap(v=>(v.thoughts||[]).map(t=>t.id))));
 next.thoughtReplies=next.thoughtReplies.filter(r=>!hidden.has(r.thoughtId)&&!hiddenThoughts.has(r.thoughtId));
 next.links=data.links.filter(l=>!hidden.has(l.from)&&!hidden.has(l.to)&&!hiddenThoughts.has(l.from)&&!hiddenThoughts.has(l.to));
 next.libraryBooks=next.libraryBooks.map(b=>{const annotations=entries.filter(a=>a.kind==='zotero'&&a.bookId===b.id).map(a=>a.recordId);return annotations.length?{...b,hiddenZoteroAnnotations:[...new Set([...(b.hiddenZoteroAnnotations||[]),...annotations])]}:b;});
 if(data.questionPages)next.questionPages=data.questionPages.map(page=>{if(!page.placements)return page;const excluded=new Set(hidden);let changed=true;while(changed){changed=false;for(const p of page.placements)if(excluded.has(p.parentId)&&!excluded.has(p.recordId)){excluded.add(p.recordId);changed=true;}}return {...page,placements:page.placements.filter(p=>!excluded.has(p.recordId))};});
 return next;
}
function purgeArchiveBatch(data,batchId,removeRecords,at=new Date().toISOString()){
 const entries=(data.recordArchives||[]).filter(a=>a.archived&&a.batchId===batchId&&!a.purgedAt);if(!entries.length)throw Error('找不到归档内容。');
 if(entries.some(a=>['question','cross','book'].includes(a.kind)))throw Error('问题与书籍仍可能被其他位置引用。此处保留可恢复归档，不直接清除原件。');
 const next=removeRecords(data,entries.map(a=>({kind:a.kind,id:a.recordId,bookId:a.bookId})),{preserveThoughts:true});
 return {...next,recordArchives:(data.recordArchives||[]).map(a=>entries.includes(a)?{...a,purgedAt:at,at,events:[...a.events,{action:'purge',at,batchId}]}:a)};
}
module.exports={archiveRecords,archiveQuestionBranch,restoreArchived,archiveGroups,visibleNotebook,purgeArchiveBatch};
