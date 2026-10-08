import {ROOT} from './notebook';
import {graphOwners,type GraphProjection,type GraphData} from './graph-projection';

export type GraphPosition={x:number;y:number};
export const GRAPH_NODE_WIDTH=260;
export const GRAPH_NODE_HEIGHT=124;
const COLUMN=368, GAP=44, CLEARANCE=24;
type Tree={id:string;children:Tree[];height:number;gaps:Map<number,string[]>};

/** A deterministic tree, with room reserved between branches for their cross boards.
 * Text edits never enter this calculation. Coordinates are anchored to the top of
 * each subtree so additions move following siblings, rather than reshuffling all nodes.
 */
export function layoutGraph(data:GraphData,projection:GraphProjection):Record<string,GraphPosition>{
 const visible=new Set(projection.visibleIds),positions:Record<string,GraphPosition>={};
 const notes=new Map(data.notes.map(note=>[note.id,note]));
 const crosses=[...data.crossThoughts].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
 const crossIds=new Set(crosses.map(cross=>cross.id));
 const owners=graphOwners(data),owner=(id:string)=>owners.get(id)||id;
 const children=new Map<string,string[]>();
 for(const note of [...data.notes].sort((a,b)=>a.kind===b.kind?a.order-b.order||a.id.localeCompare(b.id):a.kind==='question'?-1:1)){
  if(note.parent&&visible.has(note.id)){const list=children.get(note.parent)||[];list.push(note.id);children.set(note.parent,list);}
 }
 // Identify the first branch boundary separating anchors, without changing parents.
 const ancestry=(id:string)=>{
  const path:string[]=[],seen=new Set<string>();
  while(id&&!seen.has(id)){seen.add(id);path.unshift(id);id=notes.get(id)?.parent||'';}
  return path;
 };
 const reservations=new Map<string,Map<number,string[]>>();
 for(const cross of crosses){
  const paths=[...new Set(cross.anchorIds.map(owner))].map(ancestry);
  if(paths.length<2||paths.some(path=>!path.length||path[0]!==paths[0][0]))continue;
  let depth=0;
  while(paths.every(path=>path[depth]&&path[depth]===paths[0][depth]))depth++;
  if(depth===0||paths.some(path=>!path[depth]))continue; // Ancestor/descendant links use a nearby free slot.
  const parent=paths[0][depth-1],siblings=children.get(parent)||[];
  const indices=paths.map(path=>siblings.indexOf(path[depth]));
  if(indices.some(index=>index<0))continue;
  const boundary=Math.floor((Math.min(...indices)+Math.max(...indices)-1)/2);
  const gaps=reservations.get(parent)||new Map<number,string[]>();
  gaps.set(boundary,[...(gaps.get(boundary)||[]),cross.id]);reservations.set(parent,gaps);
 }
 const building=new Set<string>(),trees=new Map<string,Tree>();
 const build=(id:string):Tree=>{
  const cached=trees.get(id);if(cached)return cached;
  if(building.has(id))return {id,children:[],height:GRAPH_NODE_HEIGHT,gaps:new Map()};
  building.add(id);
  const branch=(children.get(id)||[]).filter(child=>!building.has(child)).map(build);
  const gaps=reservations.get(id)||new Map<number,string[]>();
  const height=Math.max(GRAPH_NODE_HEIGHT,branch.reduce((sum,child,index)=>sum+child.height+(index?GAP:0)+(gaps.get(index)||[]).reduce((space,crossId)=>space+(building.has(crossId)?GRAPH_NODE_HEIGHT:build(crossId).height)+GAP,0),0));
  const tree={id,children:branch,height,gaps};trees.set(id,tree);building.delete(id);return tree;
 };
 const slots=new Map<string,{x:number;y:number}>();
 const placed=new Set<string>();
 const placeTree=(tree:Tree,x:number,top:number,target=positions,collectSlots=true)=>{
  if(target[tree.id])return;
  target[tree.id]={x,y:top+(tree.height-GRAPH_NODE_HEIGHT)/2};
  if(collectSlots)placed.add(tree.id);
  let y=top;
  tree.children.forEach((child,index)=>{
   placeTree(child,x+COLUMN,y,target,collectSlots);y+=child.height+GAP;
   for(const crossId of tree.gaps.get(index)||[]){
    if(collectSlots)slots.set(crossId,{x:x+COLUMN,y});
    y+=build(crossId).height+GAP;
   }
  });
 };
 if(visible.has(ROOT))placeTree(build(ROOT),0,0);
 // Preserve orphaned boards and malformed cycles as visible islands, never drop data.
 for(const note of data.notes){
  if(placed.has(note.id)||crossIds.has(note.parent||''))continue;
  const path=ancestry(note.id);if(path.some(id=>crossIds.has(id)))continue;
  const bottom=Math.max(0,...Object.values(positions).map(p=>p.y+GRAPH_NODE_HEIGHT));
  placeTree(build(note.id),0,bottom+GAP);
 }
 const overlaps=(a:GraphPosition,b:GraphPosition)=>Math.abs(a.x-b.x)<GRAPH_NODE_WIDTH+CLEARANCE&&Math.abs(a.y-b.y)<GRAPH_NODE_HEIGHT+CLEARANCE;
 const placeFreeTree=(id:string,x:number,y:number)=>{
  const local:Record<string,GraphPosition>={};placeTree(build(id),0,0,local,false);
  const root=local[id];
  const fits=(dx:number,dy:number)=>Object.entries(local).every(([node,p])=>positions[node]||Object.values(positions).every(q=>!overlaps({x:p.x+dx,y:p.y+dy},q)));
  const dx=x;let dy=y-root.y;
  // Search nearby vertical slots first; keep descendants on the right of the board.
  for(let distance=0;!fits(dx,dy);distance++){
   if(distance>projection.visibleIds.length*4){dy=Math.max(0,...Object.values(positions).map(p=>p.y+GRAPH_NODE_HEIGHT))+GAP;break;}
   const step=Math.ceil((distance+1)/2)*(GRAPH_NODE_HEIGHT+GAP);
   dy=y-root.y+(distance%2===0?step:-step);
  }
  for(const [node,p] of Object.entries(local))if(!positions[node]){positions[node]={x:p.x+dx,y:p.y+dy};placed.add(node);}
 };
 // Cards linked by ordinary links are positioned next to their earliest known anchor.
 for(const card of data.cards.filter(card=>visible.has(card.id))){
  const edge=projection.edges.find(edge=>edge.kind==='link'&&(edge.from===card.id&&positions[edge.to]||edge.to===card.id&&positions[edge.from]));
  const anchor=edge?positions[edge.from===card.id?edge.to:edge.from]:undefined;
  if(anchor)placeFreeTree(card.id,anchor.x+COLUMN,anchor.y);
 }
 // Crosses depending on other crosses wait until those anchors have positions.
 let pending=[...crosses];
 while(pending.length){
  const ready=pending.filter(cross=>cross.anchorIds.map(owner).every(id=>positions[id]||!crossIds.has(id)));
  const batch=ready.length?ready:[pending[0]];
  for(const cross of batch){
   const anchors=cross.anchorIds.map(owner).map(id=>positions[id]).filter(Boolean);
   const slot=slots.get(cross.id);
   const x=anchors.length?anchors.reduce((sum,p)=>sum+p.x,0)/anchors.length:COLUMN;
   const y=slot?slot.y+(build(cross.id).height-GRAPH_NODE_HEIGHT)/2:anchors.length?anchors.reduce((sum,p)=>sum+p.y,0)/anchors.length:0;
   placeFreeTree(cross.id,Math.max(COLUMN,x),y);
  }
  const done=new Set(batch.map(cross=>cross.id));pending=pending.filter(cross=>!done.has(cross.id));
 }
 for(const id of projection.visibleIds)if(!positions[id]){
  const edge=projection.edges.find(edge=>edge.from===id&&positions[edge.to]||edge.to===id&&positions[edge.from]);
  const anchor=edge?positions[edge.from===id?edge.to:edge.from]:undefined;
  placeFreeTree(id,anchor?anchor.x+COLUMN:COLUMN,anchor?.y||0);
 }
 return positions;
}
