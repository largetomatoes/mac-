'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {ChevronRight,Plus} from 'lucide-react';
import type {BookNote,ChapterNotes} from '@/lib/book-notebook';
import './chapter-notes.css';

function Chapter({group,renderNote,onAdd,focusId,expandKey}:{group:ChapterNotes;renderNote:(entry:BookNote)=>ReactNode;onAdd?:(chapter:string)=>void;focusId?:string|null;expandKey?:string}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(focusId&&group.entries.some(entry=>entry.note.id===focusId))setOpen(true);},[focusId,group.key]);
 useEffect(()=>{if(expandKey)setOpen(true);},[expandKey]);
 return <details className="chapter-note-group" open={open} onToggle={event=>setOpen(event.currentTarget.open)} data-chapter={group.title}><summary><ChevronRight size={16}/><strong>{group.title}</strong><span>{group.entries.length}</span></summary><div className="chapter-note-body">{onAdd&&group.key!=='unfiled'&&<button className="chapter-add-note" type="button" onClick={()=>onAdd(group.chapter)}><Plus size={14}/>在{group.key==='whole'?'全书':'本章'}写思考</button>}{group.entries.map(renderNote)}{!group.entries.length&&<p className="chapter-empty">这一章还没有笔记。</p>}</div></details>;
}
export function ChapterNoteSections({groups,renderNote,onAdd,focusId,expandKey}:{groups:ChapterNotes[];renderNote:(entry:BookNote)=>ReactNode;onAdd?:(chapter:string)=>void;focusId?:string|null;expandKey?:string}){
 return <div className="chapter-note-sections">{groups.map(group=><Chapter key={group.key} group={group} renderNote={renderNote} onAdd={onAdd} focusId={focusId} expandKey={expandKey}/>)}{!groups.length&&<p className="chapter-empty">还没有笔记，可以先留下一个想法。</p>}</div>;
}
