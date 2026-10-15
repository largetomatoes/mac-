'use client';
import {type ReactNode,type RefObject} from 'react';
import {X} from 'lucide-react';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from './ui/sheet';
import {isMobileReader} from '@/lib/reader-platform';
export function BookNotesPanel({open,onOpenChange,panelRef,children}:{open:boolean;onOpenChange:(value:boolean)=>void;panelRef:RefObject<HTMLDivElement|null>;children:ReactNode}){
 if(isMobileReader())return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent ref={panelRef} className="book-thoughts-sheet"><SheetTitle className="sr-only">读书笔记</SheetTitle><SheetDescription className="sr-only">按章节阅读笔记与来源</SheetDescription>{children}</SheetContent></Sheet>;
 return open?<div ref={panelRef} className="book-thoughts-sheet reader-notes-panel" role="complementary" aria-label="本书笔记" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onOpenChange(false);}}}><button className="reader-notes-close" aria-label="收起本书笔记" onClick={()=>onOpenChange(false)}><X size={17}/></button>{children}</div>:null;
}
