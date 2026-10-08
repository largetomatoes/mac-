'use client';
import {useState} from 'react';
import {ArrowRight,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import './core-question-settings.css';

type FormProps={initialTitle?:string;first?:boolean;saving:boolean;error:string;onSave:(title:string,reason:string)=>Promise<boolean>};
function CoreForm({initialTitle='',first=false,saving,error,onSave}:FormProps){
 const [title,setTitle]=useState(initialTitle),[reason,setReason]=useState('');
 async function submit(event:React.FormEvent){event.preventDefault();if(saving||!title.trim())return;await onSave(title,reason);}
 return <form className="core-question-form" onSubmit={submit}>
  <label htmlFor="core-question-title" className={first?'sr-only':undefined}>核心问题</label>
  <Textarea id="core-question-title" autoFocus value={title} maxLength={300} rows={3} onChange={event=>setTitle(event.target.value)} placeholder="写下你的核心问题…" disabled={saving} required/>
  {!first&&<label>修改原因（选填）<Textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={10000} rows={2} disabled={saving}/></label>}
  {error&&<p role="alert" className="core-question-error">{error}</p>}
  <Button type="submit" disabled={saving||!title.trim()||(!first&&title.trim()===initialTitle)}>{saving?<Loader2 className="spin"/>:first?<ArrowRight/>:null}{first?'开始记录':'保存修改'}</Button>
 </form>;
}
export function CoreOnboarding(props:FormProps&{onImport?:()=>Promise<void>}){const [importing,setImporting]=useState(false),[importError,setImportError]=useState('');async function restore(){setImporting(true);setImportError('');try{await props.onImport?.();}catch(error){setImportError((error as Error).message);}finally{setImporting(false);}}return <main className="core-onboarding"><section><div className="core-onboarding-wordmark">问<span>间</span></div><h1>你想持续思考什么问题？</h1><CoreForm {...props} saving={props.saving||importing} first/>{props.onImport&&<button type="button" className="core-import-backup" disabled={importing||props.saving} onClick={restore}>{importing?'正在打开备份…':'导入已有备份'}</button>}{importError&&<p className="core-question-error" role="alert">{importError}</p>}</section></main>;}
export function CoreQuestionSettings({open,onOpenChange,...props}:FormProps&{open:boolean;onOpenChange:(open:boolean)=>void}){return <Dialog open={open} onOpenChange={value=>{if(!props.saving)onOpenChange(value);}}><DialogContent className="core-settings-dialog" onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(props.saving)event.preventDefault();}} showCloseButton={!props.saving}><DialogTitle>核心问题</DialogTitle><DialogDescription>修改后，现有内容和关联会保留。</DialogDescription><CoreForm {...props}/></DialogContent></Dialog>;}
