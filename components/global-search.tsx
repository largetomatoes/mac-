'use client';

import {useDeferredValue,useEffect,useMemo,useState} from 'react';
import {Archive,BookOpen,FileText,Lightbulb,Network,Search} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {type Notebook,type Thought,crossNumber,crossSignature,numberOf,ROOT} from '@/lib/notebook';
import {indexedField,rankSearch,type SearchDocument,type SearchHit} from '@/lib/search-ranking';

type Kind='note'|'cross'|'card'|'reading'|'bookThought'|'manuscript'|'book';
type SearchResult=SearchDocument&{kind:Kind;open:()=>void};
type Props={
 open:boolean;
 onOpenChange:(open:boolean)=>void;
 data:Notebook;
 onOpenItem:(id:string,thoughtId?:string,replyId?:string)=>void;
 onOpenReading:(id:string,thoughtId?:string)=>void;
 onOpenManuscript:(id:string)=>void;
 onOpenBook:(id:string,location?:string,bookThoughtId?:string)=>void;
 onOpenDetachedBookThought:(id:string)=>void;
};
const short=(value:string,length=90)=>value.length>length?value.slice(0,length)+'…':value;
const place=(...parts:(string|undefined)[])=>parts.filter(Boolean).join(' · ');
const field=indexedField;

