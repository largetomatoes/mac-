'use client';

import {useMemo,useState} from 'react';
import {Archive,BookOpen,FileText,Lightbulb,Network,Search} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {type Notebook,crossNumber,numberOf,ROOT} from '@/lib/notebook';

type SearchResult={id:string;kind:'note'|'cross'|'card'|'reading'|'manuscript'|'book';label:string;title:string;text:string;open:()=>void};
type Props={open:boolean;onOpenChange:(open:boolean)=>void;data:Notebook;onOpenItem:(id:string)=>void;onOpenReading:(id:string)=>void;onOpenManuscript:(id:string)=>void;onOpenBook:(id:string,location?:string)=>void};
const plain=(value:string)=>value.toLocaleLowerCase('zh-CN').replace(/\s+/g,' ');
const clip=(value:string,length=150)=>value.length>length?value.slice(0,length)+'…':value;

export function GlobalSearch({open,onOpenChange,data,onOpenItem,onOpenReading,onOpenManuscript,onOpenBook}:Props){
 const [query,setQuery]=useState('');
 const results=useMemo(()=>{const q=plain(query.trim());if(!q)return [] as SearchResult[];const has=(...values:string[])=>plain(values.join(' ')).includes(q);const items:SearchResult[]=[];
  const thoughtText=(thoughts:{id:string;text:string}[])=>thoughts.flatMap(thought=>[thought.text,data.thoughtReplies.find(reply=>reply.thoughtId===thought.id)?.text||'']);
  for(const note of data.notes){const thoughts=thoughtText(note.thoughts||[]);if(has(note.title,note.body,...thoughts))items.push({id:note.id,kind:'note',label:note.id===ROOT?'核心问题':note.kind==='question'?`${numberOf(note,data.notes,data.crossThoughts)} · 问题`:'回答',title:note.title,text:clip([note.body,...thoughts].filter(Boolean).join(' · ')),open:()=>onOpenItem(note.id)});}
  for(const cross of data.crossThoughts){const thoughts=thoughtText(cross.thoughts);if(has(cross.title||'',cross.text,...thoughts))items.push({id:cross.id,kind:'cross',label:`${crossNumber(cross)} · 交叉思考`,title:cross.title||'交叉思考',text:clip([cross.text,...thoughts].filter(Boolean).join(' · ')),open:()=>onOpenItem(cross.id)});}
  for(const card of data.cards){const thoughts=thoughtText(card.thoughts);if(has(card.text,card.source,...thoughts))items.push({id:card.id,kind:'card',label:'卡片集',title:clip(card.text,70),text:clip([card.source,...thoughts].filter(Boolean).join(' · ')),open:()=>onOpenItem(card.id)});}
  for(const reading of data.readingNotes){const thoughts=thoughtText(reading.thoughts);if(has(reading.book,reading.author,reading.chapter,reading.locator,reading.quote,reading.interpretation,...thoughts))items.push({id:reading.id,kind:'reading',label:`阅读笔记 · ${reading.chapter||reading.locator||'原文'}`,title:`《${reading.book}》`,text:clip(`${reading.quote} · ${reading.interpretation} · ${thoughts.join(' · ')}`),open:()=>onOpenReading(reading.id)});}
  for(const manuscript of data.manuscripts){if(has(manuscript.title,manuscript.body))items.push({id:manuscript.id,kind:'manuscript',label:'文稿',title:manuscript.title,text:clip(manuscript.body),open:()=>onOpenManuscript(manuscript.id)});}
  for(const book of data.libraryBooks){const highlight=data.libraryHighlights.find(item=>item.libraryBookId===book.id&&has(item.quote)),cache=data.ocrCache.find(item=>item.libraryBookId===book.id&&has(item.text));if(has(book.title,book.author,book.originalName)||highlight||cache)items.push({id:book.id,kind:'book',label:highlight?'原文高亮':cache?`OCR · 第 ${cache.page} 页`:book.format.toUpperCase(),title:book.title,text:clip(highlight?.quote||cache?.text||book.author||book.originalName),open:()=>onOpenBook(book.id,highlight?.sourceLocation||(cache?`pdf:${cache.page}`:undefined))});}
  return items.slice(0,80);},[query,data,onOpenItem,onOpenReading,onOpenManuscript,onOpenBook]);
 const icons={note:Lightbulb,cross:Network,card:Archive,reading:BookOpen,manuscript:FileText,book:BookOpen};
 function choose(result:SearchResult){onOpenChange(false);setQuery('');result.open();}
 return <Dialog open={open} onOpenChange={value=>{onOpenChange(value);if(!value)setQuery('');}}><DialogContent className="search-dialog"><DialogTitle>搜索全部内容</DialogTitle><DialogDescription>问题、思考、卡片、阅读笔记、文稿和书籍</DialogDescription><div className="search-input-wrap"><Search/><Input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入词语…"/></div><div className="search-results">{results.map(result=>{const Icon=icons[result.kind];return <button type="button" key={`${result.kind}:${result.id}`} onClick={()=>choose(result)}><Icon/><span><small>{result.label}</small><strong>{result.title}</strong>{result.text&&<p>{result.text}</p>}</span></button>;})}{query.trim()&&!results.length&&<p className="search-empty">没有找到相关内容</p>}{!query.trim()&&<p className="search-empty">开始输入即可查找</p>}</div></DialogContent></Dialog>;
}
