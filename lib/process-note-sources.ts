import type {BookThoughtSource,ReadingNote,LibraryBook} from './notebook';
export function processSources(note:ReadingNote):BookThoughtSource[]{
 return note.sources?.length?note.sources:[{id:'legacy:'+note.id,libraryBookId:note.libraryBookId,bookTitle:note.book,author:note.author,chapter:note.chapter,locator:note.locator,sourceLocation:note.sourceLocation,quote:note.quote,rawQuote:note.rawQuote,anchorY:note.anchorY}];
}
// Project a source for navigation without creating another editable note.
export function processEntries(note:ReadingNote):ReadingNote[]{return processSources(note).map(source=>({...note,sourceId:source.id,libraryBookId:source.libraryBookId,book:source.bookTitle,author:source.author||'',chapter:source.chapter||'',locator:source.locator,sourceLocation:source.sourceLocation,quote:source.quote||'',rawQuote:source.rawQuote,anchorY:source.anchorY}));}
export function processNotesForBook(notes:ReadingNote[],bookId:string,books:LibraryBook[]):ReadingNote[]{return notes.flatMap(processEntries).filter(note=>{if(note.libraryBookId)return note.libraryBookId===bookId;const matches=books.filter(book=>book.title.trim()===note.book.trim()&&(!note.author.trim()||book.author?.trim()===note.author.trim()));return matches.length===1&&matches[0].id===bookId;});}
export function rememberSourceChapters(books:LibraryBook[],sources:BookThoughtSource[]):LibraryBook[]{
 return books.map(book=>{let chapters=book.pdfChapters||[];for(const source of sources){if(source.libraryBookId!==book.id||!source.sourceLocation?.startsWith('pdf:')||!source.chapter?.trim())continue;const page=Number(source.sourceLocation.slice(4));if(!Number.isInteger(page)||page<1)continue;const title=source.chapter.trim();if(chapters.some(c=>c.startPage===page&&c.title===title))continue;chapters=[...chapters.filter(c=>c.startPage!==page),{id:crypto.randomUUID(),title,startPage:page}];}return chapters===book.pdfChapters||!chapters.length?book:{...book,pdfChapters:chapters.sort((a,b)=>a.startPage-b.startPage)};});
}
export function createProcessNote(sources:BookThoughtSource[],text:string,questionIds:string[],at=new Date().toISOString()):ReadingNote{
 if(!sources.length||sources.some(s=>!s.quote?.trim()||!s.libraryBookId||!s.sourceLocation))throw Error('请保留每一段选文及其原文位置。');
 if(!text.trim())throw Error('请写下自己的过程笔记。');
 const first=sources[0];return {id:crypto.randomUUID(),libraryBookId:first.libraryBookId,book:first.bookTitle,author:first.author||'',chapter:first.chapter||'',locator:first.locator,sourceLocation:first.sourceLocation,quote:first.quote!,rawQuote:first.rawQuote,anchorY:first.anchorY,sources:sources.map(s=>({...s})),interpretation:text.trim(),questionIds:[...new Set(questionIds)],at,thoughts:[]};
}
