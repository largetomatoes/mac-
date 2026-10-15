import type {LibraryBook,Notebook} from './notebook';
export type ReadingFilter='all'|'unfinished'|'finished';
export function isBookFinished(book:LibraryBook){return book.readingCompletion?.finished===true;}
export function matchesReadingStatus(book:LibraryBook,status:ReadingFilter){return status==='all'||isBookFinished(book)===(status==='finished');}
export function setBookFinished(data:Notebook,id:string,finished:boolean,at=new Date().toISOString()):Notebook{
 const book=data.libraryBooks.find(b=>b.id===id);if(!book)throw Error('这本书已变化，请重新选择。');
 if(isBookFinished(book)===finished)return data;
 if(!Number.isFinite(Date.parse(at)))throw Error('阅读完成时间无效。');
 return {...data,libraryBooks:data.libraryBooks.map(b=>b.id===id?{...b,readingCompletion:{finished,at}}:b)};
}
