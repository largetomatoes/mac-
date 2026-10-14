'use client';
import {useState} from 'react';
import {Plus,Network,Settings2} from 'lucide-react';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {pagesOf,pageTitle,addQuestionPage,type Notebook} from '@/lib/notebook';
import './question-pages.css';
type Props={data:Notebook;currentId:string;onSelect:(id:string)=>void;saving:boolean;save:(data:Notebook,feedback:string)=>Promise<boolean>};
export function QuestionPages({data,currentId,onSelect,saving,save}:Props){
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[title,setTitle]=useState(''),[combine,setCombine]=useState(false),[members,setMembers]=useState<string[]>([]),[error,setError]=useState('');
 const pages=pagesOf(data),current=pages.find(page=>page.id===currentId);
 function begin(edit=false){setError('');setEditing(edit);setTitle('');setCombine(edit?current?.kind==='collection':false);setMembers(edit?current?.members||[]:[]);setOpen(true);}
 async function submit(e:React.FormEvent){e.preventDefault();setError('');try{
  if(editing&&current){if(current.kind==='collection'&&members.length<2)throw Error('汇总至少保留两个问题页。');const next={...data,questionPages:pages.map(page=>page.id===current.id?{...page,members}:page)};if(await save(next,'汇总范围已更新'))setOpen(false);return;}
  const next=addQuestionPage(data,title,combine?members:[]);if(await save(next.data,'问题页已创建')){onSelect(next.page.id);setOpen(false);}
 }catch(cause){setError((cause as Error).message);}}
 async function archive(){if(!current||pages.filter(page=>!page.archivedAt).length<=1)return;const next={...data,questionPages:pages.map(page=>page.id===current.id?{...page,archivedAt:new Date().toISOString()}:page)};if(await save(next,'问题页已归档，内容保留')){onSelect(pages.find(page=>page.id!==current.id&&!page.archivedAt)!.id);setOpen(false);}}
 return <><nav className="question-page-tabs" aria-label="问题页"><div className="question-page-tab-list">{pages.filter(page=>!page.archivedAt).sort((a,b)=>a.order-b.order).map(page=><button type="button" key={page.id} aria-current={currentId===page.id?'page':undefined} title={pageTitle(data,page)} onClick={()=>onSelect(page.id)}>{page.kind==='collection'&&<Network size={14}/>}<span>{pageTitle(data,page)}</span></button>)}</div><button type="button" className="page-add" aria-label="增加问题页" disabled={saving} onClick={()=>begin()}><Plus size={17}/><span>问题页</span></button><button type="button" aria-label="管理当前问题页" disabled={saving} onClick={()=>begin(true)}><Settings2 size={17}/></button></nav>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="question-page-dialog"><DialogTitle>{editing?'管理问题页':'增加问题页'}</DialogTitle><DialogDescription>{editing?'调整汇总范围或归档，原记录会保留。':'可以从一个小问题开始，也可以汇总已有的问题页。'}</DialogDescription><form onSubmit={submit}>
 {!editing&&<label>问题名称<Input autoFocus maxLength={300} value={title} onChange={e=>setTitle(e.target.value)} required/></label>}
 {!editing&&<label className="page-combine-toggle"><input type="checkbox" checked={combine} onChange={e=>setCombine(e.target.checked)}/>汇总已有问题页</label>}
 {combine&&<fieldset className="page-member-list"><legend>纳入顺序</legend>{pages.filter(page=>page.kind==='question'&&!page.archivedAt&&(!editing||page.id!==currentId)).map(page=><label key={page.id}><input type="checkbox" checked={members.includes(page.id)} onChange={()=>setMembers(ids=>ids.includes(page.id)?ids.filter(id=>id!==page.id):[...ids,page.id])}/><span>{members.includes(page.id)?members.indexOf(page.id)+1+'. ':''}{pageTitle(data,page)}</span></label>)}</fieldset>}
 {error&&<p role="alert">{error}</p>}
 {(!editing||combine)&&<Button type="submit" disabled={saving||(!editing&&!title.trim())||(combine&&members.length<2)}>{editing?'保存范围':combine?'创建汇总视图':'创建问题页'}</Button>}
 {editing&&<Button type="button" variant="outline" disabled={saving||pages.filter(p=>!p.archivedAt).length<=1} onClick={()=>void archive()}>归档当前页</Button>}
 </form>{editing&&pages.some(page=>page.archivedAt)&&<div className="page-archive-list"><small>已归档</small>{pages.filter(page=>page.archivedAt).map(page=><button key={page.id} type="button" disabled={saving} onClick={async()=>{if(await save({...data,questionPages:pages.map(p=>p.id===page.id?{...p,archivedAt:undefined}:p)},'问题页已恢复')){onSelect(page.id);setOpen(false);}}}>{pageTitle(data,page)} · 恢复</button>)}</div>}</DialogContent></Dialog></>;
}
