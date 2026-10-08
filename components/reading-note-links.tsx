'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {type Notebook,type ReadingNote,numberOf,crossNumber} from '@/lib/notebook';
export function ReadingNoteLinks({note,data,saving,save,onClose}:{note:ReadingNote;data:Notebook;saving:boolean;save:(data:Notebook,message:string)=>Promise<boolean>;onClose:()=>void}){
 const [ids,setIds]=useState(note.questionIds),[query,setQuery]=useState(''),[error,setError]=useState('');
 const locations=[...data.notes.filter(n=>n.kind==='question').map(n=>({id:n.id,label:`${n.parent?numberOf(n,data.notes,data.crossThoughts):'核心问题'} · ${n.title}`})),...data.crossThoughts.map(c=>({id:c.id,label:`${crossNumber(c)} · ${c.title||c.text||'交叉思考'}`}))];
 async function commit(){setError('');const valid=new Set(locations.map(n=>n.id));if(await save({...data,readingNotes:data.readingNotes.map(n=>n.id===note.id?{...n,questionIds:ids.filter(id=>valid.has(id))}:n)},'过程笔记的关联已更新'))onClose();else setError('关联未保存，请重试。');}
 return <Dialog open onOpenChange={open=>{if(!open&&!saving)onClose();}}><DialogContent className="reading-links-dialog"><DialogTitle>关联问题</DialogTitle><DialogDescription>同一条过程笔记会出现在选中的问题中，原文仍留在书里。</DialogDescription><Input aria-label="查找关联问题" placeholder="查找问题…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="reading-links-options">{locations.filter(n=>n.label.toLowerCase().includes(query.toLowerCase())).map(n=><label key={n.id}><input type="checkbox" checked={ids.includes(n.id)} onChange={()=>setIds(current=>current.includes(n.id)?current.filter(id=>id!==n.id):[...current,n.id])}/><span>{n.label}</span></label>)}</div>{error&&<p role="alert">{error}</p>}<footer><Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button><Button disabled={saving} onClick={commit}>{saving?'保存中…':'保存关联'}</Button></footer></DialogContent></Dialog>;
}
