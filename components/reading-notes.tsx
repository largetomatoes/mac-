"use client";

import { useMemo, useState } from "react";
import { BookOpen, Check, ChevronDown, CornerDownRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Notebook, ReadingNote, Thought, ThoughtReply } from "@/lib/notebook";

type Props = {
  data: Notebook;
  questionId: string;
  saving: boolean;
  save: (next: Notebook, feedback: string) => Promise<boolean>;
};

const origins = ["自己的思考", "材料触发的想法", "引用他人观点"];
const clean = (value: string) => value.trim().replace(/\s+/g, " ");
const keyOf = (value: string) => clean(value).toLocaleLowerCase("zh-CN");
const when = (at: string) => new Date(at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const excerpt = (text: string, length = 90) => text.length > length ? `${text.slice(0, length)}…` : text;

export function ReadingNotes({ data, questionId, saving, save }: Props) {
  const notes = data.readingNotes.filter((note) => note.questionIds.includes(questionId));
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [book, setBook] = useState("");
  const [author, setAuthor] = useState("");
  const [chapter, setChapter] = useState("");
  const [locator, setLocator] = useState("");
  const [quote, setQuote] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [thought, setThought] = useState("");
  const [origin, setOrigin] = useState(origins[0]);
  const [changed, setChanged] = useState(false);
  const [reason, setReason] = useState("");
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const selected = data.readingNotes.find((note) => note.id === selectedId);
  const books = useMemo(() => Array.from(new Set(data.readingNotes.map((note) => clean(note.book)))), [data.readingNotes]);
  const authors = useMemo(() => Array.from(new Set(data.readingNotes.map((note) => clean(note.author)))), [data.readingNotes]);
  const chapters = useMemo(() => Array.from(new Set(data.readingNotes.filter((note) => keyOf(note.book) === keyOf(book)).map((note) => clean(note.chapter)))), [data.readingNotes, book]);
  const groups = useMemo(() => {
    const grouped = new Map<string, { book: string; author: string; chapters: Map<string, { chapter: string; notes: ReadingNote[] }> }>();
    for (const note of notes) {
      const bookKey = `${keyOf(note.book)}|${keyOf(note.author)}`;
      const bookGroup = grouped.get(bookKey) || { book: clean(note.book), author: clean(note.author), chapters: new Map<string, { chapter: string; notes: ReadingNote[] }>() };
      const chapterKey = keyOf(note.chapter);
      const chapterGroup = bookGroup.chapters.get(chapterKey) || { chapter: clean(note.chapter), notes: [] as ReadingNote[] };
      chapterGroup.notes.push(note);
      chapterGroup.notes.sort((a, b) => a.at.localeCompare(b.at));
      bookGroup.chapters.set(chapterKey, chapterGroup);
      grouped.set(bookKey, bookGroup);
    }
    return Array.from(grouped.values());
  }, [notes]);

  async function createNote(event: React.FormEvent) {
    event.preventDefault();
    const newNote: ReadingNote = {
      id: crypto.randomUUID(), questionIds: [questionId], book: clean(book), author: clean(author), chapter: clean(chapter), locator: clean(locator),
      quote: quote.trim(), interpretation: interpretation.trim(), at: new Date().toISOString(), thoughts: [],
    };
    if (await save({ ...data, readingNotes: [...data.readingNotes, newNote] }, "阅读笔记已保存")) {
      setCreating(false); setSelectedId(newNote.id); setQuote(""); setInterpretation(""); setLocator("");
    }
  }

  async function appendThought(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !thought.trim() || (changed && !reason.trim())) return;
    const nextThought: Thought = { id: crypto.randomUUID(), text: thought.trim(), origin, reason: changed ? reason.trim() : "", at: new Date().toISOString() };
    const next = { ...data, readingNotes: data.readingNotes.map((note) => note.id === selected.id ? { ...note, thoughts: [...note.thoughts, nextThought] } : note) };
    if (await save(next, "思考已保存")) { setThought(""); setReason(""); setChanged(false); }
  }

  async function saveReply(event: React.FormEvent) {
    event.preventDefault();
    if (!replyingId || !replyText.trim() || data.thoughtReplies.some((reply) => reply.thoughtId === replyingId)) return;
    const reply: ThoughtReply = { id: crypto.randomUUID(), thoughtId: replyingId, text: replyText.trim(), at: new Date().toISOString() };
    if (await save({ ...data, thoughtReplies: [...data.thoughtReplies, reply] }, "回答已保存")) { setReplyingId(null); setReplyText(""); }
  }

  const replyingThought = selected?.thoughts.find((entry) => entry.id === replyingId);
  const replyRecord = data.thoughtReplies.find((reply) => reply.thoughtId === replyingId);

  return <section className="reading-section">
    <div className="reading-heading"><button type="button" className="reading-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><BookOpen size={17}/><strong>阅读笔记</strong><span>{notes.length}</span><ChevronDown size={16}/></button>{expanded && <Button variant="outline" size="sm" onClick={() => setCreating(true)}><Plus/>摘录原文</Button>}</div>
    {expanded && <>{!groups.length && <p className="reading-empty">暂无阅读笔记</p>}
    <div className="book-groups">{groups.map((group) => <section className="book-group" key={`${group.book}|${group.author}`}>
      <header><BookOpen size={16}/><div><strong>《{group.book}》</strong><span>{group.author}</span></div></header>
      {Array.from(group.chapters.values()).map((chapterGroup) => <details className="chapter-group" key={chapterGroup.chapter}>
        <summary><ChevronDown size={15}/><span>{chapterGroup.chapter}</span><small>{chapterGroup.notes.length} 段</small></summary>
        <div className="passage-grid">{chapterGroup.notes.map((reading) => <button key={reading.id} className="passage-block" onClick={() => setSelectedId(reading.id)}>
          <span>{reading.locator || "原文"}</span><p>{excerpt(reading.quote)}</p><footer>{reading.thoughts.length ? `${reading.thoughts.length} 条后续思考` : "查看理解"}</footer>
        </button>)}</div>
      </details>)}
    </section>)}</div></>}

    <Dialog open={creating} onOpenChange={setCreating}><DialogContent className="reading-create-dialog"><DialogTitle>摘录原文</DialogTitle><DialogDescription>每段原文独立保存，同一本书的同一章节会自动集合。</DialogDescription><form onSubmit={createNote} className="reading-create-form">
      <div className="source-fields"><label>书名<Input list="reading-books" value={book} onChange={(e) => setBook(e.target.value)} required/><datalist id="reading-books">{books.map((value) => <option key={value} value={value}/>)}</datalist></label><label>作者<Input list="reading-authors" value={author} onChange={(e) => setAuthor(e.target.value)} required/><datalist id="reading-authors">{authors.map((value) => <option key={value} value={value}/>)}</datalist></label></div>
      <div className="source-fields"><label>章节<Input list="reading-chapters" value={chapter} onChange={(e) => setChapter(e.target.value)} required/><datalist id="reading-chapters">{chapters.map((value) => <option key={value} value={value}/>)}</datalist></label><label>页码或段落编号<Input value={locator} onChange={(e) => setLocator(e.target.value)}/></label></div>
      <label>原文<Textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={7} required/></label>
      <label>我的理解<Textarea value={interpretation} onChange={(e) => setInterpretation(e.target.value)} rows={5} required/></label>
      <div className="form-actions"><Button type="button" variant="ghost" onClick={() => setCreating(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving}><Check/>保存</Button></div>
    </form></DialogContent></Dialog>

    <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}><SheetContent className="reading-sheet"><div className="reading-sheet-head"><span>{selected?.book} · {selected?.chapter}</span><SheetTitle>阅读笔记</SheetTitle><SheetDescription>{selected?.author}{selected?.locator ? ` · ${selected.locator}` : ""}</SheetDescription></div>{selected && <div className="reading-sheet-scroll">
      <section className="reading-quote"><span>原文</span><blockquote>{selected.quote}</blockquote></section>
      <section className="reading-interpretation"><span>我的理解</span><p>{selected.interpretation}</p><small>{when(selected.at)}</small></section>
      {!!selected.thoughts.length && <section className="reading-thoughts"><h3>后来想到的</h3>{selected.thoughts.map((entry) => { const reply = data.thoughtReplies.find((item) => item.thoughtId === entry.id); return <button type="button" key={entry.id} onClick={() => { setReplyingId(entry.id); setReplyText(""); }}><small>{when(entry.at)} · {entry.origin}</small><p>{entry.text}</p>{entry.reason && <aside><strong>为什么改变判断</strong><p>{entry.reason}</p></aside>}<span className="thought-reply-state">{reply ? `已回答 · ${when(reply.at)}` : "回应这条思考"}</span></button>; })}</section>}
      <form className="reading-append" onSubmit={appendThought}><label>添加思考<Textarea value={thought} onChange={(e) => setThought(e.target.value)} rows={6} required placeholder="继续写下你的理解…"/></label><div><NativeSelect aria-label="思考来源" value={origin} onChange={(e) => setOrigin(e.target.value)}>{origins.map((value) => <NativeSelectOption key={value}>{value}</NativeSelectOption>)}</NativeSelect><label><input type="checkbox" checked={changed} onChange={(e) => setChanged(e.target.checked)}/>我改变了原来的判断</label></div>{changed && <label>为什么改变？<Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required/></label>}<Button type="submit" disabled={saving || !thought.trim() || (changed && !reason.trim())}><CornerDownRight/>保存思考</Button></form>
    </div>}</SheetContent></Sheet>

    <Dialog open={!!replyingId} onOpenChange={(open) => { if (!open && !saving) { setReplyingId(null); setReplyText(""); } }}><DialogContent className="thought-reply-dialog"><DialogTitle>回应这条思考</DialogTitle><DialogDescription>{replyingThought ? `${when(replyingThought.at)} · ${replyingThought.origin}` : ""}</DialogDescription>{replyingThought && <blockquote>{replyingThought.text}</blockquote>}{replyRecord ? <section className="saved-thought-reply"><span>我的回答 · {when(replyRecord.at)}</span><p>{replyRecord.text}</p></section> : <form onSubmit={saveReply}><label>我的回答<Textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} rows={7} autoFocus required placeholder="写下此刻对它的回应…"/></label><div className="form-actions"><Button type="button" variant="ghost" disabled={saving} onClick={() => { setReplyingId(null); setReplyText(""); }}>取消</Button><Button type="submit" disabled={saving || !replyText.trim()}><CornerDownRight/>保存回答</Button></div></form>}</DialogContent></Dialog>
  </section>;
}
