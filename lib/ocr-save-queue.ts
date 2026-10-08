import type {OcrCacheEntry} from './notebook';
export type CacheSaveResult={status:'saved'|'busy'|'retry'|'failed'|'discarded';error?:string};
export type PendingOcr={entry:OcrCacheEntry;state:'waiting'|'saving'|'retry'|'failed';attempts:number;due:number;error?:string};
export const ocrPageKey=(entry:Pick<OcrCacheEntry,'libraryBookId'|'page'>)=>`${entry.libraryBookId}:${entry.page}`;
export class OcrSaveQueue{
 readonly pending=new Map<string,PendingOcr>();
 private running=false;private stopped=false;private timer:ReturnType<typeof setTimeout>|null=null;
 constructor(private save:(entry:OcrCacheEntry)=>Promise<CacheSaveResult>,private changed:()=>void,private clock=()=>Date.now()){}
 add(entry:OcrCacheEntry){const key=ocrPageKey(entry),old=this.pending.get(key);if(old&&Date.parse(old.entry.at)>Date.parse(entry.at))return;this.pending.set(key,{entry,state:'waiting',attempts:0,due:0});this.changed();this.wake();}
 retry(){for(const item of this.pending.values()){if(item.state!=='saving'){item.state='waiting';item.attempts=0;item.due=0;item.error=undefined;}}this.changed();this.wake();}
 stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private wake(){if(this.stopped||this.running)return;if(this.timer)clearTimeout(this.timer);const times=[...this.pending.values()].filter(item=>item.state!=='failed').map(item=>item.due);if(!times.length)return;this.timer=setTimeout(()=>void this.flush(),Math.max(0,Math.min(...times)-this.clock()));}
 async flush(){
  if(this.stopped||this.running)return;this.running=true;
  try{for(const [key,item] of this.pending){
   if(this.stopped)break;if(item.state==='failed'||item.due>this.clock())continue;
   item.state='saving';this.changed();let result:CacheSaveResult;
   try{result=await this.save(item.entry);}catch(error){result={status:'retry',error:(error as Error).message};}
   if(this.pending.get(key)!==item)continue;
   if(result.status==='saved'||result.status==='discarded')this.pending.delete(key);
   else if(result.status==='busy'){item.state='waiting';item.due=this.clock()+800;}
   else{item.attempts++;item.error=result.error;item.state=result.status==='failed'||item.attempts>=5?'failed':'retry';item.due=this.clock()+Math.min(30000,1000*3**(item.attempts-1));}
   this.changed();
  }}finally{this.running=false;this.wake();}
 }
}
