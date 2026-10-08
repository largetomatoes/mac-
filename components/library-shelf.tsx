'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,ChevronDown,ChevronRight,FilePlus2,Folder,FolderInput,FolderPlus,Library,Loader2,Pencil,RefreshCw,Search,Trash2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {LIBRARY_FOLDER_NAME_LIMIT,addLibraryFolder,assignBookFolder,normalizeLibraryFolders,removeLibraryFolder,renameLibraryFolder} from '@/lib/library-folders';
import type {Notebook} from '@/lib/notebook';
import {libraryBooksForMode,libraryBooksForZoteroCollection,zoteroCollectionTree,type LibraryMode} from '@/lib/zotero';
import './library-shelf.css';

export type ZoteroConnectionStatus={state:'connecting'|'connected'|'offline'|'error';message?:string;lastSyncedAt?:string;items?:number};
type Props={
 data:Notebook;
 mode:LibraryMode;
 onChooseLibrary?:()=>void;
 activeId:string|null;
 selectedFolder:string|null;
 onFolderChange:(id:string|null)=>void;
 selectedCollection:string|null;
 onCollectionChange:(id:string|null)=>void;
 onOpenBook:(id:string)=>void;
 onImport:()=>void;
 importing:boolean;
 saving:boolean;
 save:(next:Notebook,feedback:string)=>Promise<boolean>;
 onOpenDetached:()=>void;
 zoteroStatus?:ZoteroConnectionStatus;
 onRefreshZotero?:()=>void;
};
type FolderAction={kind:'create'}|{kind:'rename'|'remove';id:string}|{kind:'move';bookId:string};
type CollectionNode=ReturnType<typeof zoteroCollectionTree>[number];

function collectionNodes(nodes:CollectionNode[]):CollectionNode[]{
 return nodes.flatMap(node=>[node,...collectionNodes(node.children)]);
}

function CollectionBranch({nodes,selected,onSelect,collapsed,onToggle}:{nodes:CollectionNode[];selected:string|null;onSelect:(id:string)=>void;collapsed:Set<string>;onToggle:(id:string)=>void}){
 return <ul className="folder-shelf-collection-branch">{nodes.map(node=>{
  const hasChildren=node.children.length>0;
  const expanded=!collapsed.has(node.id);
  return <li key={node.id}>
   <div className="folder-shelf-folder-row folder-shelf-collection-row" data-selected={selected===node.id}>
    {hasChildren?<button type="button" className="folder-shelf-collection-toggle" aria-expanded={expanded} aria-label={`${expanded?'折叠':'展开'}分类 ${node.name}`} onClick={()=>onToggle(node.id)}>{expanded?<ChevronDown aria-hidden="true"/>:<ChevronRight aria-hidden="true"/>}</button>:<span className="folder-shelf-collection-spacer" aria-hidden="true"/>}
    <button type="button" className="folder-shelf-folder" aria-pressed={selected===node.id} title={node.name} onClick={()=>onSelect(node.id)}><Folder aria-hidden="true"/><span>{node.name}</span><small>{node.count}</small></button>
   </div>
   {hasChildren&&expanded&&<CollectionBranch nodes={node.children} selected={selected} onSelect={onSelect} collapsed={collapsed} onToggle={onToggle}/>}
  </li>;
 })}</ul>;
}

