'use client';
import {useState} from 'react';
import {displayBook,type LibraryBook,type Notebook} from '@/lib/notebook';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {Input} from './ui/input';
export function BookMetadata({book,data,saving,onClose,save}:{book:LibraryBook;data:Notebook;saving:boolean;onClose:()=>void;save:(data:Notebook,feedback:string)=>Promise<boolean>}){
 const shown=displayBook(book),[title,setTitle]=useState(shown.title),[author,setAuthor]=useState(shown.author),[error,setError]=useState('');
 async function update(display:LibraryBook['display']){setError('');if(!display?.title?.trim()&&display){setError('请填写书名。');return;}if(await save({...data,libraryBooks:data.libraryBooks.map(b=>b.id===book.id?{...b,display:display??{}}:b)},'书目信息已更新'))onClose();}
 return <Dialog open onOpenChange={v=>{if(!v&&!saving)onClose();}}><DialogContent><DialogTitle>书目信息</DialogTitle><DialogDescription>仅修改问间显示信息，不改原文件或 Zotero。</DialogDescription><form onSubmit={e=>{e.preventDefault();void update({title:title.trim(),author:author.trim()});}} className="book-metadata-form"><label>书名<Input value={title} onChange={e=>setTitle(e.target.value)} maxLength={500} required/></label><label>作者<Input value={author} onChange={e=>setAuthor(e.target.value)} maxLength={300}/></label>{error&&<p role="alert">{error}</p>}<div><Button type="button" variant="outline" disabled={saving} onClick={()=>void update(undefined)}>恢复来源信息</Button><Button type="submit" disabled={saving||!title.trim()}>保存</Button></div></form></DialogContent></Dialog>;
}
