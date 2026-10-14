import {useEffect,useRef,useState} from 'react';
import {Button} from '../components/ui/button';
import {Textarea} from '../components/ui/textarea';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../components/ui/dialog';
import {readDraft,writeDraft} from '../lib/draft-storage';
import {type Notebook} from '../lib/notebook';
type Draft={text:string;reason:string};
const empty:Draft={text:'',reason:''};
export function MobileQuestionEditor({data,id,saving,save}:{data:Notebook;id:string;saving:boolean;save:(data:Notebook,feedback:string)=>Promise<boolean>}){
 const [draft,setDraft]=useState(empty),[ready,setReady]=useState(false),[editing,setEditing]=useState(false),[title,setTitle]=useState(''),[body,setBody]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
 const latest=useRef(draft),queue=useRef(Promise.resolve());useEffect(()=>{latest.current=draft;},[draft]);
 const persist=(value:Draft)=>{queue.current=queue.current.catch(()=>{}).then(()=>writeDraft('mobile-question-'+id,value));return queue.current;};
 useEffect(()=>{let active=true;void readDraft<Draft>('mobile-question-'+id,empty).then(value=>{if(active){setDraft(value);setReady(true);}}).catch(cause=>setError(cause.message));return()=>{active=false;};},[id]);
 useEffect(()=>{if(!ready)return;const timer=setTimeout(()=>void persist(draft).catch(cause=>setError(cause.message)),250);return()=>clearTimeout(timer);},[draft,ready]);
 useEffect(()=>()=>{if(ready)void persist(latest.current);},[ready]);
 const note=data.notes.find(n=>n.id===id),cross=data.crossThoughts.find(n=>n.id===id),card=data.cards.find(n=>n.id===id);
 async function append(event:React.FormEvent){event.preventDefault();const thought={id:crypto.randomUUID(),text:draft.text.trim(),origin:'自己的思考',reason:draft.reason.trim(),at:new Date().toISOString()};if(!thought.text||!ready)return;const next={...data,notes:data.notes.map(n=>n.id===id?{...n,thoughts:[...(n.thoughts||[]),thought]}:n),crossThoughts:data.crossThoughts.map(n=>n.id===id?{...n,thoughts:[...(n.thoughts||[]),thought]}:n),cards:data.cards.map(n=>n.id===id?{...n,thoughts:[...(n.thoughts||[]),thought]}:n)};if(await save(next,'后续思考已保存')){setDraft(empty);await persist(empty);}}
 async function revise(event:React.FormEvent){event.preventDefault();if(!note||!title.trim()||!reason.trim())return;const revision={title:note.title,body:note.body,origin:note.origin,source:note.source,at:new Date().toISOString(),reason:reason.trim()};if(await save({...data,notes:data.notes.map(n=>n.id===id?{...n,title:title.trim(),body:body.trim(),revisions:[...n.revisions,revision]}:n)},'问题已修改，原记录保留'))setEditing(false);}
 if(!note&&!cross&&!card)return null;
 return <section className="mobile-question-editor">{note&&!!note.parent&&<Button variant="outline" onClick={()=>{setTitle(note.title);setBody(note.body);setReason('');setEditing(true);}}>修改问题</Button>}<form onSubmit={append}><label>继续思考<Textarea aria-label="后续思考" rows={3} disabled={!ready} value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value})}/></label><Textarea aria-label="判断改变的原因" placeholder="判断改变的原因（选填）" rows={2} value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})}/>{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={!ready||saving||!draft.text.trim()}>保存后续思考</Button></form>
 <Dialog open={editing} onOpenChange={setEditing}><DialogContent><DialogTitle>修改问题</DialogTitle><DialogDescription>保留原话和修改原因，所有关联继续指向这个问题。</DialogDescription><form className="mobile-card-place" onSubmit={revise}><label>标题<Textarea aria-label="问题标题" value={title} maxLength={300} onChange={e=>setTitle(e.target.value)} required/></label><label>正文<Textarea aria-label="问题正文" value={body} onChange={e=>setBody(e.target.value)} rows={4}/></label><label>修改原因<Textarea aria-label="修改原因" value={reason} onChange={e=>setReason(e.target.value)} required/></label><Button disabled={saving||!title.trim()||!reason.trim()} type="submit">保存修改</Button></form></DialogContent></Dialog></section>;
}
