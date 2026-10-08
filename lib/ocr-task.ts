// Tesseract termination does not settle pending jobs. Cancellation must release
// ownership independently, and old jobs must never release a newer job's lock.
export class OcrTaskController {
 private current: {key:string;controller:AbortController}|null=null;
 get busy(){return this.current!==null;}
 start(key:string){
  if(this.current)return null;
  const task={key,controller:new AbortController()};this.current=task;
  return {signal:task.controller.signal,isCurrent:()=>this.current===task,
   finish:()=>{if(this.current===task)this.current=null;}};
 }
 cancel(){const task=this.current;this.current=null;task?.controller.abort();return task?.key;}
}
export function waitForOcr<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const cancelled=()=>{cleanup();reject(new DOMException('OCR cancelled','AbortError'));};
  const cleanup=()=>signal.removeEventListener('abort',cancelled);
  promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  if(signal.aborted)cancelled();else signal.addEventListener('abort',cancelled,{once:true});
 });
}
