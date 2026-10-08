'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {Notebook} from '@/lib/notebook';
import {type ZoteroCatalog} from '@/lib/zotero';

export type ZoteroConnectionStatus={state:'connecting'|'connected'|'offline'|'error';message?:string;lastSyncedAt?:string;items?:number};
type Options={enabled:boolean;data:Notebook;saving:boolean;applyCatalog:(catalog:ZoteroCatalog)=>Promise<boolean>};

/** Merge into the latest rendered notebook through the same save path as the editor. */
export function useZoteroSync({enabled,data,saving,applyCatalog}:Options){
 const [status,setStatus]=useState<ZoteroConnectionStatus>({state:'connecting'});
 const current=useRef({enabled,data,saving,applyCatalog});
 const pending=useRef<ZoteroCatalog|null>(null);
 const request=useRef<AbortController|null>(null);
 const applying=useRef(false),lastAttempt=useRef(0),generation=useRef(0);
 useEffect(()=>{current.current={enabled,data,saving,applyCatalog};},[enabled,data,saving,applyCatalog]);

 const apply=useCallback(async()=>{
  if(!current.current.enabled||current.current.saving||applying.current||!pending.current)return;
  const catalog=pending.current,epoch=generation.current;
  applying.current=true;
  try{
   if(!await current.current.applyCatalog(catalog))return;
   if(epoch!==generation.current)return;
   if(pending.current===catalog)pending.current=null;
   setStatus({state:'connected',items:catalog.items.length,lastSyncedAt:new Date().toISOString(),message:catalog.warnings?.length?catalog.warnings[0]:undefined});
  }finally{applying.current=false;}
 },[]);

 const refresh=useCallback(async(force=false)=>{
  if(!current.current.enabled||document.visibilityState==='hidden'||request.current||pending.current||applying.current)return;
  if(!force&&Date.now()-lastAttempt.current<10000)return;
  lastAttempt.current=Date.now();
  const controller=new AbortController(),epoch=generation.current;
  request.current=controller;
  setStatus(previous=>({...previous,state:'connecting',message:undefined}));
  try{
   const response=await fetch('/api/zotero/catalog',{signal:controller.signal,cache:'no-store'});
   const catalog=await response.json() as ZoteroCatalog&{error?:string;code?:string};
   if(!response.ok)throw Object.assign(new Error(catalog.error||'Zotero 暂时无法连接。'),{code:catalog.code});
   if(epoch!==generation.current||!current.current.enabled)return;
   if(!catalog.serverId||!Array.isArray(catalog.items))throw new Error('Zotero 返回的文献格式不正确。');
   pending.current=catalog;
   await apply();
  }catch(error){
   if(controller.signal.aborted||epoch!==generation.current)return;
   const issue=error as Error&{code?:string};
   setStatus(previous=>({...previous,state:issue.code==='UNAVAILABLE'?'offline':'error',message:issue.message}));
  }finally{if(request.current===controller)request.current=null;}
 },[apply]);

 useEffect(()=>{
  if(!enabled)return;
  const epoch=generation.current;
  const start=window.setTimeout(()=>void refresh(),1000);
  const timer=window.setInterval(()=>{if(pending.current)void apply();else void refresh();},60000);
  const focus=()=>void refresh();
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  return()=>{generation.current=epoch+1;request.current?.abort();request.current=null;pending.current=null;window.clearTimeout(start);window.clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[enabled,refresh,apply]);
 useEffect(()=>{if(enabled&&!saving&&pending.current){const timer=window.setTimeout(()=>void apply(),0);return()=>window.clearTimeout(timer);}},[enabled,saving,data,apply]);
 return {status,refresh:()=>void refresh(true)};
}
