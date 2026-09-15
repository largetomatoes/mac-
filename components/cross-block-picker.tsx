"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Checkbox} from '@/components/ui/checkbox';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {X} from 'lucide-react';
import {type Notebook,type CrossThought,numberOf} from '@/lib/notebook';

export function CrossBlockPicker({data,editing,saving,error,onClose,onSave}:{data:Notebook;editing?:CrossThought;saving:boolean;error:string;onClose:()=>void;onSave:(title:string,ids:string[])=>Promise<void>}){
 const [ids,setIds]=useState<string[]>(editing?.anchorIds||[]);
 const [title,setTitle]=useState(editing?.title||'');
 const [query,setQuery]=useState('');
 const blocks=data.notes.filter(n=>n.kind==='question').sort((a,b)=>numberOf(a,data.notes).localeCompare(numberOf(b,data.notes),undefined,{numeric:true}));
 const label=(id:string)=>{const n=data.notes.find(n=>n.id===id);return n?`${numberOf(n,data.notes)||'核心问题'} ${n.title}`:'原有思考连接';};
 const toggle=(id:string)=>setIds(current=>current.includes(id)?current.filter(x=>x!==id):current.length<30?[...current,id]:current);
 return <Dialog open onOpenChange={open=>{if(!open&&!saving)onClose();}}><DialogContent className="cross-dialog block-picker"><DialogTitle>{editing?'调整关联板块':'选择关联板块'}</DialogTitle><DialogDescription>选择两个或多个板块，上下级板块也可以同时选择。</DialogDescription>
 <Input aria-label="查找板块" placeholder="查找编号或板块名称" value={query} onChange={e=>setQuery(e.target.value)}/>
 <div className="block-options">{blocks.filter(n=>label(n.id).includes(query.trim())).map(n=><label key={n.id} className={'block-option '+(ids.includes(n.id)?'is-selected':'')} style={{paddingLeft:14+Math.min(4,numberOf(n,data.notes).split('.').length-1)*18}}><Checkbox checked={ids.includes(n.id)} onCheckedChange={()=>toggle(n.id)} disabled={saving||(!ids.includes(n.id)&&ids.length>=30)} aria-label={label(n.id)}/><span className="block-number">{numberOf(n,data.notes)||'核心'}</span><span>{n.title}</span></label>)}{!blocks.some(n=>label(n.id).includes(query.trim()))&&<p>没有匹配的板块</p>}</div>
 <div className="picked-blocks"><span aria-live="polite">已选 {ids.length} 个</span>{ids.map(id=><Button type="button" key={id} variant="outline" size="sm" disabled={saving} onClick={()=>toggle(id)} aria-label={`取消选择 ${label(id)}`}>{label(id)}<X size={14}/></Button>)}</div>
 {!editing&&<label className="block-title">交叉板块标题<Input value={title} onChange={e=>setTitle(e.target.value)} maxLength={300} placeholder="例如：语言与诚实"/></label>}
 {error&&<p className="error-banner" role="alert">{error}</p>}<div className="form-actions"><Button variant="ghost" disabled={saving} onClick={onClose}>取消</Button><Button disabled={saving||ids.length<2||(!editing&&!title.trim())} onClick={()=>void onSave(title.trim(),ids)}>{saving?'保存中…':editing?'保存关联':'进入笔记'}</Button></div></DialogContent></Dialog>;
}
