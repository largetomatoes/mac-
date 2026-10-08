'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {useEffect,useRef,useState} from 'react';
import {Loader2,Search,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {findBookText,readingTextNodes,rangeForMatch,type BookSearchHit} from '@/lib/book-search';
import type {LibraryBook,Notebook} from '@/lib/notebook';

type Props={book:LibraryBook;ready:boolean;getPdf:()=>any;getEpub:()=>any;getCache:()=>Notebook['ocrCache'];onResult:(hit:BookSearchHit)=>Promise<void>;onClear:()=>void};
export function BookSearch({book,ready,getPdf,getEpub,getCache,onResult,onClear}:Props){
 const [expanded,setExpanded]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[hits,setHits]=useState<BookSearchHit[]>([]),[status,setStatus]=useState(''),[error,setError]=useState('');
 const generation=useRef(0),pdfText=useRef(new Map<number,string>()),input=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>{generation.current++;},[]);
 const stop=()=>{generation.current++;setBusy(false);};
 function close(){stop();setExpanded(false);onClear();}
 async function search(event:React.FormEvent){
  event.preventDefault();const needle=query.trim();if(!needle||!ready)return;
  const run=++generation.current,isCurrent=()=>generation.current===run;
  setBusy(true);setHits([]);setError('');onClear();
  const results:BookSearchHit[]=[];let skipped=0,failed=0,nativePages=0,scanned=0,total=0;
  try{
   const pdf=getPdf(),epub=getEpub(),cache=getCache().filter(item=>item.libraryBookId===book.id);
   if(book.format==='pdf'&&!pdf||book.format==='epub'&&!epub)throw Error('书籍还在打开，请稍后搜索。');
   const sections=epub?.spine?.spineItems||[];total=book.format==='pdf'?pdf.numPages:sections.length;
   for(let i=0;i<total;i++){
    if(!isCurrent())return;
    try{
     if(book.format==='pdf'){
      const page=i+1,cached=cache.find(item=>item.page===page);let text=pdfText.current.get(page);
      if(text===undefined){const source=await pdf.getPage(page),content=await source.getTextContent();text=content.items.map((item:{str?:string;hasEOL?:boolean})=>(item.str||'')+(item.hasEOL?'\n':' ')).join('');if(!isCurrent())return;pdfText.current.set(page,text!);}
      const readable=!!text!.trim()&&!/[\uFFFD\u0000-\u0008]/.test(text!);
      if(readable)nativePages++;
      const value=cached?.text&&(cached.preferOcr||!readable)?cached.text:readable?text!:cached?.text||'';
      if(!value.trim())skipped++;
      findBookText(value,needle,201-results.length).forEach((match,occurrence)=>results.push({...match,query:needle,occurrence,location:`pdf:${page}`,label:`第 ${page} 页`}));
     }else{
      const section=sections[i];
      // Load a detached document; do not unload sections currently used by the reader.
      const doc=await epub.load(section.url);if(!isCurrent())return;
      const root=doc.body||doc.documentElement,nodes=readingTextNodes(root),raw=nodes.map(node=>node.data).join('');
      const nav=epub.navigation?.get?.(section.href),label=nav?.label?.trim()||doc.querySelector('h1,h2,title')?.textContent?.trim()||`第 ${i+1} 节`;
      findBookText(raw,needle,201-results.length).forEach((match,occurrence)=>{const range=rangeForMatch(nodes,match.start,match.end);if(range)results.push({...match,query:needle,occurrence,location:section.cfiFromRange(range),label});});
     }
    }catch{failed++;}
    if(!isCurrent())return;scanned=i+1;
    if(i%8===0||i===total-1){setHits(results.slice(0,200));setStatus(`正在搜索 ${scanned} / ${total} ${book.format==='pdf'?'页':'节'}`);await new Promise(resolve=>setTimeout(resolve,0));}
    if(results.length>200)break;
   }
   if(!isCurrent())return;
   setHits(results.slice(0,200));
   const scope=book.format==='epub'?'全书文字':nativePages===0?'已识别页面':'原生文字及已识别页面';
   setStatus(`${scope} · ${results.length>200?'显示前 200 处':`${results.length} 处结果`}${skipped?` · ${skipped} 页尚无可搜索文字`:''}${scanned<total?` · 已检索 ${scanned}/${total} ${book.format==='pdf'?'页':'节'}`:''}`);
   if(failed)setError(`${failed} 个${book.format==='pdf'?'页面':'章节'}未能读取，本次结果不完整。`);
  }catch(reason){if(isCurrent())setError((reason as Error).message||'搜索未能完成，请重试。');}
  finally{if(isCurrent())setBusy(false);}
 }
 async function jump(hit:BookSearchHit){try{stop();await onResult(hit);setExpanded(false);}catch{setError('没有定位到这段文字，请重新搜索。');}}
 return <div className="book-search-control">
  <Button variant="ghost" size="icon" className="reader-tool-icon" aria-label="搜索本书" aria-expanded={expanded} onClick={()=>{if(expanded)close();else{setExpanded(true);requestAnimationFrame(()=>input.current?.focus());}}}><Search/></Button>
  {expanded&&<section className="book-search-panel" aria-label="本书搜索" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
   <form onSubmit={search}><Search aria-hidden="true"/><input ref={input} aria-label="在本书中搜索文字" placeholder="输入词句，按回车搜索" value={query} onChange={event=>{stop();setQuery(event.target.value);setHits([]);setStatus('');setError('');onClear();}}/><Button size="sm" type="submit" disabled={!ready||!query.trim()}>{busy?<Loader2 className="spin"/>:'查找'}</Button><Button size="icon" variant="ghost" type="button" aria-label="关闭本书搜索" onClick={close}><X/></Button></form>
   <p role="status">{!ready?'正在打开书籍…':status||(book.format==='pdf'?'搜索原生文字和已识别页面':'搜索全书文字')}</p>
   {error&&<p role="alert">{error}</p>}
   <div className="book-search-results">{hits.map((hit,index)=><button key={`${hit.location}:${index}`} type="button" onClick={()=>void jump(hit)}><small>{hit.label}</small><span>{hit.before}<mark>{hit.match}</mark>{hit.after}</span></button>)}</div>
  </section>}
 </div>;
}
