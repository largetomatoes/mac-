'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {MessageSquareText} from 'lucide-react';
import type {ReadingNote} from '@/lib/notebook';
import {groupNoteAnchors} from '@/lib/reader-text';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
function NoteMarker({items,y,onOpen}:{items:ReadingNote[];y:number;onOpen:()=>void}){
 const button=useRef<HTMLButtonElement>(null),[show,setShow]=useState(false),[position,setPosition]=useState<CSSProperties>({});
 useEffect(()=>{
  if(!show)return;
  const place=()=>{const element=button.current;if(!element)return;
   const marker=element.getBoundingClientRect(),stage=element.closest('.pdf-stage,.epub-reader-stage')?.getBoundingClientRect();
   const left=Math.max(8,stage?.left??8),right=Math.min(window.innerWidth-8,stage?.right??window.innerWidth-8),top=Math.max(8,stage?.top??8),bottom=Math.min(window.innerHeight-8,stage?.bottom??window.innerHeight-8);
   const width=Math.min(340,right-left-24),maxHeight=Math.max(60,Math.min(380,bottom-top-24));
   setPosition({width,maxHeight,left:Math.max(left+12,Math.min(right-width-12,marker.left-width-8))-marker.left,top:Math.max(top+12,Math.min(marker.top,bottom-maxHeight-12))-marker.top});
  };
  place();window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
  return()=>{window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);};
 },[show]);
 return <button ref={button} type="button" className="process-group-marker" style={{top:y}} aria-label={`查看 ${items.length} 条过程笔记`} onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)} onFocus={()=>setShow(true)} onBlur={()=>setShow(false)} onClick={()=>{setShow(false);onOpen();}}>
  <MessageSquareText/>{items.length>1&&<b>{items.length}</b>}
  {show&&<span className="process-group-preview" style={position} role="tooltip" onWheel={event=>event.stopPropagation()}>
   {items.slice(0,3).map(note=><span className="process-preview-entry" key={note.id}><span className="process-preview-quote">{note.quote}</span><span className="process-preview-comment">{note.interpretation}</span></span>)}
   {items.length>3&&<small>点击查看全部 {items.length} 条</small>}
  </span>}
 </button>;
}
export function ProcessNoteRail({entries,height,onLink,onSource}:{entries:Array<{item:ReadingNote;y:number}>;height:number;onLink:(note:ReadingNote)=>void;onSource:(note:ReadingNote)=>void}){
 const [ids,setIds]=useState<string[]>([]);
 const notes=entries.filter(entry=>ids.includes(entry.item.id)).map(entry=>entry.item);
 return <><div className="process-note-rail" aria-label="本页过程笔记">{groupNoteAnchors(entries,height).map(group=><NoteMarker key={group.items.map(n=>n.id).join(':')} items={group.items} y={group.y} onOpen={()=>setIds(group.items.map(n=>n.id))}/>)}</div><Dialog open={notes.length>0} onOpenChange={open=>{if(!open)setIds([]);}}><DialogContent className="process-group-dialog"><DialogTitle>过程笔记 · {notes.length}</DialogTitle><DialogDescription>同一位置的注解分别保留。</DialogDescription><div className="process-group-list">{notes.map(note=><article key={note.id}><small>{[note.chapter,note.locator].filter(Boolean).join(' · ')} · {new Date(note.at).toLocaleString('zh-CN')}</small><blockquote>{note.quote}</blockquote><p>{note.interpretation}</p><footer><button onClick={()=>onLink(note)}>关联问题{note.questionIds.length?` · ${note.questionIds.length}`:''}</button><button onClick={()=>{setIds([]);onSource(note);}}>回到原文</button></footer></article>)}</div></DialogContent></Dialog></>;
}
