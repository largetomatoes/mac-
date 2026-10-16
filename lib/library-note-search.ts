import {processEntries,processSources} from './process-note-sources';
import {displayBook,visibleZoteroAnnotations,type Notebook,type LibraryBook,type ZoteroAnnotation} from './notebook';
import {noteBook,thoughtEntries,type BookNote} from './book-notebook';

export type LibraryNoteHit={key:string;kind:'process'|'reading'|'zotero';id:string;bookId:string;bookTitle:string;chapter:string;chapterKey:string;locator:string;sourceLocation?:string;content:string;preview:string};
const tidy=(text:string|undefined)=>(text||'').trim().replace(/\s+/g,' ');
const normalize=(text:string)=>text.normalize('NFKC').toLocaleLowerCase();
export function matchesNoteText(content:string,query:string){return normalize(tidy(query)).split(/\s+/).filter(Boolean).every(word=>normalize(content).includes(word));}
export function zoteroAnnotationChapter(book:LibraryBook,annotation:ZoteroAnnotation){
 let page=annotation.page;
 if(!page)try{const position=JSON.parse(annotation.position||'{}');if(Number.isInteger(position.pageIndex))page=position.pageIndex+1;}catch{/* An original annotation may lack a page position. */}
 return book.format==='pdf'&&page?(book.pdfChapters||[]).filter(c=>c.startPage<=page!).sort((a,b)=>b.startPage-a.startPage)[0]?.title.trim()||'':'';
}
export function bookNoteContent(entry:BookNote,replies:Map<string,string>=new Map()){
 const note=entry.note,source=entry.kind==='reading'?entry.source:undefined;
 return [entry.kind==='process'?entry.note.interpretation:entry.note.text,entry.kind==='process'?processSources(entry.note).filter(s=>s.libraryBookId===entry.note.libraryBookId&&(s.chapter||'')===entry.note.chapter).map(s=>s.quote).join('\n'):source?.quote||note.quote,source?.noteText,entry.kind==='process'?note.chapter:source?.chapter||note.chapter,entry.kind==='process'?note.locator:source?.locator||note.locator,...(note.thoughts||[]).flatMap(t=>[t.text,t.reason,replies.get(t.id)])].filter(Boolean).join('\n');
}
export function libraryNoteIndex(data:Notebook):LibraryNoteHit[]{
 const hits:LibraryNoteHit[]=[],replies=new Map<string,string>();
 for(const reply of data.thoughtReplies)replies.set(reply.thoughtId,(replies.get(reply.thoughtId)||'')+'\n'+reply.text);
 const add=(entry:BookNote)=>{
  const book=noteBook(entry,data.libraryBooks);if(!book)return;
  const shown=displayBook(book),source=entry.kind==='reading'?entry.source:undefined,chapter=tidy(source?.chapter||entry.note.chapter),whole=entry.kind==='reading'&&!chapter&&entry.note.scope==='book';
  const chapterKey=chapter?'chapter:'+chapter:whole?'whole':'unfiled';
  const content=bookNoteContent(entry,replies),preview=entry.kind==='process'?entry.note.interpretation||entry.note.quote:entry.note.text;
  hits.push({key:JSON.stringify([book.id,entry.kind,entry.note.id,chapterKey]),kind:entry.kind,id:entry.note.id,bookId:book.id,bookTitle:shown.title,chapter:chapter|| (whole?'全书思考':'未标章节'),chapterKey,locator:source?.locator||entry.note.locator,sourceLocation:source?.sourceLocation||entry.note.sourceLocation,content,preview:tidy(preview)});
 };
 for(const note of data.readingNotes.flatMap(processEntries))add({kind:'process',note});
 for(const note of data.bookThoughts)for(const entry of thoughtEntries(note))add(entry);
 for(const book of data.libraryBooks)for(const annotation of visibleZoteroAnnotations(book)){
  const chapter=zoteroAnnotationChapter(book,annotation);
  hits.push({key:JSON.stringify([book.id,'zotero',annotation.attachmentKey,annotation.key]),kind:'zotero',id:annotation.key,bookId:book.id,bookTitle:displayBook(book).title,chapter:chapter||'未标章节',chapterKey:chapter?'chapter:'+chapter:'unfiled',locator:annotation.pageLabel?'第 '+annotation.pageLabel+' 页':annotation.page?'第 '+annotation.page+' 页':'',content:[annotation.text,annotation.comment,chapter].join('\n'),preview:tidy(annotation.comment||annotation.text)});
 }
 const unique=new Map<string,LibraryNoteHit>();for(const hit of hits)if(!unique.has(hit.key))unique.set(hit.key,hit);
 return [...unique.values()];
}
export function searchLibraryNotes(index:LibraryNoteHit[],query:string,bookIds:Set<string>,chapterKey=''){
 if(!query.trim())return [];
 return index.filter(hit=>bookIds.has(hit.bookId)&&(!chapterKey||hit.chapterKey===chapterKey)&&matchesNoteText(hit.content,query));
}
export function noteSearchPreview(hit:LibraryNoteHit,query:string){
 const text=tidy(hit.content),first=normalize(tidy(query)).split(/\s+/).find(Boolean)||'',at=normalize(text).indexOf(first);
 if(at<0)return hit.preview.slice(0,130);
 const start=Math.max(0,at-32),end=Math.min(text.length,at+first.length+85);return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
