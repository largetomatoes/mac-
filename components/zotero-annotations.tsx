'use client';

import {ExternalLink,NotebookPen} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {LibraryBook,ZoteroAnnotation} from '@/lib/notebook';
import './zotero-annotations.css';

type Props={book:LibraryBook;focusedKey?:string|null;opening:boolean;onOpen:(annotation:ZoteroAnnotation)=>void;onThink:(annotation:ZoteroAnnotation)=>void};
const annotationDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.valueOf())?'':date.toLocaleDateString('zh-CN');};

export function ZoteroAnnotations({book,focusedKey,opening,onOpen,onThink}:Props){
 const annotations=book.zotero?.annotations||[];
 if(!book.zotero)return null;
 const ordered=annotations;
 return <section className="zotero-annotations" aria-label="Zotero 摘录与批注"><h3>Zotero 摘录与批注 <span>{ordered.length}</span></h3>{!ordered.length?<p className="zotero-annotations-empty">在 Zotero 中划线或批注后，会自动更新到这里。</p>:ordered.map(annotation=><article key={annotation.key} data-zotero-annotation-id={annotation.key} className={focusedKey===annotation.key?'is-focused':undefined}><header><span>{annotation.pageLabel?`第 ${annotation.pageLabel} 页`:annotation.page?`第 ${annotation.page} 页`:'文献批注'}{annotation.attachmentKey!==book.zotero?.attachmentKey?' · 其他附件':''}</span><time>{annotationDate(annotation.modifiedAt||annotation.at)}</time></header>{annotation.text&&<blockquote>{annotation.text}</blockquote>}{annotation.comment&&<div className="zotero-annotation-comment"><small>Zotero 中的批注</small><p>{annotation.comment}</p></div>}{!annotation.text&&!annotation.comment&&<p className="zotero-annotation-image">这是一处{annotation.type==='image'?'图片':annotation.type==='ink'?'手写':'原文'}标注，可回 Zotero 查看。</p>}<footer><Button type="button" size="sm" variant="ghost" onClick={()=>onThink(annotation)}><NotebookPen/>写自己的思考</Button><Button type="button" size="sm" variant="ghost" disabled={opening} onClick={()=>onOpen(annotation)}><ExternalLink/>回到原文</Button></footer></article>)}</section>;
}
