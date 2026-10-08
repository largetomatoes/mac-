import {type Notebook} from './notebook';

export type GraphEdge={id:string;from:string;to:string;type:string;kind:'hierarchy'|'cross'|'link'};
export type GraphProjection={visibleIds:string[];edges:GraphEdge[]};
export type GraphData=Pick<Notebook,'notes'|'cards'|'crossThoughts'|'links'>;

/** Thoughts refer back to their owning board; the notebook itself stays untouched. */
export function graphOwners(data:GraphData):Map<string,string>{
 const owners=new Map<string,string>();
 for(const item of [...data.notes,...data.cards,...data.crossThoughts])
  for(const thought of item.thoughts||[])owners.set(thought.id,item.id);
 return owners;
}

/** Every structural board is visible. Unconnected cards stay in the card collection. */
export function projectGraph(data:GraphData):GraphProjection{
 const owners=graphOwners(data),owner=(id:string)=>owners.get(id)||id;
 const cardIds=new Set(data.cards.map(card=>card.id));
 const connectedCards=new Set([...data.links.flatMap(link=>[link.from,link.to]),...data.crossThoughts.flatMap(cross=>cross.anchorIds)].map(owner).filter(id=>cardIds.has(id)));
 const graphIds=new Set([...data.notes.map(note=>note.id),...data.crossThoughts.map(cross=>cross.id),...connectedCards]);
 const edges:GraphEdge[]=[
  ...data.notes.filter(note=>note.parent&&graphIds.has(note.parent)).map(note=>({id:`parent:${note.id}`,from:note.parent!,to:note.id,type:note.kind==='question'?'子问题':'回答',kind:'hierarchy' as const})),
  ...data.links.map(link=>({id:`link:${link.id}`,from:owner(link.from),to:owner(link.to),type:link.type,kind:'link' as const})),
  ...data.crossThoughts.flatMap(cross=>[...new Set(cross.anchorIds.map(owner))].map((id,index)=>({id:`cross:${cross.id}:${index}`,from:id,to:cross.id,type:'交叉',kind:'cross' as const})))
 ].filter(edge=>graphIds.has(edge.from)&&graphIds.has(edge.to)&&edge.from!==edge.to);
 return {visibleIds:[...graphIds],edges};
}
