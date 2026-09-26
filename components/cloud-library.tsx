'use client';

import {useEffect,useRef,useState} from 'react';
import {CloudUpload,RefreshCw,RotateCcw,Settings2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';

type CloudConfig={configured:boolean;region:string;bucket:string;prefix:string;accessKeyId:string};
type CloudSnapshot={key:string;createdAt:string;size:number};
type CloudJob={state:'idle'|'running'|'done'|'error';stage?:string;progress?:number;message?:string;result?:{restored?:boolean;key?:string}};
type Props={open:boolean;onOpenChange:(open:boolean)=>void;onRestored?:()=>void};
type Form={region:string;bucket:string;prefix:string;accessKeyId:string;accessKeySecret:string};

const emptyForm:Form={region:'',bucket:'',prefix:'wenjian/',accessKeyId:'',accessKeySecret:''};

function errorMessage(value:unknown){return value instanceof Error?value.message:'操作未完成，请重试';}
async function api<T>(path:string,options?:RequestInit):Promise<T>{
 const response=await fetch(path,options);
 const body=await response.json().catch(()=>null) as {error?:string;message?:string}|null;
 if(!response.ok)throw new Error(body?.error||body?.message||(response.status===404?'此版本暂不支持云备份':`请求失败（${response.status}）`));
 if(!body)throw new Error('云备份服务没有返回结果');
 return body as T;
}
function dateLabel(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date);}
function sizeLabel(value:number){if(!Number.isFinite(value)||value<0)return '大小未知';return value>=1024*1024*1024?`${(value/1024/1024/1024).toFixed(2)} GB`:value>=1024*1024?`${(value/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(value/1024))} KB`;}

