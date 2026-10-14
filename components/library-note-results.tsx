'use client';
import {useState} from 'react';
import {noteSearchPreview,type LibraryNoteHit} from '@/lib/library-note-search';
import './library-note-search.css';
const kindLabel={process:'过程笔记',reading:'读书思考',zotero:'Zotero 摘录与批注'};
export function LibraryNoteResults({hits,query,onOpen}:{hits:LibraryNoteHit[];query:string;onOpen:(hit:LibraryNoteHit)=>void}){
 const [chapter,setChapter]=useState('');
 const chapters=[...new Map(hits.map(hit=>[hit.chapterKey,hit.chapter])).entries()];
 const effective=chapters.some(([key])=>key===chapter)?chapter:'';
 const visible=effective?hits.filter(hit=>hit.chapterKey===effective):hits;
 const groups=new Map<string,{title:string;chapters:Map<string,{title:string;hits:LibraryNoteHit[]}>}>();
 for(const hit of visible){if(!groups.has(hit.bookId))groups.set(hit.bookId,{title:hit.bookTitle,chapters:new Map()});const book=groups.get(hit.bookId)!;if(!book.chapters.has(hit.chapterKey))book.chapters.set(hit.chapterKey,{title:hit.chapter,hits:[]});book.chapters.get(hit.chapterKey)!.hits.push(hit);}
 return <section className="library-note-results" aria-label="笔记搜索结果"><header><strong>笔记 <small>{visible.length}</small></strong>{chapters.length>1&&<select aria-label="按章节筛选笔记搜索" value={effective} onChange={event=>setChapter(event.target.value)}><option value="">全部章节</option>{chapters.map(([key,title])=><option value={key} key={key}>{title}</option>)}</select>}</header>{[...groups].map(([id,book])=><div className="library-note-result-book" key={id}><h4>{book.title}</h4>{[...book.chapters].map(([key,group])=><div key={key}><h5>{group.title}</h5>{group.hits.map(hit=><button type="button" key={hit.key} onClick={()=>onOpen(hit)}><small>{kindLabel[hit.kind]}{hit.locator?' · '+hit.locator:''}</small><span>{noteSearchPreview(hit,query)}</span></button>)}</div>)}</div>)}</section>;
}