export function LibraryShelf({data,mode,onChooseLibrary,activeId,selectedFolder,onFolderChange,selectedCollection,onCollectionChange,onOpenBook,onImport,importing,saving,save,onOpenDetached,zoteroStatus,onRefreshZotero}:Props){
 const latest=useRef(data);
 useEffect(()=>{latest.current=data;},[data]);
 const [query,setQuery]=useState('');
 const [action,setAction]=useState<FolderAction|null>(null);
 const [name,setName]=useState('');
 const [destination,setDestination]=useState('');
 const [error,setError]=useState('');
 const [working,setWorking]=useState(false);
 const [collapsedCollections,setCollapsedCollections]=useState<Set<string>>(()=>new Set());
 const pending=useRef(false);
 const isZotero=mode==='zotero';
 const modeBooks=libraryBooksForMode(data,mode);
 const folders=normalizeLibraryFolders(data.libraryFolders);
 const folderIds=new Set(folders.map(folder=>folder.id));
 const groupOf=(folderId:string|undefined)=>folderId&&folderIds.has(folderId)?folderId:'';
 const effectiveFolder=selectedFolder&& !folderIds.has(selectedFolder)?null:selectedFolder;
 const collections=isZotero?zoteroCollectionTree(data):[];
 const allCollections=collectionNodes(collections);
 const effectiveCollection=selectedCollection&&!allCollections.some(collection=>collection.id===selectedCollection)?null:selectedCollection;
 const folderBooks=isZotero?libraryBooksForZoteroCollection(data,effectiveCollection):modeBooks.filter(book=>effectiveFolder===null||groupOf(book.folderId)===effectiveFolder);
 const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const books=folderBooks.filter(book=>words.every(word=>`${book.title} ${book.author||''}`.toLocaleLowerCase().includes(word)));
 const uncategorized=isZotero?libraryBooksForZoteroCollection(data,'').length:modeBooks.filter(book=>!groupOf(book.folderId)).length;
 const folderCounts=new Map<string,number>();
 for(const book of modeBooks){const id=groupOf(book.folderId);folderCounts.set(id,(folderCounts.get(id)||0)+1);}
 const selectedName=isZotero?(effectiveCollection===null?'全部文献':effectiveCollection===''?'未分类':allCollections.find(collection=>collection.id===effectiveCollection)?.name||'全部文献'):(effectiveFolder===null?'全部图书':effectiveFolder===''?'未分类':folders.find(folder=>folder.id===effectiveFolder)?.name||'全部图书');
 const detachedCount=data.bookThoughts.filter(entry=>!entry.libraryBookId).length;
 const editingFolder=action&&(action.kind==='rename'||action.kind==='remove')?folders.find(folder=>folder.id===action.id):undefined;
 const movingBook=action?.kind==='move'?data.libraryBooks.find(book=>book.id===action.bookId):undefined;
 const busy=working||saving;

 function toggleCollection(id:string){
  setCollapsedCollections(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
 }

 function start(next:FolderAction){
  setError('');
  setAction(next);
  setName(next.kind==='rename'?folders.find(folder=>folder.id===next.id)?.name||'':'');
  setDestination(next.kind==='move'?groupOf(data.libraryBooks.find(book=>book.id===next.bookId)?.folderId):'');
 }
 function close(){if(!pending.current){setAction(null);setError('');}}
 async function submit(event:React.FormEvent){
  event.preventDefault();
  if(isZotero||!action||pending.current||saving)return;
  pending.current=true;setWorking(true);setError('');
  try{
   const current=latest.current;
   let next:Notebook;
   let feedback:string;
   let newFolderId:string|null=null;
   switch(action.kind){
    case 'create':{
     newFolderId=crypto.randomUUID();
     next=addLibraryFolder(current,{id:newFolderId,name});
     feedback='文件夹已创建';
     break;
    }
    case 'rename':next=renameLibraryFolder(current,action.id,name);feedback='文件夹已改名';break;
    case 'remove':next=removeLibraryFolder(current,action.id);feedback='文件夹已移除，书籍已归入未分类';break;
    case 'move':next=assignBookFolder(current,action.bookId,destination||null);feedback=destination?'书籍已移入文件夹':'书籍已移回未分类';break;
   }
   if(!await save(next,feedback)){setError('未能保存，请重试。当前窗口中的内容仍然保留。');return;}
   if(newFolderId)onFolderChange(newFolderId);
   if(action.kind==='remove'&&selectedFolder===action.id)onFolderChange('');
   setAction(null);
  }catch(cause){setError(cause instanceof Error?cause.message:'未能保存，请重试。');}
  finally{pending.current=false;setWorking(false);}
 }

 return <aside className="library-shelf folder-library-shelf">
  <header className="folder-shelf-header"><div>{onChooseLibrary&&<Button type="button" variant="ghost" size="icon-xs" className="folder-shelf-back" title="返回书库选择" aria-label="返回书库选择" onClick={onChooseLibrary}><ArrowLeft/></Button>}{isZotero?<span className="folder-shelf-zotero-mark" aria-hidden="true">Z</span>:<BookOpen aria-hidden="true"/>}<DialogTitle>{isZotero?'Zotero':'读书'}</DialogTitle></div>{!isZotero&&<Button type="button" variant="ghost" size="icon-sm" title="导入 PDF / EPUB" aria-label="导入书籍" disabled={importing||busy} onClick={onImport}>{importing?<Loader2 className="spin"/>:<FilePlus2/>}</Button>}</header>
  <DialogDescription className="sr-only">{isZotero?'浏览从 Zotero 同步的文献和分类，选择文献开始阅读。':'按文件夹整理书籍，选择一本书开始阅读。'}</DialogDescription>
  {isZotero&&zoteroStatus&&<section className="folder-shelf-zotero" aria-label="Zotero 联动状态" data-state={zoteroStatus.state}><div role="status" title={zoteroStatus.message}><span className="folder-zotero-indicator"/>{zoteroStatus.state==='connecting'?'正在更新 Zotero':zoteroStatus.state==='connected'?`Zotero 已连接${typeof zoteroStatus.items==='number'?` · ${zoteroStatus.items} 篇`:''}`:zoteroStatus.state==='offline'?'Zotero 未连接':'Zotero 更新未完成'}</div>{onRefreshZotero&&<Button type="button" variant="ghost" size="icon-xs" aria-label="更新 Zotero 文献与摘录" title={zoteroStatus.lastSyncedAt?`上次更新：${new Date(zoteroStatus.lastSyncedAt).toLocaleString('zh-CN')}，点击再次更新`:'更新 Zotero 文献与摘录'} disabled={zoteroStatus.state==='connecting'||busy} onClick={onRefreshZotero}><RefreshCw className={zoteroStatus.state==='connecting'?'spin':undefined}/></Button>}{zoteroStatus.message&&zoteroStatus.state!=='connected'&&<p>{zoteroStatus.message}</p>}</section>}
  <div className="folder-shelf-search"><Search aria-hidden="true"/><Input aria-label={isZotero?'搜索文献或作者':'搜索书名或作者'} placeholder={isZotero?'搜索文献或作者':'搜索书名或作者'} value={query} onChange={event=>setQuery(event.target.value)}/>{query&&<Button type="button" variant="ghost" size="icon-xs" aria-label={isZotero?'清除文献搜索':'清除书籍搜索'} onClick={()=>setQuery('')}><X/></Button>}</div>
  {isZotero?<section className="folder-shelf-folders folder-shelf-collections" aria-label="Zotero 分类">
   <div className="folder-shelf-section-heading"><span>分类</span><small>来自 Zotero</small></div>
   <nav aria-label="选择 Zotero 分类">
    <div className="folder-shelf-folder-row"><button type="button" className="folder-shelf-folder" aria-pressed={effectiveCollection===null} onClick={()=>onCollectionChange(null)}><Library aria-hidden="true"/><span>全部文献</span><small>{modeBooks.length}</small></button></div>
    <div className="folder-shelf-folder-row"><button type="button" className="folder-shelf-folder" aria-pressed={effectiveCollection===''} onClick={()=>onCollectionChange('')}><BookOpen aria-hidden="true"/><span>未分类</span><small>{uncategorized}</small></button></div>
    <CollectionBranch nodes={collections} selected={effectiveCollection} onSelect={onCollectionChange} collapsed={collapsedCollections} onToggle={toggleCollection}/>
   </nav>
  </section>:<section className="folder-shelf-folders" aria-label="图书分类">
   <div className="folder-shelf-section-heading"><span>文件夹</span><Button type="button" variant="ghost" size="icon-xs" aria-label="新建图书文件夹" title="新建文件夹" disabled={busy} onClick={()=>start({kind:'create'})}><FolderPlus/></Button></div>
   <nav aria-label="选择图书文件夹">
    <div className="folder-shelf-folder-row"><button type="button" className="folder-shelf-folder" aria-pressed={effectiveFolder===null} onClick={()=>onFolderChange(null)}><Library aria-hidden="true"/><span>全部图书</span><small>{modeBooks.length}</small></button></div>
    <div className="folder-shelf-folder-row"><button type="button" className="folder-shelf-folder" aria-pressed={effectiveFolder===''} onClick={()=>onFolderChange('')}><BookOpen aria-hidden="true"/><span>未分类</span><small>{uncategorized}</small></button></div>
    {folders.map(folder=><div className="folder-shelf-folder-row" key={folder.id} data-selected={effectiveFolder===folder.id}><button type="button" className="folder-shelf-folder" aria-pressed={effectiveFolder===folder.id} title={folder.name} onClick={()=>onFolderChange(folder.id)}><Folder aria-hidden="true"/><span>{folder.name}</span><small>{folderCounts.get(folder.id)||0}</small></button><div className="folder-shelf-folder-actions"><Button type="button" variant="ghost" size="icon-xs" aria-label={`重命名文件夹 ${folder.name}`} title="重命名" disabled={busy} onClick={()=>start({kind:'rename',id:folder.id})}><Pencil/></Button><Button type="button" variant="ghost" size="icon-xs" aria-label={`移除文件夹 ${folder.name}`} title="移除文件夹" disabled={busy} onClick={()=>start({kind:'remove',id:folder.id})}><Trash2/></Button></div></div>)}
   </nav>
  </section>}
  <section className="folder-shelf-books" aria-label={`${selectedName}中的${isZotero?'文献':'图书'}`}>
   <div className="folder-shelf-book-heading"><span title={selectedName}>{selectedName}</span><small>{query.trim()?`${books.length} / ${folderBooks.length}`:folderBooks.length} {isZotero?'篇':'本'}</small></div>
   <div className="folder-shelf-book-list">
    {books.map(book=><article key={book.id} className={`folder-shelf-book${activeId===book.id?' is-current':''}`}><button type="button" className="folder-shelf-open-book" aria-current={activeId===book.id?'true':undefined} title={book.title} onClick={()=>onOpenBook(book.id)}><span className="folder-shelf-book-format">{book.format==='reference'?'文献':book.format.toUpperCase()}{book.zotero&&<span className="folder-shelf-zotero-badge" title="来自 Zotero">Z</span>}</span><strong>{book.title}</strong><small>{book.author||'作者未填写'}{book.progress.page?` · 第 ${book.progress.page} 页`:''}</small></button>{!isZotero&&<Button type="button" variant="ghost" size="icon-xs" className="folder-shelf-move" title="移动到文件夹" aria-label={`移动《${book.title}》到文件夹`} disabled={busy} onClick={()=>start({kind:'move',bookId:book.id})}><FolderInput/></Button>}</article>)}
    {!books.length&&<div className="folder-shelf-empty"><Folder aria-hidden="true"/><p>{query.trim()?`没有找到匹配的${isZotero?'文献':'书籍'}`:isZotero?(effectiveCollection===null?'还没有同步的文献':'这个分类还没有文献'):effectiveFolder===null?'还没有导入书籍':'这个文件夹还没有书籍'}</p>{query.trim()?<Button type="button" variant="ghost" size="sm" onClick={()=>setQuery('')}>清除搜索</Button>:isZotero?<small>{effectiveCollection===null?'打开 Zotero 后，文献与分类会自动同步。':'在 Zotero 中整理分类后，这里会自动更新。'}</small>:effectiveFolder===null?<Button type="button" variant="outline" size="sm" disabled={importing||busy} onClick={onImport}>导入书籍</Button>:<small>从“全部图书”中移动书籍到这里，也可以直接导入。</small>}</div>}
   </div>
  </section>
  {!isZotero&&!!detachedCount&&<footer className="folder-shelf-footer"><Button type="button" variant="ghost" size="sm" onClick={onOpenDetached}>保留的读书笔记 <span>{detachedCount}</span></Button></footer>}
  <Dialog open={!isZotero&&!!action} onOpenChange={open=>{if(!open)close();}}><DialogContent className="folder-shelf-dialog" showCloseButton={!working} onEscapeKeyDown={event=>{if(working)event.preventDefault();}} onInteractOutside={event=>{if(working)event.preventDefault();}}><DialogTitle>{action?.kind==='create'?'新建文件夹':action?.kind==='rename'?'重命名文件夹':action?.kind==='remove'?'移除文件夹':'移动书籍'}</DialogTitle><DialogDescription>{action?.kind==='remove'?`移除“${editingFolder?.name||'此文件夹'}”后，里面的 ${editingFolder?folderCounts.get(editingFolder.id)||0:0} 本书会回到“未分类”。书籍、笔记和阅读进度均会保留。`:action?.kind==='move'?`《${movingBook?.title||'此书'}》`:'用你自己的方式整理书籍。'}</DialogDescription><form onSubmit={submit}>
   {(action?.kind==='create'||action?.kind==='rename')&&<label>文件夹名称<Input autoFocus value={name} onChange={event=>setName(event.target.value)} placeholder="例如：哲学、历史、待读" maxLength={LIBRARY_FOLDER_NAME_LIMIT} required disabled={busy}/></label>}
   {action?.kind==='move'&&<label>移动到<NativeSelect aria-label="目标文件夹" value={destination} onChange={event=>setDestination(event.target.value)} disabled={busy}><NativeSelectOption value="">未分类</NativeSelectOption>{folders.map(folder=><NativeSelectOption key={folder.id} value={folder.id}>{folder.name}</NativeSelectOption>)}</NativeSelect></label>}
   {error&&<p className="folder-shelf-error" role="alert">{error}</p>}
   <footer><Button type="button" variant="outline" disabled={working} onClick={close}>取消</Button><Button type="submit" variant={action?.kind==='remove'?'destructive':'default'} disabled={busy||((action?.kind==='create'||action?.kind==='rename')&&!name.trim())}>{working?<><Loader2 className="spin"/>保存中…</>:action?.kind==='remove'?'移除文件夹，保留书籍':action?.kind==='move'?'移动':action?.kind==='create'?'创建文件夹':'保存'}</Button></footer>
  </form></DialogContent></Dialog>
 </aside>;
}