export function GlobalSearch({open,onOpenChange,data,onOpenItem,onOpenReading,onOpenManuscript,onOpenBook,onOpenDetachedBookThought}:Props){
 const [query,setQuery]=useState('');
 const deferredQuery=useDeferredValue(query);
 const [ocrMatches,setOcrMatches]=useState<{query:string;source:Notebook['ocrCache']|null;items:SearchHit<SearchResult>[]}>({query:'',source:null,items:[]});
 const documents=useMemo(()=>{
  const items:SearchResult[]=[];
  const replies=new Map(data.thoughtReplies.map(reply=>[reply.thoughtId,reply]));
  const noteById=new Map(data.notes.map(note=>[note.id,note]));
  const bookById=new Map(data.libraryBooks.map(book=>[book.id,book]));
  const connectionCounts=new Map<string,number>();
  for(const link of data.links){connectionCounts.set(link.from,(connectionCounts.get(link.from)||0)+1);connectionCounts.set(link.to,(connectionCounts.get(link.to)||0)+1);}
  const add=(result:SearchResult)=>items.push(result);
  const addThoughts=(ownerKey:string,kind:Kind,ownerLabel:string,ownerTitle:string,thoughts:Thought[],openThought:(thoughtId:string,replyId?:string)=>void)=>{
   for(const thought of thoughts){
    add({id:`${ownerKey}:thought:${thought.id}`,kind,label:place(ownerLabel,'后来想到的'),title:ownerTitle,fields:[field(thought.text,1.1),field(thought.reason),field(thought.origin,.35,false)],open:()=>openThought(thought.id)});
    const reply=replies.get(thought.id);
    if(reply)add({id:`${ownerKey}:reply:${reply.id}`,kind,label:place(ownerLabel,'我的回答'),title:ownerTitle,fields:[field(reply.text,1.1),field(thought.text,.3,false)],open:()=>openThought(thought.id,reply.id)});
   }
  };

  for(const note of data.notes){
   const parent=note.parent?noteById.get(note.parent):undefined;
   const number=note.id===ROOT?'核心问题':note.kind==='question'?`${numberOf(note,data.notes,data.crossThoughts)} · 问题`:place('回答',parent?short(parent.title,45):undefined);
   add({id:`note:${note.id}`,kind:'note',label:number,title:note.title,fields:[field(note.title,1.2),field(note.body),field(note.source,.6)],open:()=>onOpenItem(note.id)});
   addThoughts(`note:${note.id}`,'note',number,note.title,note.thoughts||[],(thoughtId,replyId)=>onOpenItem(note.id,thoughtId,replyId));
   note.revisions.forEach((revision,index)=>add({id:`note:${note.id}:revision:${index}`,kind:'note',label:place(number,'过往修订'),title:revision.title||note.title,fields:[field(revision.title),field(revision.body),field(revision.reason)],open:()=>onOpenItem(note.id)}));
  }
  for(const cross of data.crossThoughts){
   const label=place(`${crossNumber(cross)} · 交叉思考`,short(crossSignature(cross,data),65));
   const title=cross.title||short(cross.text,80)||'交叉思考';
   add({id:`cross:${cross.id}`,kind:'cross',label,title,fields:[field(cross.title||'',1.2),field(cross.text),field(cross.source,.6)],open:()=>onOpenItem(cross.id)});
   addThoughts(`cross:${cross.id}`,'cross',label,title,cross.thoughts,(thoughtId,replyId)=>onOpenItem(cross.id,thoughtId,replyId));
  }
  for(const card of data.cards){
   const connections=connectionCounts.get(card.id)||0;
   const label=place('卡片集',connections?`关联 ${connections} 处`:undefined,card.source?short(card.source,50):undefined);
   const title=short(card.text,80);
   add({id:`card:${card.id}`,kind:'card',label,title,fields:[field(card.text,1.1),field(card.source,.8)],open:()=>onOpenItem(card.id)});
   addThoughts(`card:${card.id}`,'card',label,title,card.thoughts,(thoughtId,replyId)=>onOpenItem(card.id,thoughtId,replyId));
  }
  for(const reading of data.readingNotes){
   const label=place('过程笔记',reading.book,reading.chapter||reading.locator);
   const title=`《${reading.book}》`;
   add({id:`reading:${reading.id}`,kind:'reading',label,title,fields:[field(reading.interpretation,1.15),field(reading.quote),field(place(reading.book,reading.author,reading.chapter,reading.locator),.65)],open:()=>onOpenReading(reading.id)});
   addThoughts(`reading:${reading.id}`,'reading',label,title,reading.thoughts,thoughtId=>onOpenReading(reading.id,thoughtId));
  }
  for(const entry of data.bookThoughts){
   const label=place(entry.libraryBookId?'读书笔记':'已移除书籍的读书笔记',entry.bookTitle,entry.chapter||entry.locator||'全书');
   const title=`《${entry.bookTitle}》`;
   const openEntry=()=>entry.libraryBookId?onOpenBook(entry.libraryBookId,entry.sourceLocation,entry.id):onOpenDetachedBookThought(entry.id);
   add({id:`bookThought:${entry.id}`,kind:'bookThought',label,title,fields:[field(entry.text,1.15),field(entry.quote||''),field(place(entry.bookTitle,entry.chapter,entry.locator),.65)],open:openEntry});
   addThoughts(`bookThought:${entry.id}`,'bookThought',label,title,entry.thoughts,()=>openEntry());
  }
  for(const manuscript of data.manuscripts){
   add({id:`manuscript:${manuscript.id}`,kind:'manuscript',label:'文稿',title:manuscript.title,fields:[field(manuscript.title,1.2),field(manuscript.body)],open:()=>onOpenManuscript(manuscript.id)});
  }
  for(const book of data.libraryBooks){
   add({id:`book:${book.id}`,kind:'book',label:book.format.toUpperCase(),title:book.title,fields:[field(book.title,1.2),field(book.author),field(book.originalName,.8)],open:()=>onOpenBook(book.id)});
  }
  for(const highlight of data.libraryHighlights){
   const book=bookById.get(highlight.libraryBookId);
   if(!book)continue;
   add({id:`highlight:${highlight.id}`,kind:'book',label:place('原文高亮',book.title,highlight.locator),title:`《${book.title}》`,fields:[field(highlight.quote,1.1)],open:()=>onOpenBook(book.id,highlight.sourceLocation)});
  }
  return items;
 },[data,onOpenItem,onOpenReading,onOpenManuscript,onOpenBook,onOpenDetachedBookThought]);
 useEffect(()=>{
  const terms=deferredQuery.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  if(!open||!terms.length||terms.join('').length<2||!data.ocrCache.length)return;
  const books=new Map(data.libraryBooks.map(book=>[book.id,book]));
  const perBook=new Map<string,number>();
  const matches:SearchHit<SearchResult>[]=[];
  let index=0,cancelled=false,timer=0;
  const scan=()=>{
   const started=performance.now();
   while(index<data.ocrCache.length&&matches.length<12&&performance.now()-started<8){
    const entry=data.ocrCache[index++],book=books.get(entry.libraryBookId);
    if(!book||(perBook.get(book.id)||0)>=3)continue;
    const lower=entry.text.toLocaleLowerCase('zh-CN');
    const positions=terms.map(term=>lower.indexOf(term));
    if(positions.some(position=>position<0))continue;
    const at=Math.min(...positions),start=Math.max(0,at-40),end=Math.min(entry.text.length,start+170);
    const excerpt=`${start?'…':''}${entry.text.slice(start,end).replace(/\s+/g,' ').trim()}${end<entry.text.length?'…':''}`;
    perBook.set(book.id,(perBook.get(book.id)||0)+1);
    matches.push({id:`ocr:${book.id}:${entry.page}`,kind:'book',label:place('OCR 原文',book.title,`第 ${entry.page} 页`),title:`《${book.title}》`,fields:[],score:40,excerpt,open:()=>onOpenBook(book.id,`pdf:${entry.page}`)});
   }
   if(!cancelled){
    if(index<data.ocrCache.length&&matches.length<12)timer=window.setTimeout(scan,0);
    else setOcrMatches({query:deferredQuery,source:data.ocrCache,items:matches});
   }
  };
  timer=window.setTimeout(scan,180);
  return()=>{cancelled=true;window.clearTimeout(timer);};
 },[open,deferredQuery,data.ocrCache,data.libraryBooks,onOpenBook]);
 const results=useMemo(()=>[...rankSearch(documents,deferredQuery,68),...(open&&ocrMatches.query===deferredQuery&&ocrMatches.source===data.ocrCache?ocrMatches.items:[])].slice(0,80),[documents,deferredQuery,open,ocrMatches,data.ocrCache]);
 const icons={note:Lightbulb,cross:Network,card:Archive,reading:BookOpen,bookThought:Lightbulb,manuscript:FileText,book:BookOpen};
 function choose(result:SearchResult){onOpenChange(false);setQuery('');result.open();}
 return <Dialog open={open} onOpenChange={value=>{onOpenChange(value);if(!value)setQuery('');}}><DialogContent className="search-dialog"><DialogTitle>搜索全部内容</DialogTitle><DialogDescription>按记得的词语或大意寻找思考、笔记和书籍</DialogDescription><div className="search-input-wrap"><Search/><Input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="试试一个想法的大意…"/></div><div className="search-results">{results.map(result=>{const Icon=icons[result.kind];return <button type="button" key={result.id} onClick={()=>choose(result)}><Icon/><span><small>{result.label}</small><strong>{result.title}</strong>{result.excerpt&&<p>{result.excerpt}</p>}</span></button>;})}{query.trim()&&!results.length&&<p className="search-empty">没有找到相关内容，可以换一两个关键词试试</p>}{!query.trim()&&<p className="search-empty">输入记得的词语或想法大意</p>}</div></DialogContent></Dialog>;
}
