import { useState, type ReactNode } from 'react';
import { ArrowLeft, Highlighter, MoreHorizontal, NotebookPen } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';

export function MobileReaderToolbar({ title, count, onBack, onNotes, onHighlights, search, navigation, tools }: {
  title: string; count: number; onBack: () => void; onNotes: () => void; onHighlights: () => void;
  search: ReactNode; navigation: ReactNode; tools: ReactNode;
}) {
  const [more, setMore] = useState(false);
  return <>
    <header className="mobile-reading-header"><button type="button" aria-label="返回书库" onClick={onBack}><ArrowLeft size={22}/></button><strong title={title}>{title}</strong>{search}<button type="button" aria-label={`本书笔记，${count} 条`} onClick={onNotes}><NotebookPen size={21}/></button><button type="button" aria-label="更多阅读操作" onClick={() => setMore(true)}><MoreHorizontal size={23}/></button></header>
    <footer className="mobile-reading-footer" aria-label="阅读翻页">{navigation}</footer>
    <Dialog open={more} onOpenChange={setMore}><DialogContent className="mobile-reader-options"><DialogTitle>阅读操作</DialogTitle><DialogDescription>{title}</DialogDescription><Button variant="outline" onClick={() => { setMore(false); onHighlights(); }}><Highlighter/>查看高亮</Button>{tools}</DialogContent></Dialog>
  </>;
}
