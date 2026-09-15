import type {Notebook} from './notebook';
export function deletionPlan(data:Notebook,id:string){
 const target=data.notes.find(n=>n.id===id);
 if(!target||target.kind!=='question'||!target.parent)throw new Error('只能删除子问题，核心问题不能删除。');
 const ids=new Set([id]);let changed=true;
 while(changed){changed=false;for(const n of data.notes)if(n.parent&&ids.has(n.parent)&&!ids.has(n.id)){ids.add(n.id);changed=true;}}
 const notes=data.notes.filter(n=>ids.has(n.id));const links=data.links.filter(l=>ids.has(l.from)||ids.has(l.to));
 const readingNotes=data.readingNotes.filter(n=>n.questionIds.some(id=>ids.has(id)));
 const keptReadingNotes=data.readingNotes.flatMap(n=>{const questionIds=n.questionIds.filter(id=>!ids.has(id));return questionIds.length?[{...n,questionIds}]:[];});
 const thoughtIds=new Set(notes.flatMap(n=>(n.thoughts||[]).map(t=>t.id)));const removedAnchors=new Set([...ids,...thoughtIds]);
 const crossThoughts=data.crossThoughts.filter(c=>c.anchorIds.some(id=>removedAnchors.has(id)));
 const keptCrossThoughts=data.crossThoughts.flatMap(c=>{const anchorIds=c.anchorIds.filter(id=>!removedAnchors.has(id));return anchorIds.length>=2?[{...c,anchorIds}]:[];});
 return {target,ids,notes,links,readingNotes,crossThoughts,next:{...data,notes:data.notes.filter(n=>!ids.has(n.id)),readingNotes:keptReadingNotes,crossThoughts:keptCrossThoughts,links:data.links.filter(l=>!ids.has(l.from)&&!ids.has(l.to)),dismissedSuggestions:data.dismissedSuggestions.filter(s=>!Array.from(ids).some(id=>s.endsWith(':'+id)))}};
}
