'use client';
import {useEffect,useRef,useState} from 'react';
import {type Notebook} from '@/lib/notebook';
import {recordPages} from '@/lib/page-organization.cjs';
import {reviseQuestion,reviseProcessNote,reviseBookThought} from '@/lib/record-revisions';
import {readDraft,writeDraft} from '@/lib/draft-storage';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Textarea} from './ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from './ui/dialog';
export function RecordRevisionEditor({data,id,kind,save,saving,suggestedText,label}:{suggestedText?:string;label?:string;data:Notebook;id:string;kind:'question'|'process'|'reading';saving:boolean;save:(data:Notebook,feedback:string)=>Promise<boolean>}){
 const record=kind==='question'?data.notes.find(n=>n.id===id):kind==='process'?data.readingNotes.find(n=>n.id===id):data.bookThoughts.find(n=>n.id===id);
 const current=record?kind==='question'?(record as any).body:kind==='process'?(record as any).interpretation:(record as any).text:'';
 const [open,setOpen]=useState(false),[text,setText]=useState(''),[title,setTitle]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),base=useRef('');
 const key='revision:'+kind+':'+id;
 async function begin(){setError('');setReady(false);base.current=current;setText(suggestedText??current);setTitle((record as any)?.title||'');setReason('');setOpen(true);try{const d=await readDraft<any>(key,null);if(!suggestedText&&d&&d.base===current){setText(d.text);setTitle(d.title);setReason(d.reason);}else if(!suggestedText&&d)setError('已有修订草稿来自旧表述，原草稿保留，请核对后再编辑。');setReady(true);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{if(!open||!ready)return;const timer=setTimeout(()=>void writeDraft(key,{base:base.current,text,title,reason}).catch(e=>setError(e.message)),250);return()=>clearTimeout(timer);},[open,ready,text,title,reason,key]);
 async function close(){try{if(ready)await writeDraft(key,{base:base.current,text,title,reason});setOpen(false);}catch(e){setError('草稿尚未保存：'+(e as Error).message);}}
 async function submit(e:React.FormEvent){e.preventDefault();if(current!==base.current){setError('这条记录在另一处已有修订，草稿保留，请重新核对。');return;}try{const next=kind==='question'?reviseQuestion(data,id,title,text,reason):kind==='process'?reviseProcessNote(data,id,text,reason):reviseBookThought(data,id,text,reason);if(await save(next,'修订已保存，原表述保留')){setReady(false);await writeDraft(key,null);setOpen(false);}}catch(e){setError((e as Error).message);}}
 return <>{kind!=='question'&&!!record?.revisions?.length&&<details className="note-revision-history"><summary>此前表述 · {record.revisions.length}</summary>{[...record.revisions].reverse().map((revision:any,index)=><article key={revision.id||index}><small>{new Date(revision.at).toLocaleString('zh-CN')}{revision.reason&&' · '+revision.reason}</small><p style={{whiteSpace:'pre-wrap'}}>{revision.text??revision.body}</p></article>)}</details>}<Button variant="ghost" size="sm" disabled={saving||!record} onClick={()=>void begin()}>{label||('修订'+(kind==='question'?'当前记录':'笔记'))}</Button><Dialog open={open} onOpenChange={v=>{if(!v)void close();}}><DialogContent className="record-revision-dialog" style={{maxHeight:'85dvh',overflowY:'auto'}}><DialogTitle>修订{kind==='question'?'当前记录':'自己的笔记'}</DialogTitle><DialogDescription>{kind==='question'?`这是同一个问题的正文，${recordPages(data,id).length>1?'引用它的各个页面都会看到新表述。':'原表述会保留在历史中。'}位置不受影响。`:'只修改自己的表述，原文与来源保留。'}</DialogDescription><form onSubmit={submit} style={{display:'grid',gap:12}}>{kind==='question'&&<Input aria-label="修订标题" value={title} onChange={e=>setTitle(e.target.value)} required maxLength={300}/>}<Textarea aria-label="修订正文" value={text} onChange={e=>setText(e.target.value)} rows={10} required={kind!=='question'}/><Input aria-label="修订原因" placeholder={kind==='question'?'为什么改变了判断？':'修改原因（选填）'} value={reason} onChange={e=>setReason(e.target.value)} required={kind==='question'}/>{error&&<p role="alert">{error}</p>}<Button disabled={!ready||saving} type="submit">保留旧版并保存</Button></form></DialogContent></Dialog></>;
}
