import type {LibraryBook} from './notebook';
type ReaderPlatform={fileUrl:(book:LibraryBook)=>Promise<string>;mobile:boolean};
let platform:ReaderPlatform|null=null;
export function setReaderPlatform(value:ReaderPlatform){platform=value;}
export function isMobileReader(){return platform?.mobile===true;}
export async function readerFileUrl(book:LibraryBook){if(platform)return platform.fileUrl(book);
 if(book.cloudFile){const status=await fetch('/api/sync/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status',id:book.id})});const result=await status.json() as {available?:boolean;error?:string};if(!status.ok)throw Error(result.error||'书籍状态无法读取');if(!result.available){const downloaded=await fetch('/api/sync/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'download',id:book.id})});if(!downloaded.ok)throw Error((await downloaded.json() as {error?:string}).error||'书籍下载未完成');}}
 return `/api/library/file/${encodeURIComponent(book.id)}`;}
