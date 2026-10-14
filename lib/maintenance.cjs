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
module.exports={removeRecord};
