import {processEntries} from './process-note-sources';
import type {BookThought, BookThoughtSource, LibraryBook, Notebook, ReadingNote} from './notebook';

export type BookNote = {kind:'process'; note:ReadingNote} | {kind:'reading'; note:BookThought; source?:BookThoughtSource};
export type ChapterNotes = {key:string; title:string; chapter:string; entries:BookNote[]};
export type BookNotes = {key:string; title:string; author:string; book?:LibraryBook; entries:BookNote[]};
const tidy=(value:string|undefined)=>(value||'').trim().replace(/\s+/g,' ');

// A stable book ID wins. Legacy notes are matched only when their source is unambiguous.
export function noteBook(entry:BookNote, books:LibraryBook[]):LibraryBook|undefined {
 const note=entry.kind==='reading'&&entry.source?entry.source:entry.note;
 if(note.libraryBookId)return books.find(book=>book.id===note.libraryBookId);
 const title=tidy(entry.kind==='process'?entry.note.book:(entry.source?.bookTitle||entry.note.bookTitle));
 const matches=books.filter(book=>tidy(book.title)===title&&(entry.kind!=='process'||!tidy(entry.note.author)||tidy(book.author)===tidy(entry.note.author)));
 return matches.length===1?matches[0]:undefined;
}
export function notebookBooks(data:Notebook):BookNotes[] {
 const groups=new Map<string,BookNotes>();
 const entries:BookNote[]=[...data.readingNotes.flatMap(processEntries).map(note=>({kind:'process' as const,note})),...data.bookThoughts.flatMap(note=>thoughtEntries(note))];
 for(const entry of entries){
  const book=noteBook(entry,data.libraryBooks),title=tidy(book?.title||(entry.kind==='process'?entry.note.book:(entry.source?.bookTitle||entry.note.bookTitle)))||'未填写书名',author=book?.author||(entry.kind==='process'?entry.note.author:'');
  const key=book?'book:'+book.id:(entry.kind==='reading'?entry.source?.libraryBookId||entry.note.libraryBookId:entry.note.libraryBookId)?'missing:'+(entry.kind==='reading'?entry.source?.libraryBookId||entry.note.libraryBookId:entry.note.libraryBookId):'source:'+JSON.stringify([title,tidy(author)]);
  if(!groups.has(key))groups.set(key,{key,title,author,book,entries:[]});
  groups.get(key)!.entries.push(entry);
 }
 return [...groups.values()].sort((a,b)=>Math.max(...b.entries.map(e=>Date.parse(e.note.at)||0))-Math.max(...a.entries.map(e=>Date.parse(e.note.at)||0)));
}
export function chapterNotes(entries:BookNote[], book?:LibraryBook):ChapterNotes[] {
 const groups=new Map<string,ChapterNotes>();
 const add=(chapter:string,key='chapter:'+chapter,title=chapter)=>{if(!groups.has(key))groups.set(key,{key,title,chapter,entries:[]});return groups.get(key)!;};
 // Saved PDF chapter boundaries are also available for new chapter-level thoughts.
 for(const chapter of [...(book?.pdfChapters||[])].sort((a,b)=>a.startPage-b.startPage))if(tidy(chapter.title))add(tidy(chapter.title));
 for(const entry of entries){
  const chapter=tidy(entry.kind==='reading'&&entry.source?entry.source.chapter:entry.note.chapter);
  const whole=!chapter&&entry.kind==='reading'&&entry.note.scope==='book';
  const group=chapter?add(chapter):add('',whole?'whole':'unfiled',whole?'全书思考':'未标章节');
  if(!group.entries.some(item=>item.kind===entry.kind&&item.note.id===entry.note.id))group.entries.push(entry);
 }
 const order=(book?.pdfChapters||[]).slice().sort((a,b)=>a.startPage-b.startPage).map(c=>tidy(c.title));
 return [...groups.values()].sort((a,b)=>{
  const rank=(g:ChapterNotes)=>g.key==='whole'?2:g.key==='unfiled'?1:0;
  if(rank(a)!==rank(b))return rank(a)-rank(b);
  const ai=order.indexOf(a.chapter),bi=order.indexOf(b.chapter);
  if(ai>=0||bi>=0)return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);
  return a.title.localeCompare(b.title,'zh-CN',{numeric:true});
 }).map(group=>({...group,entries:group.entries.slice().sort((a,b)=>a.note.at.localeCompare(b.note.at))}));
}
export function bookThoughtLocation(note:BookThought){return [note.chapter,note.locator].filter(Boolean).join(' · ')||(note.scope==='book'?'全书思考':'未标章节');}

export function thoughtSources(note:BookThought):BookThoughtSource[]{
 return note.sources?.length?note.sources:[{id:'legacy:'+note.id,libraryBookId:note.libraryBookId,bookTitle:note.bookTitle,chapter:note.chapter,locator:note.locator,sourceLocation:note.sourceLocation,quote:note.quote}];
}
export function thoughtEntries(note:BookThought):BookNote[]{return thoughtSources(note).map(source=>({kind:'reading' as const,note,source}));}
export function thoughtBookEntries(note:BookThought,bookId:string):BookNote[]{return thoughtEntries(note).filter(entry=>entry.kind==='reading'&&entry.source?.libraryBookId===bookId);}
export function sourceLabel(source:BookThoughtSource){return [source.bookTitle?`《${source.bookTitle}》`:'',source.chapter,source.locator].filter(Boolean).join(' · ');}
export function thoughtPrimary(note:BookThought,books:LibraryBook[]){return thoughtSources(note).find(source=>books.some(book=>book.id===source.libraryBookId));}
export function withThoughtSources(note:BookThought,sources:BookThoughtSource[]):BookThought{
 const first=sources[0];if(!first)throw Error('思考至少需要保留一个来源。');
 return {...note,sources,libraryBookId:first.libraryBookId,bookTitle:first.bookTitle,chapter:first.chapter,locator:first.locator,sourceLocation:first.sourceLocation,quote:first.quote};
}

export function addThoughtSource(existing:BookThoughtSource[],source:BookThoughtSource):BookThoughtSource[]{
 if(existing.some(item=>item.libraryBookId===source.libraryBookId&&item.sourceLocation===source.sourceLocation&&item.quote===source.quote&&item.readingNoteId===source.readingNoteId&&item.bookThoughtId===source.bookThoughtId))return existing;
 const candidates=existing.map((item,index)=>({item,index})).filter(({item})=>item.libraryBookId===source.libraryBookId&&!item.quote&&!item.readingNoteId&&!item.bookThoughtId);
 const exact=candidates.find(({item})=>item.sourceLocation===source.sourceLocation),placeholder=exact?.index??(candidates.length===1?candidates[0].index:-1);
 if(placeholder<0)return [...existing,source];
 return existing.map((item,index)=>index===placeholder?source:item);
}
