// Bounded bridge messages keep native JSON parsing from duplicating the store.
export interface StoreChunks{
 beginStoreRead():Promise<{exists:boolean;id?:string;size?:number}>;
 readStoreChunk(input:{id:string}):Promise<{data:string;done:boolean}>;
 endStoreRead(input:{id:string}):Promise<unknown>;
 beginStoreWrite():Promise<{id:string}>;
 appendStoreChunk(input:{id:string;text:string}):Promise<unknown>;
 finishStoreWrite(input:{id:string}):Promise<unknown>;
 abortStoreWrite(input:{id:string}):Promise<unknown>;
}
const MAX=128*1024*1024;
export async function readChunkedStore(native:StoreChunks):Promise<string|undefined>{
 const session=await native.beginStoreRead();if(!session.exists)return undefined;
 if(!session.id)throw Error('本机资料读取任务无效。');
 const decoder=new TextDecoder('utf-8',{fatal:true}),parts:string[]=[];let bytes=0;
 try{if(!Number.isSafeInteger(session.size)||session.size!<0||session.size!>MAX)throw Error('本机资料大小无效，未创建新资料覆盖它。');for(;;){const chunk=await native.readStoreChunk({id:session.id}),raw=atob(chunk.data),buffer=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)buffer[i]=raw.charCodeAt(i);bytes+=buffer.length;if(bytes>MAX||bytes>session.size!||!buffer.length&&!chunk.done)throw Error('本机资料读取不完整。');parts.push(decoder.decode(buffer,{stream:!chunk.done}));if(chunk.done)break;}if(bytes!==session.size)throw Error('本机资料读取不完整。');return parts.join('');}
 finally{await native.endStoreRead({id:session.id}).catch(()=>{});}
}
export async function writeChunkedStore(native:StoreChunks,text:string):Promise<void>{
 const {id}=await native.beginStoreWrite();try{for(let offset=0;offset<text.length;){let end=Math.min(offset+48*1024,text.length);const last=text.charCodeAt(end-1);if(end<text.length&&last>=0xd800&&last<=0xdbff)end--;await native.appendStoreChunk({id,text:text.slice(offset,end)});offset=end;}await native.finishStoreWrite({id});}catch(error){await native.abortStoreWrite({id}).catch(()=>{});throw error;}
}
