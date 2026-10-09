import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Network, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ReadingNotes } from '../components/reading-notes';
import { QuestionMap } from '../components/question-map';
import { ROOT, numberOf, crossNumber, crossSignature, itemText, type Notebook } from '../lib/notebook';
import { graphOwners } from '../lib/graph-projection';

export function boardLabel(data: Notebook, id: string) {
  const note = data.notes.find(item => item.id === id);
  const cross = data.crossThoughts.find(item => item.id === id);
  return note ? id === ROOT ? '核心问题' : numberOf(note, data.notes, data.crossThoughts) : cross ? `${crossNumber(cross)}〔${crossSignature(cross, data)}〕` : '卡片';
}

export function MobileQuestions({ data, selected, onSelect, saving, save, onOpenBook }: {
  data: Notebook; selected: string | null; onSelect: (id: string | null) => void;
  saving: boolean; save: (next: Notebook, feedback: string) => Promise<boolean>;
  onOpenBook: (id: string, location?: string, readingId?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [cardsOpen, setCardsOpen] = useState(false);
  const note = data.notes.find(item => item.id === selected);
  const cross = data.crossThoughts.find(item => item.id === selected);
  const card = data.cards.find(item => item.id === selected);
  const item = note || cross || card;
  const owners = graphOwners(data), owner = (id: string) => owners.get(id) || id;
  const related = new Set([
    ...(cross?.anchorIds || []).map(owner),
    ...data.crossThoughts.filter(item => item.anchorIds.some(id => owner(id) === selected)).map(item => item.id),
    ...data.links.filter(link => owner(link.from) === selected || owner(link.to) === selected).map(link => owner(link.from) === selected ? owner(link.to) : owner(link.from)),
  ]);
  const children = data.notes.filter(item => item.parent === selected).sort((a, b) => a.order - b.order);
  const matches = [...data.notes, ...data.crossThoughts, ...data.cards].filter(item => itemText(data, item.id).toLowerCase().includes(query.trim().toLowerCase()));
  const openBook = (id: string, location?: string, readingId?: string) => { onSelect(null); onOpenBook(id, location, readingId); };
  const row = (id: string) => <button type="button" className="mobile-board-row" key={id} onClick={() => onSelect(id)}><span>{boardLabel(data, id)}</span><strong>{itemText(data, id)}</strong><ArrowUpRight size={16}/></button>;
  return <section className="mobile-questions">
    <div className="mobile-map-search"><Search size={18}/><input aria-label="查找问题或卡片" placeholder="找一个问题" value={query} onChange={event => setQuery(event.target.value)}/><button type="button" onClick={() => setCardsOpen(true)}>卡片集</button></div>
    {query.trim() ? <div className="mobile-board-results">{matches.map(item => row(item.id))}{!matches.length && <p>没有找到相关问题</p>}</div> : <div className="mobile-map-frame"><QuestionMap data={data} loading={false} onOpen={onSelect} mobile/></div>}
    <Dialog open={!!item} onOpenChange={open => { if (!open) onSelect(null); }}><DialogContent className="mobile-question-dialog" showCloseButton={false}>
      <header className="mobile-detail-header"><button type="button" aria-label="返回关系图" onClick={() => onSelect(null)}><ArrowLeft size={22}/></button><div><DialogDescription>{selected && boardLabel(data, selected)}</DialogDescription><DialogTitle>{selected && itemText(data, selected)}</DialogTitle></div></header>
      <div className="mobile-question-scroll" key={selected}>
        {(note?.body || cross?.text || card?.text) && <section className="mobile-original"><h3>最初记录</h3><p>{note?.body || cross?.text || card?.text}</p>{item?.origin && <small>{item.origin}</small>}{item?.source && <small>来源：{item.source}</small>}</section>}
        {note?.parent && row(note.parent)}
        {!!children.length && <section><h3>子问题与回答</h3>{children.map(item => row(item.id))}</section>}
        {!!related.size && <section><h3><Network size={16}/>关联主题</h3>{[...related].filter(id => itemText(data, id)).map(row)}</section>}
        {(note || cross) && <ReadingNotes data={data} questionId={selected} saving={saving} save={save} onOpenBook={openBook}/>}
        <section className="mobile-thoughts"><h3>后来想到的 <small>{item?.thoughts?.length || 0}</small></h3>{item?.thoughts?.map(thought => {
          const reply = data.thoughtReplies.find(item => item.thoughtId === thought.id);
          return <article key={thought.id}><small>{new Date(thought.at).toLocaleString('zh-CN')} · {thought.origin}</small><p>{thought.text}</p>{thought.reason && <aside>修改原因：{thought.reason}</aside>}{reply && <aside><small>我的回答 · {new Date(reply.at).toLocaleString('zh-CN')}</small><p>{reply.text}</p></aside>}</article>;
        })}{!item?.thoughts?.length && <p className="mobile-muted">暂无后续思考</p>}</section>
        {!!note?.revisions.length && <details className="mobile-revisions"><summary>修改记录 · {note.revisions.length}</summary>{note.revisions.map((revision, index) => <article key={index}><small>{new Date(revision.at).toLocaleString('zh-CN')}</small><h4>{revision.title}</h4><p>{revision.body}</p><aside>{revision.reason}</aside></article>)}</details>}
        {!!cross?.anchorRevisions.length && <details className="mobile-revisions"><summary>连接修改记录 · {cross.anchorRevisions.length}</summary>{cross.anchorRevisions.map((revision, index) => <article key={index}><small>{new Date(revision.at).toLocaleString('zh-CN')}</small><p>{revision.fromLabel || revision.from.map(id => boardLabel(data, id)).join(' ↔ ')} → {revision.toLabel || revision.to.map(id => boardLabel(data, id)).join(' ↔ ')}</p><aside>{revision.reason}</aside></article>)}</details>}
      </div>
    </DialogContent></Dialog>
    <Dialog open={cardsOpen} onOpenChange={setCardsOpen}><DialogContent className="mobile-card-dialog"><DialogTitle>卡片集</DialogTitle><DialogDescription>原话与后来想到的分别保留。</DialogDescription><div>{data.cards.map(card => <button type="button" className="mobile-board-row" key={card.id} onClick={() => { setCardsOpen(false); onSelect(card.id); }}><strong>{card.text}</strong><ArrowUpRight size={16}/></button>)}{!data.cards.length && <p>暂无卡片</p>}</div></DialogContent></Dialog>
  </section>;
}
