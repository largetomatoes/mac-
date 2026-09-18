import {crossSignature,type Notebook} from './notebook';
export function deletionPlan(data:Notebook,id:string){
 const target=data.notes.find(n=>n.id===id);
 if(!target||target.kind!=='question'||!target.parent)throw new Error('只能删除子问题，核心问题不能删除。');
 const ids=new Set([id]);let changed=true;
 while(changed){changed=false;for(const n of data.notes)if(n.parent&&ids.has(n.parent)&&!ids.has(n.id)){ids.add(n.id);changed=true;}}
 const notes=data.notes.filter(n=>ids.has(n.id));const links=data.links.filter(l=>ids.has(l.from)||ids.has(l.to));
 const readingNotes=data.readingNotes.filter(n=>n.questionIds.some(id=>ids.has(id)));
 const keptReadingNotes=data.readingNotes.flatMap(n=>{const questionIds=n.questionIds.filter(id=>!ids.has(id));return questionIds.length?[{...n,questionIds}]:[];});
 const thoughtIds=new Set([...notes.flatMap(n=>(n.thoughts||[]).map(t=>t.id)),...readingNotes.flatMap(n=>n.thoughts.map(t=>t.id))]);const removedAnchors=new Set([...ids,...thoughtIds]);
 const crossThoughts=data.crossThoughts.filter(c=>c.anchorIds.some(id=>removedAnchors.has(id)));
 const keptCrossThoughts=data.crossThoughts.map(c=>{const anchorIds=c.anchorIds.filter(id=>!removedAnchors.has(id));return anchorIds.length===c.anchorIds.length?c:{...c,anchorIds,anchorRevisions:[...c.anchorRevisions,{from:c.anchorIds,to:anchorIds,fromLabel:crossSignature(c,data),toLabel:crossSignature({...c,anchorIds},data),at:new Date().toISOString(),reason:'关联板块被删除'}]};});
 return {target,ids,notes,links,readingNotes,crossThoughts,next:{...data,notes:data.notes.filter(n=>!ids.has(n.id)),readingNotes:keptReadingNotes,crossThoughts:keptCrossThoughts,thoughtReplies:data.thoughtReplies.filter(r=>!thoughtIds.has(r.thoughtId)),manuscripts:data.manuscripts.map(m=>({...m,links:m.links.filter(link=>link.targetKind==='reading'?!readingNotes.some(note=>note.id===link.questionId):!ids.has(link.questionId))})),links:data.links.filter(l=>!ids.has(l.from)&&!ids.has(l.to)),dismissedSuggestions:data.dismissedSuggestions.filter(s=>!Array.from(ids).some(id=>s.endsWith(':'+id)))}};
}
