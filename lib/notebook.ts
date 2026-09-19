export type Revision = { title:string; body:string; origin:string; source:string; reason:string; at:string };
export type Thought = { id:string; text:string; origin:string; reason:string; at:string };
export type ThoughtReply = { id:string; thoughtId:string; text:string; at:string };
export type Note = { id:string; kind:'question'|'answer'; parent:string|null; order:number; title:string; body:string; origin:string; source:string; revisions:Revision[]; thoughts?:Thought[] };
export type Card = { id:string; text:string; origin:string; source:string; at:string; thoughts:Thought[] };
export type ReadingNote = { id:string; questionIds:string[]; book:string; author:string; chapter:string; locator:string; quote:string; interpretation:string; at:string; thoughts:Thought[]; libraryBookId?:string; sourceLocation?:string };
export type LibraryBook = { id:string; title:string; author:string; format:'pdf'|'epub'; storedFile:string; originalName:string; addedAt:string; progress:{page?:number;totalPages?:number;cfi?:string;percentage?:number;rotation?:0|90|180|270} };
export type LibraryHighlight = { id:string; libraryBookId:string; quote:string; locator:string; sourceLocation:string; at:string };
export type OcrLine = { text:string; x0:number; y0:number; x1:number; y1:number };
export type OcrCacheEntry = { libraryBookId:string; page:number; text:string; lines?:OcrLine[]; at:string };
export type BookThought = { id:string; libraryBookId?:string; bookTitle:string; text:string; scope:'book'|'location'; locator:string; sourceLocation?:string; questionIds:string[]; at:string; thoughts:Thought[] };
export type CrossAnchorRevision = { from:string[]; to:string[]; fromLabel?:string; toLabel?:string; at:string; reason:string };
export type CrossThought = { title?:string; id:string; order:number; anchorIds:string[]; anchorRevisions:CrossAnchorRevision[]; text:string; origin:string; source:string; at:string; thoughts:Thought[] };
export type ManuscriptLink = { id:string; questionId:string; targetKind?:'question'|'reading'; quote:string; start:number; end:number; prefix:string; suffix:string; at:string; unresolved?:boolean };
export type ManuscriptRevision = { title:string; body:string; links:ManuscriptLink[]; at:string };
export type Manuscript = { id:string; title:string; body:string; links:ManuscriptLink[]; at:string; updatedAt:string; revisions:ManuscriptRevision[] };
export type Link = { id:string; from:string; to:string; type:string };
export type Notebook = { notes:Note[]; links:Link[]; cards:Card[]; readingNotes:ReadingNote[]; crossThoughts:CrossThought[]; thoughtReplies:ThoughtReply[]; manuscripts:Manuscript[]; libraryBooks:LibraryBook[]; libraryHighlights:LibraryHighlight[]; ocrCache:OcrCacheEntry[]; bookThoughts:BookThought[]; dismissedSuggestions:string[] };
export const ROOT='world';
export const exampleCard:Card={id:'wittgenstein-honesty',text:'维特根斯坦对诚实的要求，我们可以在这里看到像他这种人和世界的接口。',origin:'材料触发的想法',source:'',at:'',thoughts:[]};
export const initialNotebook:Notebook = { notes:[
 {id:ROOT,kind:'question',parent:null,order:1,title:'我们该如何处理我们和世界的关系？',body:'',origin:'自己的推演',source:'',revisions:[],thoughts:[]},
 {id:'language',kind:'question',parent:ROOT,order:2,title:'我们与言语结构、动机的关系是什么？',body:'',origin:'自己的推演',source:'',revisions:[],thoughts:[]}
],links:[],cards:[exampleCard],readingNotes:[],crossThoughts:[],thoughtReplies:[],manuscripts:[],libraryBooks:[],libraryHighlights:[],ocrCache:[],bookThoughts:[],dismissedSuggestions:[] };
export function normalize(data:Partial<Notebook>):Notebook {
 const usedOrders=new Set<number>();
 const crossThoughts=(data.crossThoughts||[]).map(n=>{
  let order=Number.isInteger(n.order)&&n.order>0&&!usedOrders.has(n.order)?n.order:1;
  while(usedOrders.has(order))order++;
  usedOrders.add(order);
  return {...n,title:n.title?.trim()||undefined,order,anchorRevisions:n.anchorRevisions||[],thoughts:n.thoughts||[]};
 });
 return {...initialNotebook,...data,notes:(data.notes||initialNotebook.notes).map(n=>({...n,thoughts:n.thoughts||[]})),cards:(data.cards??[exampleCard]).map(c=>({...c,thoughts:c.thoughts||[]})),readingNotes:(data.readingNotes||[]).map(n=>({...n,thoughts:n.thoughts||[]})),crossThoughts,thoughtReplies:data.thoughtReplies||[],manuscripts:(data.manuscripts||[]).map(m=>({...m,links:(m.links||[]).map(link=>({...link,targetKind:link.targetKind||'question'})),revisions:(m.revisions||[]).map(r=>({...r,links:(r.links||[]).map(link=>({...link,targetKind:link.targetKind||'question'}))}))})),libraryBooks:(data.libraryBooks||[]).map(book=>({...book,author:book.author||'',progress:book.progress||{}})),libraryHighlights:data.libraryHighlights||[],ocrCache:data.ocrCache||[],bookThoughts:(data.bookThoughts||[]).map(entry=>({...entry,scope:entry.scope||'book',locator:entry.locator||'',questionIds:entry.questionIds||[],thoughts:entry.thoughts||[]})),dismissedSuggestions:data.dismissedSuggestions||[]};
}
export function crossNumber(c:CrossThought){return `X${c.order}`;}
export function numberOf(n:Note,notes:Note[],crossThoughts:CrossThought[]=[]):string { if(n.kind==='answer')return '回答';if(!n.parent)return '';const siblings=notes.filter(x=>x.kind==='question'&&x.parent===n.parent).sort((a,b)=>a.order-b.order);const position=Math.max(1,siblings.findIndex(x=>x.id===n.id)+1);const p=notes.find(x=>x.id===n.parent);const cross=crossThoughts.find(x=>x.id===n.parent);const prefix=p?numberOf(p,notes,crossThoughts):cross?crossNumber(cross):'';return prefix?prefix+'.'+position:String(position); }
export function crossSignature(c:CrossThought,data:Notebook){return c.anchorIds.map(id=>{const n=data.notes.find(n=>n.id===id);return n?numberOf(n,data.notes,data.crossThoughts)||'核心':data.crossThoughts.find(x=>x.id===id)?crossNumber(data.crossThoughts.find(x=>x.id===id)!):'原连接';}).join(' ↔ ');}
export function itemText(data:Notebook,id:string){const c=data.cards.find(c=>c.id===id);return data.crossThoughts.find(c=>c.id===id)?.title||data.crossThoughts.find(c=>c.id===id)?.text||c?.text||data.notes.find(n=>n.id===id)?.title||'';}
const topics=[
 {name:'表达与语言',words:['诚实','言语','语言','表达','说话','谎言','沉默']},
 {name:'动机与行动',words:['动机','行动','意图','欲望','目的','选择']},
 {name:'人与世界的接触',words:['世界','接口','关系','经验','感知','现实']},
 {name:'自我与他人',words:['自我','他人','别人','理解','孤独','交流']},
 {name:'价值与判断',words:['价值','判断','道德','善恶','责任','诚实']}
];
export type Suggestion={key:string;from:string;to:string;reason:string};
export function suggestions(data:Notebook,card:Card):Suggestion[]{
 const text=[card.text,...card.thoughts.map(t=>t.text)].join(' ');
 return data.notes.map(n=>{const nt=[n.title,n.body,...(n.thoughts||[]).map(t=>t.text)].join(' ');const hits=topics.map(t=>({topic:t.name,a:t.words.find(w=>text.includes(w)),b:t.words.find(w=>nt.includes(w))})).filter(t=>t.a&&t.b);const key=card.id+':'+n.id;return {key,from:card.id,to:n.id,score:hits.length,reason:hits[0]?`卡片中的“${hits[0].a}”与这里的“${hits[0].b}”可能都涉及「${hits[0].topic}」。是否值得连起来？`:''};}).filter(s=>s.score&&!data.dismissedSuggestions.includes(s.key)&&!data.links.some(l=>(l.from===s.from&&l.to===s.to)||(l.from===s.to&&l.to===s.from))).sort((a,b)=>b.score-a.score).slice(0,3);
}