export function CloudLibrary({open,onOpenChange,onRestored}:Props){
 const [config,setConfig]=useState<CloudConfig|null>(null);
 const [form,setForm]=useState<Form>(emptyForm);
 const [editing,setEditing]=useState(false);
 const [snapshots,setSnapshots]=useState<CloudSnapshot[]>([]);
 const [job,setJob]=useState<CloudJob|null>(null);
 const [loading,setLoading]=useState(true);
 const [working,setWorking]=useState(false);
 const [issue,setIssue]=useState('');
 const [notice,setNotice]=useState('');
 const [restoreKey,setRestoreKey]=useState<string|null>(null);
 const [confirmation,setConfirmation]=useState('');
 const restorePending=useRef(false);

 async function refreshSnapshots(){
  const result=await api<{snapshots:CloudSnapshot[]}>('/api/cloud/snapshots');
  setSnapshots(Array.isArray(result.snapshots)?result.snapshots:[]);
 }

 useEffect(()=>{
  if(!open)return;
  let active=true;
  void (async()=>{
   try{
    const loaded=await api<CloudConfig>('/api/cloud/config');
    if(!active)return;
    setConfig(loaded);
    setForm({region:loaded.region||'',bucket:loaded.bucket||'',prefix:loaded.prefix||'wenjian/',accessKeyId:loaded.accessKeyId||'',accessKeySecret:''});
    setEditing(!loaded.configured);
    const status=await api<CloudJob>('/api/cloud/job');
    if(active)setJob(status);
    if(loaded.configured){
     void api<{snapshots:CloudSnapshot[]}>('/api/cloud/snapshots').then(result=>{
      if(active)setSnapshots(Array.isArray(result.snapshots)?result.snapshots:[]);
     }).catch(error=>{if(active)setIssue(`无法读取云端备份：${errorMessage(error)}`);});
    }
   }catch(error){if(active)setIssue(errorMessage(error));}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[open]);

 useEffect(()=>{
  if(job?.state!=='running')return;
  let active=true;
  const timer=window.setInterval(()=>{
   void api<CloudJob>('/api/cloud/job').then(async status=>{
    if(!active)return;
    setJob(status);
    if(status.state==='done'){
     setNotice(status.message||'云备份操作已完成');
     setIssue('');
     if(status.result?.restored&&restorePending.current){restorePending.current=false;onRestored?.();}
     try{await refreshSnapshots();}catch(error){if(active)setIssue(`操作已完成，但备份列表刷新失败：${errorMessage(error)}`);}
    }else if(status.state==='error'){
     restorePending.current=false;
     setIssue(status.message||'云备份操作失败');
    }
   }).catch(error=>{if(active)setIssue(`无法读取操作进度：${errorMessage(error)}`);});
  },1000);
  return()=>{active=false;window.clearInterval(timer);};
 },[job?.state,onRestored]);

 async function saveConfig(event:React.FormEvent){
  event.preventDefault();setWorking(true);setIssue('');setNotice('');
  try{
   await api<CloudConfig>('/api/cloud/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
   setForm(current=>({...current,accessKeySecret:''}));
   const loaded=await api<CloudConfig>('/api/cloud/config');
   setConfig(loaded);
   setEditing(false);
   setSnapshots([]);
   setNotice('设置已保存在本机，可检测连接');
  }catch(error){setIssue(errorMessage(error));}
  finally{setWorking(false);}
 }
 async function checkConnection(){
  setWorking(true);setIssue('');setNotice('');
  try{
   const result=await api<{ok:boolean}>('/api/cloud/check',{method:'POST'});
   if(!result.ok)throw new Error('连接未通过，请检查 OSS 设置');
   setNotice('OSS 连接正常');
   await refreshSnapshots();
  }catch(error){setIssue(errorMessage(error));}
  finally{setWorking(false);}
 }
 async function upload(){
  setWorking(true);setIssue('');setNotice('');
  try{
   const result=await api<{jobId?:string;key?:string}>('/api/cloud/upload',{method:'POST'});
   if(result.jobId){setJob({state:'running',stage:'正在上传'});setNotice('正在上传完整备份');}
   else if(result.key){setJob({state:'done',message:'完整备份已上传',result:{key:result.key}});setNotice('完整备份已上传');await refreshSnapshots();}
   else throw new Error('服务没有返回上传结果');
  }catch(error){setIssue(errorMessage(error));}
  finally{setWorking(false);}
 }
 async function restore(){
  if(!restoreKey||confirmation!=='恢复')return;
  setWorking(true);setIssue('');setNotice('');
  try{
   const result=await api<{jobId?:string;restored?:boolean}>('/api/cloud/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:restoreKey,confirmation:'恢复'})});
   setRestoreKey(null);setConfirmation('');
   if(result.jobId){restorePending.current=true;setJob({state:'running',stage:'正在恢复'});setNotice('正在恢复本机资料');}
   else if(result.restored){setJob({state:'done',message:'备份已恢复',result:{restored:true}});setNotice('备份已恢复');onRestored?.();await refreshSnapshots();}
   else throw new Error('服务没有返回恢复结果');
  }catch(error){setIssue(errorMessage(error));}
  finally{setWorking(false);}
 }
 function update(field:keyof Form,value:string){setForm(current=>({...current,[field]:value}));}
 function changeOpen(value:boolean){
  if(value){setLoading(true);setIssue('');}
  else{setForm(current=>({...current,accessKeySecret:''}));setRestoreKey(null);setConfirmation('');}
  onOpenChange(value);
 }
 const busy=working||job?.state==='running';
 const progress=typeof job?.progress==='number'?Math.max(0,Math.min(100,Math.round(job.progress))):null;

 return <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="cloud-library-dialog"><DialogTitle>云备份</DialogTitle><DialogDescription>把笔记和书籍的完整备份存到阿里云 OSS；本机仍可离线使用。</DialogDescription>
  <div className="cloud-library-scroll">
   {loading?<p className="cloud-library-muted">正在读取设置…</p>:<>
    {editing?<form className="cloud-library-settings" onSubmit={saveConfig}>
     <label>地域 <Input value={form.region} onChange={event=>update('region',event.target.value)} placeholder="例如 cn-shanghai" required autoComplete="off"/></label>
     <label>Bucket <Input value={form.bucket} onChange={event=>update('bucket',event.target.value)} placeholder="Bucket 名称" required autoComplete="off"/></label>
     <label>备份目录 <Input value={form.prefix} onChange={event=>update('prefix',event.target.value)} placeholder="wenjian" autoComplete="off"/></label>
     <label>AccessKey ID <Input value={form.accessKeyId} onChange={event=>update('accessKeyId',event.target.value)} required autoComplete="off"/></label>
     <label>AccessKey Secret <Input type="password" value={form.accessKeySecret} onChange={event=>update('accessKeySecret',event.target.value)} required={!config?.configured} placeholder={config?.configured?'留空则保留已保存的密钥':'输入密钥'} autoComplete="new-password"/></label>
     <p className="cloud-library-muted">密钥仅用于这台设备访问你的 OSS。保存后不会在这里显示。</p>
     <div className="cloud-library-actions"><Button type="submit" disabled={working}>保存设置</Button>{config?.configured&&<Button type="button" variant="ghost" onClick={()=>{setEditing(false);setForm(current=>({...current,accessKeySecret:''}));}}>取消</Button>}</div>
    </form>:config?.configured?<div className="cloud-library-connection"><div><strong>{config.bucket}</strong><small>{config.region} · {config.prefix||'根目录'}</small></div><Button type="button" variant="ghost" size="sm" onClick={()=>setEditing(true)}><Settings2/>设置</Button></div>:<p className="cloud-library-muted">先设置 OSS 连接。</p>}

    {config?.configured&&!editing&&<><div className="cloud-library-actions"><Button type="button" variant="outline" disabled={busy} onClick={checkConnection}>检测连接</Button><Button type="button" disabled={busy} onClick={upload}><CloudUpload/>上传完整备份</Button></div>
     <section className="cloud-library-snapshots"><div className="cloud-library-section-head"><h3>云端备份</h3><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>void refreshSnapshots().catch(error=>setIssue(errorMessage(error)))}><RefreshCw/>刷新</Button></div>
      {snapshots.length? <div className="cloud-library-snapshot-list">{snapshots.map(snapshot=><article key={snapshot.key}><div><strong>{dateLabel(snapshot.createdAt)}</strong><small>{sizeLabel(snapshot.size)}</small></div><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>{setRestoreKey(snapshot.key);setConfirmation('');setIssue('');}}><RotateCcw/>恢复</Button></article>)}</div>:<p className="cloud-library-muted">还没有云端备份。</p>}
     </section></>}
    {restoreKey&&<div className="cloud-library-confirm"><strong>恢复这份云端备份？</strong><p>这会替换当前本机资料。请输入“恢复”确认。</p><Input value={confirmation} onChange={event=>setConfirmation(event.target.value)} placeholder="恢复" aria-label="输入恢复确认"/><div className="cloud-library-actions"><Button type="button" variant="destructive" disabled={busy||confirmation!=='恢复'} onClick={restore}>确认恢复</Button><Button type="button" variant="ghost" onClick={()=>{setRestoreKey(null);setConfirmation('');}}>取消</Button></div></div>}
    {job?.state==='running'&&<div className="cloud-library-job" role="status"><div><span>{job.stage||'正在处理'}</span>{progress!==null&&<strong>{progress}%</strong>}</div>{progress!==null&&<progress max="100" value={progress}/>}<p>{job.message||'备份较大时需要一些时间，完成前请保持应用打开。'}</p></div>}
    {issue&&<p className="cloud-library-error" role="alert">{issue}</p>}
    {notice&&!issue&&<p className="cloud-library-notice" role="status">{notice}</p>}
   </>}
  </div>
 </DialogContent></Dialog>;
}
