'use client';
import {useMemo,useState} from 'react';
import {type MaintenanceTarget} from '@/lib/maintenance.cjs';
import {displayBook,type Notebook} from '@/lib/notebook';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {Input} from './ui/input';
type Entry={target:MaintenanceTarget;text:string;source:string;at:string;kind:string};
export function RecordMaintenance({open,onOpenChange,data,saving,onRemove}:{open:boolean;onOpenChange:(v:boolean)=>void;data:Notebook;saving:boolean;onRemove:(target:MaintenanceTarget)=>Promise<boolean>}){
 const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[selected,setSelected]=useState<Entry|null>(null),[error,setError]=useState('');
 const entries=useMemo(()=>{const rows:Entry[]=[];
  for(const [collection,label,type] of [['libraryHighlights','高亮','highlight'],['readingNotes','过程笔记','process'],['bookThoughts','读书思考','reading'],['cards','卡片','card'],['thoughtReplies','回答','reply']] as const)
   for(const record of data[collection]){const v=record as unknown as {id:string;quote?:string;interpretation?:string;text?:string;book?:string;bookTitle?:string;chapter?:string;locator?:string;at:string;libraryBookId?:string};rows.push({target:{kind:type,id:v.id},text:[v.quote,v.interpretation,v.text].filter(Boolean).join(' / '),source:[v.book||v.bookTitle,v.chapter,v.locator].filter(Boolean).join(' · '),at:v.at,kind:label});}
  for(const owner of [...data.notes,...data.crossThoughts,...data.cards,...data.readingNotes,...data.bookThoughts])for(const t of owner.thoughts||[])rows.push({target:{kind:'thought',id:t.id},text:t.text,source:'title' in owner?owner.title||'':'book' in owner?owner.book:'',at:t.at,kind:'后来想到'});
  for(const book of data.libraryBooks)for(const a of book.zotero?.annotations||[])if(!book.hiddenZoteroAnnotations?.includes(a.attachmentKey+':'+a.key))rows.push({target:{kind:'zotero',id:a.attachmentKey+':'+a.key,bookId:book.id},text:[a.text,a.comment].filter(Boolean).join(' / '),source:displayBook(book).title+(a.pageLabel?' · '+a.pageLabel:''),at:a.at,kind:'Zotero来源'});
  return rows.sort((a,b)=>(b.at||'').localeCompare(a.at||''));},[data]);
 const shown=entries.filter(e=>(kind==='all'||e.kind===kind)&&(!query.trim()||(e.text+' '+e.source).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
 return <Dialog open={open} onOpenChange={v=>{if(!saving){setSelected(null);onOpenChange(v);}}}><DialogContent className="maintenance-dialog"><DialogTitle>资料维护 · 删除笔记与标注</DialogTitle><DialogDescription>每一条记录都可能保留着当时的思考。删除前，请确认它已经不再需要。</DialogDescription>
 {error&&<p role="alert">{error}</p>}{selected?<div className="maintenance-confirm"><small>{selected.kind} · {selected.source}</small><p>{selected.text}</p><p className="maintenance-scope">{selected.target.kind==='zotero'?'只在问间隐藏，Zotero原始批注和自己的思考保留。':selected.target.kind==='highlight'?'只删除这处高亮，原书和已有笔记保留。':'只删除这条记录。原书、其他记录和文稿来源快照保留。'}</p><div><Button variant="outline" disabled={saving} onClick={()=>setSelected(null)}>返回</Button><Button variant="destructive" disabled={saving} onClick={async()=>{setError('');try{if(await onRemove(selected.target))setSelected(null);else setError('未能完成删除，记录已保留。请关闭后检查保存提示并重试。');}catch(cause){setError((cause as Error).message);}}}>确认删除这条记录</Button></div></div>:<><div className="maintenance-filters"><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="找内容或书名" aria-label="查找待维护记录"/><select value={kind} onChange={e=>setKind(e.target.value)} aria-label="记录类型"><option value="all">全部类型</option>{[...new Set(entries.map(e=>e.kind))].map(k=><option key={k}>{k}</option>)}</select></div><div className="maintenance-list">{shown.map(e=><button key={e.target.kind+':'+e.target.id} type="button" onClick={()=>{setError('');setSelected(e);}}><small>{e.kind} · {e.source} · {e.at?new Date(e.at).toLocaleDateString('zh-CN'):''}</small><p>{e.text.slice(0,240)}</p></button>)}{!shown.length&&<p>没有匹配的记录。</p>}</div></>}
 </DialogContent></Dialog>;
}
