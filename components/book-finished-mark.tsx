import {Check} from 'lucide-react';
import {isBookFinished} from '@/lib/book-reading';
import type {LibraryBook} from '@/lib/notebook';
import './book-finished-mark.css';

export function BookFinishedMark({book}:{book:LibraryBook}){
 if(!isBookFinished(book))return null;
 return <span className="book-finished-check" role="img" aria-label="已读完" title={`已读完 · ${new Date(book.readingCompletion!.at).toLocaleDateString('zh-CN')}`}><Check aria-hidden="true"/></span>;
}
