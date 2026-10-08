'use client';
import {useEffect,useRef,useState} from 'react';
import {readDraft,writeDraft} from '@/lib/draft-storage';
import {validOcrEntry} from '@/lib/ocr-cache.cjs';
import {OcrSaveQueue,type CacheSaveResult,type PendingOcr} from '@/lib/ocr-save-queue';
import type {OcrCacheEntry} from '@/lib/notebook';
export function useOcrCache(save:(entry:OcrCacheEntry)=>Promise<CacheSaveResult>){
 const saveRef=useRef(save);useEffect(()=>{saveRef.current=save;},[save]);
 const queue=useRef<OcrSaveQueue|null>(null),[pending,setPending]=useState<PendingOcr[]>([]),[storageError,setStorageError]=useState('');
 useEffect(()=>{
  let active=true,loaded=false,writeTimer:ReturnType<typeof setTimeout>|undefined,writes=Promise.resolve();
  const persist=()=>{if(!loaded)return;clearTimeout(writeTimer);writeTimer=setTimeout(()=>{const entries=[...worker.pending.values()].map(item=>item.entry);writes=writes.catch(()=>{}).then(()=>writeDraft('ocr-pending-v1',entries));writes.then(()=>{if(active)setStorageError('');},()=>{if(active)setStorageError('待保存文字暂存失败，请先不要退出应用。');});},150);};
  const worker=new OcrSaveQueue(entry=>saveRef.current(entry),()=>{if(active)setPending([...worker.pending.values()].map(item=>({...item})));persist();});queue.current=worker;
  readDraft<OcrCacheEntry[]>('ocr-pending-v1',[]).then(entries=>{if(!active)return;for(const entry of Array.isArray(entries)?entries:[])if(validOcrEntry(entry))worker.add(entry);loaded=true;persist();}).catch(()=>{if(active)setStorageError('未能读取待保存的识别文字，请稍后重新打开应用。');});
  const retry=()=>worker.retry();window.addEventListener('online',retry);window.addEventListener('focus',retry);
  return()=>{active=false;worker.stop();clearTimeout(writeTimer);if(loaded){const entries=[...worker.pending.values()].map(item=>item.entry);void writes.catch(()=>{}).then(()=>writeDraft('ocr-pending-v1',entries)).catch(()=>{});}window.removeEventListener('online',retry);window.removeEventListener('focus',retry);};
 },[]);
 return {pending,storageError,enqueue:(entry:OcrCacheEntry)=>queue.current?.add(entry),retry:()=>queue.current?.retry()};
}
