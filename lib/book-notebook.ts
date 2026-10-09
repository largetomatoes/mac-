import type {BookThought, LibraryBook, Notebook, ReadingNote} from './notebook';

export type BookNote = {kind:'process'; note:ReadingNote} | {kind:'reading'; note:BookThought};
export type ChapterNotes = {key:string; title:string; chapter:string; entries:BookNote[]};
export type BookNotes = {key:string; title:string; author:string; book?:LibraryBook; entries:BookNote[]};
const tidy=(value:string|undefined)=>(value||'').trim().replace(/\s+/g,' ');

// A stable book ID wins. Legacy notes are matched only when their source is unambiguous.
export function noteBook(entry:BookNote, books:LibraryBook[]):LibraryBook|undefined {
 const note=entry.note;
 if(note.libraryBookId)return books.find(book=>book.id===note.libraryBookId);
 const title=tidy(entry.kind==='process'?entry.note.book:entry.note.bookTitle);
 const matches=books.filter(book=>tidy(book.title)===title&&(entry.kind!=='process'||!tidy(entry.note.author)||tidy(book.author)===tidy(entry.note.author)));
 return matches.length===1?matches[0]:undefined;
}
export function notebookBooks(data:Notebook):BookNotes[] {
 const groups=new Map<string,BookNotes>();
 const entries:BookNote[]=[...data.readingNotes.map(note=>({kind:'process' as const,note})),...data.bookThoughts.map(note=>({kind:'reading' as const,note}))];
 for(const entry of entries){
  const book=noteBook(entry,data.libraryBooks),title=tidy(book?.title||(entry.kind==='process'?entry.note.book:entry.note.bookTitle))||'未填写书名',author=book?.author||(entry.kind==='process'?entry.note.author:'');
  const key=book?'book:'+book.id:entry.note.libraryBookId?'missing:'+entry.note.libraryBookId:'source:'+JSON.stringify([title,tidy(author)]);
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
  const chapter=tidy(entry.note.chapter);
  const whole=!chapter&&entry.kind==='reading'&&entry.note.scope==='book';
  const group=chapter?add(chapter):add('',whole?'whole':'unfiled',whole?'全书思考':'未标章节');
  group.entries.push(entry);
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
