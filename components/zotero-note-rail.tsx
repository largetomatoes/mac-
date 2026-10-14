'use client';
import type {ZoteroAnnotation} from '@/lib/notebook';
// Place source controls in the page margin; the highlight itself never receives input.
export function ZoteroNoteRail({anchors,annotations,onOpen}:{anchors:Array<{key:string;top:number;height:number}>;annotations:ZoteroAnnotation[];onOpen:(key:string)=>void}){
 const seen=new Set<string>(),groups:Array<{y:number;keys:string[]}>=[];
 for(const rect of [...anchors].sort((a,b)=>a.top-b.top)){
  if(seen.has(rect.key))continue;seen.add(rect.key);const y=rect.top+rect.height/2,last=groups.at(-1);
  if(last&&y-last.y<30)last.keys.push(rect.key);else groups.push({y,keys:[rect.key]});
 }
 return <div className="zotero-note-rail" aria-label="本页 Zotero 来源批注">{groups.map(group=><button key={group.keys.join(':')} type="button" style={{top:group.y}} aria-label={`查看 ${group.keys.length} 条 Zotero 来源批注`} title={group.keys.map(key=>{const annotation=annotations.find(a=>a.key===key);return [annotation?.text,annotation?.comment].filter(Boolean).join('\n');}).join('\n\n')} onClick={()=>onOpen(group.keys[0])}>Z{group.keys.length>1&&<small>{group.keys.length}</small>}</button>)}</div>;
}
