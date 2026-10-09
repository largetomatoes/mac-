'use client';
import {useEffect,useState} from 'react';
import {ArrowDownToLine,RefreshCw,Info} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {RELEASES_PAGE,selectUpdate,type AppInfo,type Release,type UpdateResult} from '@/lib/app-updates';
import './app-updates.css';

type Check={at:number;releases?:Release[];error?:string};
const pending=new Map<string,Promise<Check>>();
async function api<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(path,init);const result=await response.json() as T & {error?:string};if(!response.ok)throw Error(result.error||'暂时无法检查更新，请稍后重试。');return result;}
function cacheKey(info:AppInfo){return `wenjian-updates:${info.platform}:${info.arch}:${info.version}`;}
function cached(info:AppInfo):Check|undefined{try{const value=JSON.parse(localStorage.getItem(cacheKey(info))||'null');return value&&typeof value.at==='number'&&Number.isFinite(value.at)?value:undefined;}catch{return undefined;}}
function check(info:AppInfo,manual:boolean):Promise<Check>{const key=cacheKey(info),old=cached(info);if(!manual&&old&&Date.now()>=old.at&&Date.now()-old.at<(old.error?3600000:86400000))return Promise.resolve(old);if(pending.has(key))return pending.get(key)!;const promise=api<Release[]>('/api/app/releases'+(manual?'?manual=1':'')).then(releases=>{selectUpdate(releases,info);return {at:Date.now(),releases};}).catch(error=>({at:Date.now(),error:(error as Error).message})).then(result=>{try{localStorage.setItem(key,JSON.stringify(result));}catch{}return result;}).finally(()=>pending.delete(key));pending.set(key,promise);return promise;}
export function AppUpdates({compact=false}:{compact?:boolean}){
 const [info,setInfo]=useState<AppInfo|null>(null),[result,setResult]=useState<UpdateResult|null>(null),[last,setLast]=useState<Check>(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[openingError,setOpeningError]=useState('');
 function accept(value:Check,current:AppInfo){setLast(value);if(value.releases)setResult(selectUpdate(value.releases,current));}
 useEffect(()=>{let cancelled=false;let current:AppInfo|null=null;const run=async()=>{if(document.hidden||!current)return;const value=await check(current,false);if(!cancelled)accept(value,current);};void api<AppInfo>('/api/app/info').then(value=>{if(cancelled)return;current=value;setInfo(value);void run();}).catch(()=>{});document.addEventListener('visibilitychange',run);return()=>{cancelled=true;document.removeEventListener('visibilitychange',run);};},[]);
 async function manual(){if(!info||busy)return;setBusy(true);setOpeningError('');try{accept(await check(info,true),info);}finally{setBusy(false);}}
 async function visit(url:string){setOpeningError('');try{await api('/api/app/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});}catch(error){setOpeningError((error as Error).message);}}
 if(!info)return null;
 const available=result?.state==='available';
 const message=last?.error?'暂时无法检查更新':result?.state==='available'?`发现新版 ${result.version}`:result?.state==='missing'?`新版 ${result.version} 尚未提供本平台安装包`:result?.state==='ahead'?`本机版本较新，公开版本为 ${result.version}`:result?.state==='current'?'当前已是最新正式版本':result?.state==='empty'?'尚无正式发布版本':'尚未检查更新';
 return <><button type="button" className={'app-update-entry'+(compact?' is-compact':'')+(available?' has-update':'')} title={available?message:'版本与更新'} aria-label={available?message:'版本与更新'} onClick={()=>setOpen(true)}>{available?<ArrowDownToLine size={16}/>:<Info size={16}/>}<span>{available?'有更新':compact?info.version:'更新'}</span>{available&&<i/>}</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="app-update-dialog"><DialogTitle>问间 · 版本与更新</DialogTitle><DialogDescription>本机 {info.version}（{info.build}） · {info.platform==='android'?'Android':info.platform==='darwin'?'macOS':'Windows'}</DialogDescription><p className="app-update-status" role="status">{busy?'正在检查…':message}</p>{last?.error&&<p className="app-update-error" role="alert">{last.error}</p>}{last&&<small className="app-update-time">上次检查：{new Date(last.at).toLocaleString('zh-CN')}</small>}{available&&result?.release?.body&&<div className="app-release-notes">{result.release.body.slice(0,6000)}</div>}{available&&<p className="app-update-hint">下载安装包后覆盖原应用，保留本机资料。安卓请直接升级，勿先卸载。</p>}{openingError&&<p role="alert">{openingError}</p>}<div className="app-update-actions"><Button variant="outline" disabled={busy} onClick={()=>void manual()}><RefreshCw className={busy?'spin':undefined}/>检查更新</Button>{available&&result?.download?<Button onClick={()=>void visit(result.download!)}><ArrowDownToLine/>下载安装包</Button>:<Button variant="ghost" onClick={()=>void visit(RELEASES_PAGE)}>查看发布页面</Button>}</div></DialogContent></Dialog></>;
}
