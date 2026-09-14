import type {Notebook} from './notebook';
export function deletionPlan(data:Notebook,id:string){
 const target=data.notes.find(n=>n.id===id);
 if(!target||target.kind!=='question'||!target.parent)throw new Error('只能删除子问题，核心问题不能删除。');
 const ids=new Set([id]);let changed=true;
 while(changed){changed=false;for(const n of data.notes)if(n.parent&&ids.has(n.parent)&&!ids.has(n.id)){ids.add(n.id);changed=true;}}
 const notes=data.notes.filter(n=>ids.has(n.id));const links=data.links.filter(l=>ids.has(l.from)||ids.has(l.to));
 return {target,ids,notes,links,next:{...data,notes:data.notes.filter(n=>!ids.has(n.id)),links:data.links.filter(l=>!ids.has(l.from)&&!ids.has(l.to)),dismissedSuggestions:data.dismissedSuggestions.filter(s=>!Array.from(ids).some(id=>s.endsWith(':'+id)))}};
}
