import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '@capacitor/app';
import {BookOpen,Cloud,Download,FilePlus2,Search,Check} from 'lucide-react';
import {AppUpdates} from '../components/app-updates';
import {MobileBookNotes} from './book-notes';
import {MobileQuestions} from './question-view';
import {dismissMobileLayer,useMobileViewport} from './viewport';
import {LibraryReader} from '../components/library-reader';
import {DeviceSync,useSyncStatus} from '../components/device-sync';
import {CoreOnboarding} from '../components/core-question-settings';
import {useOcrCache} from '../hooks/use-ocr-cache';
import {changeCoreQuestion,initialNotebook,normalize,type Notebook,type OcrCacheEntry} from '../lib/notebook';
import type {CacheSaveResult} from '../lib/ocr-save-queue';
import type {Envelope} from '../lib/sync/client';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../components/ui/dialog';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {mobileSnapshot,mobileSave,importMobileBook,installMobileApi,mobileConfig,saveMobileConfig,mobileBookAvailable} from './platform';
import '../app/globals.css';
import './reader.css';
installMobileApi();
document.documentElement.dataset.wenjianMobile="true";
function MobileReader(){
 useMobileViewport();
 const syncStatus=useSyncStatus();
 const [snapshot,setSnapshot]=useState<Envelope>({version:0,data:initialNotebook}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[bookId,setBookId]=useState<string|null>(null),[syncOpen,setSyncOpen]=useState(false),[settings,setSettings]=useState(false),[query,setQuery]=useState(''),[folder,setFolder]=useState('all'),[offline,setOffline]=useState<string[]>([]),[tab,setTab]=useState<'books'|'questions'|'notes'>('books');
 const [selectedQuestion,setSelectedQuestion]=useState<string|null>(null);
 const [sourceThoughtId,setSourceThoughtId]=useState<string|null>(null),[sourceChapter,setSourceChapter]=useState<string|null>(null);
 const [sourceLocation,setSourceLocation]=useState<string|null>(null),[sourceReadingId,setSourceReadingId]=useState<string|null>(null);
 const [config,setConfig]=useState({region:'',bucket:'',prefix:'wenjian/',accessKeyId:'',accessKeySecret:''}),[configBusy,setConfigBusy]=useState(false);
 const current=useRef(snapshot),busy=useRef(false),readerId=useRef(bookId);readerId.current=bookId;
 function accept(next:Envelope){if(next.version<current.current.version)return;current.current=next;setSnapshot(next);}
 const data=snapshot.data;
 useEffect(()=>{void mobileSnapshot().then(accept).catch(cause=>setError(cause.message)).finally(()=>setLoading(false));const updated=(event:Event)=>accept((event as CustomEvent).detail);window.addEventListener('wenjian-sync-updated',updated);let cancelled=false,listener:Awaited<ReturnType<typeof App.addListener>>|undefined;void App.addListener('backButton',()=>{if(dismissMobileLayer())return;if(readerId.current)setBookId(null);else void App.minimizeApp().catch(()=>{});}).then(value=>{if(cancelled)void value.remove();else listener=value;}).catch(()=>{});return()=>{cancelled=true;window.removeEventListener('wenjian-sync-updated',updated);void listener?.remove();};},[]);
 useEffect(()=>{let active=true;void Promise.all(data.libraryBooks.filter(book=>book.storedFile&&book.format!=='reference').map(async book=>(await mobileBookAvailable(book))?book.id:null)).then(ids=>{if(active)setOffline(ids.filter((id):id is string=>!!id));}).catch(()=>{});return()=>{active=false;};},[data.libraryBooks,bookId]);
 useEffect(()=>{if(settings)void mobileConfig().then(value=>setConfig({...config,region:value.region||'',bucket:value.bucket||'',prefix:value.prefix||'wenjian/',accessKeyId:value.accessKeyId||'',accessKeySecret:''})).catch(cause=>setError(cause.message));},[settings]);
 async function save(next:Notebook,feedback:string){if(busy.current)return false;busy.current=true;setSaving(true);setError('');try{accept(await mobileSave(next,current.current.version));if(feedback)setNotice(feedback);return true;}catch(cause){setError((cause as Error).message);accept(await mobileSnapshot());return false;}finally{busy.current=false;setSaving(false);}}
 async function saveOcr(entry:OcrCacheEntry):Promise<CacheSaveResult>{if(loading||busy.current)return {status:'busy'};busy.current=true;try{const response=await fetch('/api/notebook',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:current.current.version,entry})});const result=await response.json() as Envelope & {error?:string};if(response.ok){accept(result);return {status:'saved'};}if(response.status===409){accept(await mobileSnapshot());return {status:'retry',error:'正在合并新保存的内容'};}if(response.status===404)return {status:'discarded'};return {status:'retry',error:result.error};}catch{return {status:'retry',error:'识别结果等待本机保存'};}finally{busy.current=false;}}
 const ocrCache=useOcrCache(saveOcr);
 async function importBook(){setError('');try{const result=await importMobileBook();if(result){accept(result);setBookId(result.book.id);}}catch(cause){setError((cause as Error).message);}}
 async function saveSettings(event:React.FormEvent){event.preventDefault();setConfigBusy(true);setError('');try{await saveMobileConfig(config);setConfig({...config,accessKeySecret:''});setSettings(false);setSyncOpen(true);}catch(cause){setError((cause as Error).message);}finally{setConfigBusy(false);}}
 const books=data.libraryBooks.filter(book=>book.format!=='reference'&&(folder==='all'||(book.folderId||'')===folder)&&`${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()));
 const noteCount=data.readingNotes.length+data.bookThoughts.length;
 function openNoteBook(id:string,location?:string,readingId?:string,thoughtId?:string,chapter?:string){setSourceLocation(location||null);setSourceReadingId(readingId||null);setSourceThoughtId(thoughtId||null);setSourceChapter(chapter??null);setBookId(id);}

 const dialogs=<><DeviceSync open={syncOpen} onOpenChange={setSyncOpen} onSettings={()=>{setSyncOpen(false);setSettings(true);}}/><Dialog open={settings} onOpenChange={setSettings}><DialogContent className="mobile-settings"><DialogTitle>连接自己的书库</DialogTitle><DialogDescription>使用与电脑相同的 OSS 存储桶和目录，密钥加密保存在本机。</DialogDescription><form onSubmit={saveSettings}>{([['region','地域','cn-hangzhou'],['bucket','存储桶','Bucket 名称'],['prefix','目录','wenjian/'],['accessKeyId','AccessKey ID',''],['accessKeySecret','AccessKey Secret','保留已有密钥可留空']] as const).map(([key,label,placeholder])=><label key={key}>{label}<Input type={key==='accessKeySecret'?'password':'text'} autoComplete="off" value={config[key]} placeholder={placeholder} onChange={event=>setConfig({...config,[key]:event.target.value})}/></label>)}{error&&<p role="alert">{error}</p>}<Button disabled={configBusy} type="submit">保存连接</Button></form></DialogContent></Dialog></>;
 if(loading)return <main className="mobile-loading">正在打开书库…</main>;
 if(data.setupCompleted===false)return <><CoreOnboarding saving={saving} error={error} onSave={async title=>save(changeCoreQuestion(current.current.data,title),'')}/><button className="mobile-connect-existing" onClick={()=>setSyncOpen(true)}>已有电脑资料？连接云端书库</button>{dialogs}</>;
 return <main className={'mobile-home'+(tab==='questions'?' is-questions':'')}><header className="mobile-header"><div><span className="mobile-wordmark">问间</span><AppUpdates compact/></div><button className="mobile-sync-entry" data-sync-phase={syncStatus.phase} aria-label={"三端同步："+syncStatus.text} onClick={()=>setSyncOpen(true)}><Cloud size={20}/><span>{syncStatus.provider==='nutstore'?'坚果云':'同步'}<small>{syncStatus.text}</small></span></button></header><nav className="mobile-tabs"><button aria-current={tab==='books'?'page':undefined} onClick={()=>setTab('books')}>书库</button><button aria-current={tab==='questions'?'page':undefined} onClick={()=>setTab('questions')}>问题</button><button aria-current={tab==='notes'?'page':undefined} onClick={()=>setTab('notes')}>笔记 <small>{noteCount}</small></button></nav>
 {error&&<p role="alert" className="mobile-message error">{error}</p>}{notice&&<p role="status" className="mobile-message">{notice}</p>}
 {tab==='books'?<><div className="mobile-search"><Search size={18}/><input aria-label="搜索书名或作者" placeholder="找一本书" value={query} onChange={event=>setQuery(event.target.value)}/><button aria-label="导入书籍" onClick={()=>void importBook()}><FilePlus2 size={21}/></button></div><div className="mobile-folders"><button aria-pressed={folder==='all'} onClick={()=>setFolder('all')}>全部</button>{(data.libraryFolders||[]).map(item=><button key={item.id} aria-pressed={folder===item.id} onClick={()=>setFolder(item.id)}>{item.name}</button>)}</div><section className="mobile-books" aria-label="书库">{books.map(book=><button className="mobile-book" key={book.id} onClick={()=>{setError('');setSourceLocation(null);setSourceReadingId(null);setSourceThoughtId(null);setSourceChapter(null);setBookId(book.id);}}><div className="mobile-cover"><BookOpen size={26}/><span>{book.format.toUpperCase()}</span></div><div><h2>{book.title}</h2><p>{book.author||' '}</p><small>{offline.includes(book.id)?<><Check size={12}/>已离线保存</>:book.cloudFile?<><Download size={12}/>点击下载阅读</>:'等待电脑上传'}{book.progress.page?` · 第 ${book.progress.page} 页`:book.progress.cfi?' · 继续阅读':''}</small></div></button>)}{!books.length&&<div className="mobile-empty"><BookOpen/><p>把正在读的书带在身边</p><Button onClick={()=>void importBook()}>导入 PDF / EPUB</Button><button onClick={()=>setSyncOpen(true)}>从电脑同步书库</button></div>}</section></>:tab==='questions'?<MobileQuestions data={data} selected={selectedQuestion} onSelect={setSelectedQuestion} saving={saving} save={save} onOpenBook={(id,location,readingId)=>{openNoteBook(id,location,readingId);}}/>:<MobileBookNotes data={data} onQuestion={id=>{setTab('questions');setSelectedQuestion(id);}} onBook={openNoteBook}/>}
 <LibraryReader ocrCache={ocrCache} open={!!bookId} mode="reading" initialBookId={bookId} initialLocation={sourceLocation} initialReadingId={sourceReadingId} initialBookThoughtId={sourceThoughtId} initialChapter={sourceChapter} onOpenChange={open=>{if(!open)setBookId(null);}} onChooseLibrary={()=>setBookId(null)} onOpenQuestion={id=>{setBookId(null);setTab('questions');setSelectedQuestion(id);}} data={data} saving={saving} save={save} deleteBook={async()=>{setError('移动阅读版请在电脑端管理书籍删除。');return false;}}/>{dialogs}</main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><MobileReader/></React.StrictMode>);
