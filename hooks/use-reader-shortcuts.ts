'use client';
import {useEffect,useState} from 'react';
import {readDraft,writeDraft} from '@/lib/draft-storage';
import {defaultReaderShortcuts,normalizeReaderShortcuts,type ReaderShortcuts} from '@/lib/reader-shortcuts';
let current=defaultReaderShortcuts,loaded=false,loading:Promise<void>|null=null;
const listeners=new Set<(value:ReaderShortcuts)=>void>();
function load(){return loading??=(async()=>{try{current=normalizeReaderShortcuts(await readDraft('reader-shortcuts',defaultReaderShortcuts));loaded=true;for(const fn of listeners)fn(current);}catch(error){loading=null;throw error;}})();}
export function useReaderShortcuts(){
 const [value,setValue]=useState(current),[ready,setReady]=useState(loaded),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const accept=(next:ReaderShortcuts)=>{setValue(next);setReady(true);};listeners.add(accept);void load().catch(cause=>{if(alive)setError('阅读按键设置未能读取：'+(cause as Error).message);});return()=>{alive=false;listeners.delete(accept);};},[]);
 async function save(next:ReaderShortcuts){const normalized=normalizeReaderShortcuts(next);await writeDraft('reader-shortcuts',normalized);current=normalized;loaded=true;setError('');for(const fn of listeners)fn(current);}
 return {value,ready,error,save};
}
