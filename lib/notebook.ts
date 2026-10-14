import {normalizeLibraryFolders} from './library-folders';
import type {ManuscriptBlock} from './manuscript-materials';
export type Revision = { nextTitle?:string; title:string; body:string; origin:string; source:string; reason:string; at:string };
export type Thought = { id:string; text:string; origin:string; reason:string; at:string };
export type ThoughtReply = { id:string; thoughtId:string; text:string; at:string };
export type Note = { sourceCardId?:string; id:string; kind:'question'|'answer'; parent:string|null; order:number; title:string; body:string; origin:string; source:string; revisions:Revision[]; thoughts?:Thought[] };
export type Card = { kind?:'idea'|'question'; questionId?:string; id:string; text:string; origin:string; source:string; at:string; thoughts:Thought[] };
export type ReadingNote = { rawQuote?:string; id:string; questionIds:string[]; book:string; author:string; chapter:string; locator:string; quote:string; interpretation:string; at:string; thoughts:Thought[]; libraryBookId?:string; sourceLocation?:string; anchorY?:number };
export type PdfChapter = { id:string; title:string; startPage:number };
export type LibraryFolder = { id:string; name:string };
export type ZoteroCollection = { serverId:string; key:string; name:string; parentKey?:string };
export type ZoteroAnnotation = { key:string; type:string; text:string; comment:string; pageLabel:string; page?:number; position?:string; color?:string; at:string; modifiedAt?:string; attachmentKey:string };
export type ZoteroSource = { sourceFile?:string;author?:string; serverId:string; library:'users/0'; itemKey:string; attachmentKey?:string; itemVersion:number; itemType:string; title:string; date?:string; publisher?:string; doi?:string; isbn?:string; collections:string[]; annotations:ZoteroAnnotation[]; sourceAvailable?:boolean };
export type LibraryBook = { display?:{title?:string;author?:string}; hiddenZoteroAnnotations?:string[]; cloudFile?:{key:string;sha256:string;size:number}; id:string; title:string; author:string; format:'pdf'|'epub'|'reference'; storedFile:string; originalName:string; addedAt:string; progress:{page?:number;totalPages?:number;cfi?:string;percentage?:number;rotation?:0|90|180|270}; pdfChapters?:PdfChapter[]; folderId?:string; zotero?:ZoteroSource; inReadingLibrary?:boolean };
export type LibraryHighlight = { rawQuote?:string; id:string; libraryBookId:string; quote:string; locator:string; sourceLocation:string; at:string };
export type OcrWord = { text:string; x0:number; y0:number; x1:number; y1:number };
export type OcrLine = OcrWord & { words?:OcrWord[]; paragraph?:number };
export type OcrCacheEntry = { libraryBookId:string; page:number; text:string; lines?:OcrLine[]; version?:number; rotation?:number; preferOcr?:boolean; at:string };
export type BookThoughtSource = {id:string;libraryBookId?:string;bookTitle:string;author?:string;chapter?:string;locator:string;sourceLocation?:string;quote?:string;readingNoteId?:string;bookThoughtId?:string;noteText?:string};
export type BookThoughtRevision = {id:string;text:string;sources:BookThoughtSource[];questionIds:string[];at:string;reason:string};
export type BookThought = { rawQuote?:string; sources?:BookThoughtSource[]; revisions?:BookThoughtRevision[]; id:string; libraryBookId?:string; bookTitle:string; text:string; scope:'book'|'location'; locator:string; sourceLocation?:string; quote?:string; chapter?:string; questionIds:string[]; at:string; thoughts:Thought[] };
export type CrossAnchorRevision = { from:string[]; to:string[]; fromLabel?:string; toLabel?:string; at:string; reason:string };
export type QuestionPage = {id:string;rootId:string;kind:'question'|'collection';order:number;members:string[];archivedAt?:string};
export type CrossThought = { pageId?:string; title?:string; id:string; order:number; anchorIds:string[]; anchorRevisions:CrossAnchorRevision[]; text:string; origin:string; source:string; at:string; thoughts:Thought[] };
export type ManuscriptLink = { id:string; questionId:string; targetKind?:'question'|'reading'; quote:string; start:number; end:number; prefix:string; suffix:string; at:string; unresolved?:boolean };
export type ManuscriptRevision = { title:string; body:string; links:ManuscriptLink[]; blocks?:ManuscriptBlock[]; at:string };
export type Manuscript = { id:string; title:string; body:string; links:ManuscriptLink[]; blocks?:ManuscriptBlock[]; at:string; updatedAt:string; revisions:ManuscriptRevision[] };
export type Link = { id:string; from:string; to:string; type:string };
export type Notebook = { questionPages?:QuestionPage[]; setupCompleted?:boolean; zoteroEnabled?:boolean; notes:Note[]; links:Link[]; cards:Card[]; readingNotes:ReadingNote[]; crossThoughts:CrossThought[]; thoughtReplies:ThoughtReply[]; manuscripts:Manuscript[]; libraryBooks:LibraryBook[]; libraryFolders?:LibraryFolder[]; zoteroCollections?:ZoteroCollection[]; libraryHighlights:LibraryHighlight[]; ocrCache:OcrCacheEntry[]; bookThoughts:BookThought[]; dismissedSuggestions:string[] };
export const ROOT='world';
export const initialNotebook:Notebook = { setupCompleted:false,zoteroEnabled:false,notes:[
 {id:ROOT,kind:'question',parent:null,order:1,title:'核心问题',body:'',origin:'自己的思考',source:'',revisions:[],thoughts:[]}
],links:[],cards:[],readingNotes:[],crossThoughts:[],thoughtReplies:[],manuscripts:[],libraryBooks:[],libraryFolders:[],zoteroCollections:[],libraryHighlights:[],ocrCache:[],bookThoughts:[],dismissedSuggestions:[] };
export function changeCoreQuestion(data:Notebook,title:string,reason='',at=new Date().toISOString(),rootId=ROOT):Notebook {
 const text=title.trim();if(!text||text.length>300)throw new Error('请填写 1 至 300 字的核心问题。');
 const root=data.notes.find(note=>note.id===rootId&&!note.parent);if(!root)throw new Error('核心问题未能读取，请重新读取资料。');
 if(data.setupCompleted!==false&&text===root.title)return data;
 const revisions=data.setupCompleted===false?root.revisions:[...root.revisions,{title:root.title,nextTitle:text,body:root.body,origin:root.origin,source:root.source,reason:reason.trim(),at}];
 return {...data,setupCompleted:true,notes:data.notes.map(note=>note.id===root.id?{...note,title:text,revisions}:note)};
}
export function normalizeZoteroCollections(value:unknown):ZoteroCollection[] {
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();
 return value.filter((collection):collection is ZoteroCollection=>{
  if(!collection||typeof collection!=='object'||typeof collection.serverId!=='string'||!collection.serverId.trim()||typeof collection.key!=='string'||!collection.key.trim()||typeof collection.name!=='string'||!collection.name.trim())return false;
  const identity=JSON.stringify([collection.serverId,collection.key]);
  if(seen.has(identity))return false;
  seen.add(identity);
  return true;
 }).map(collection=>({serverId:collection.serverId,key:collection.key,name:collection.name.trim(),...(typeof collection.parentKey==='string'&&collection.parentKey.trim()?{parentKey:collection.parentKey}:{})})).sort((a,b)=>a.serverId.localeCompare(b.serverId)||a.key.localeCompare(b.key));
}
export function normalize(data:Partial<Notebook>):Notebook {
 const usedOrders=new Set<number>();
 const crossThoughts=(data.crossThoughts||[]).map(n=>{
  let order=Number.isInteger(n.order)&&n.order>0&&!usedOrders.has(n.order)?n.order:1;
  while(usedOrders.has(order))order++;
  usedOrders.add(order);
  return {...n,title:n.title?.trim()||undefined,order,anchorRevisions:n.anchorRevisions||[],thoughts:n.thoughts||[]};
 });
 return {...initialNotebook,...data,questionPages:pagesOf(data as Notebook),setupCompleted:data.setupCompleted??!!data.notes?.length,zoteroEnabled:data.zoteroEnabled??(data.setupCompleted!==false&&!!data.notes?.length),notes:(data.notes||initialNotebook.notes).map(n=>({...n,thoughts:n.thoughts||[]})),cards:(data.cards??[]).map(c=>({...c,thoughts:c.thoughts||[]})),readingNotes:(data.readingNotes||[]).map(n=>({...n,thoughts:n.thoughts||[]})),crossThoughts,thoughtReplies:data.thoughtReplies||[],manuscripts:(data.manuscripts||[]).map(m=>({...m,links:(m.links||[]).map(link=>({...link,targetKind:link.targetKind||'question'})),revisions:(m.revisions||[]).map(r=>({...r,links:(r.links||[]).map(link=>({...link,targetKind:link.targetKind||'question'}))}))})),libraryFolders:normalizeLibraryFolders(data.libraryFolders),zoteroCollections:normalizeZoteroCollections(data.zoteroCollections),libraryBooks:(data.libraryBooks||[]).map(book=>({...book,...(!book.display&&book.zotero?{display:{...(book.title!==book.zotero.title?{title:book.title}:{}),...(book.author&&(book.zotero.author===undefined||book.author!==book.zotero.author)?{author:book.author}:{})}}:{}),inReadingLibrary:book.inReadingLibrary===undefined?(!book.zotero||!book.id.startsWith('zotero-')):book.inReadingLibrary,author:book.author||'',progress:book.progress||{},pdfChapters:(book.pdfChapters||[]).filter(chapter=>chapter.title?.trim()&&Number.isInteger(chapter.startPage)&&chapter.startPage>0)})),libraryHighlights:data.libraryHighlights||[],ocrCache:data.ocrCache||[],bookThoughts:(data.bookThoughts||[]).map(entry=>({...entry,scope:entry.scope||'book',locator:entry.locator||'',quote:entry.quote||undefined,chapter:entry.chapter||undefined,questionIds:entry.questionIds||[],thoughts:entry.thoughts||[]})),dismissedSuggestions:data.dismissedSuggestions||[]};
}
export function crossNumber(c:CrossThought){return `X${c.order}`;}
export function numberOf(n:Note,notes:Note[],crossThoughts:CrossThought[]=[]):string { if(n.kind==='answer')return '回答';if(!n.parent)return '';const siblings=notes.filter(x=>x.kind==='question'&&x.parent===n.parent).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));const position=Math.max(1,siblings.findIndex(x=>x.id===n.id)+1);const p=notes.find(x=>x.id===n.parent);const cross=crossThoughts.find(x=>x.id===n.parent);const prefix=p?numberOf(p,notes,crossThoughts):cross?crossNumber(cross):'';return prefix?prefix+'.'+position:String(position); }
export function crossSignature(c:CrossThought,data:Notebook){return c.anchorIds.map(id=>{const n=data.notes.find(n=>n.id===id);const label=n?numberOf(n,data.notes,data.crossThoughts)||'核心':data.crossThoughts.find(x=>x.id===id)?crossNumber(data.crossThoughts.find(x=>x.id===id)!):'原连接';const page=pageForRecord(data,id);return pagesOf(data).length>1&&page?pageTitle(data,page)+' · '+label:label;}).join(' ↔ ');}
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


// Pages retain source records. Collection parents exist only in the view projection.
export function pagesOf(data:Pick<Notebook,'notes'|'questionPages'>):QuestionPage[] {
 if(data.questionPages!==undefined)return data.questionPages;
 return data.notes.filter(note=>note.kind==='question'&&!note.parent).map((note,index)=>({id:'page-'+note.id,rootId:note.id,kind:'question',order:index+1,members:[]}));
}
export function pageForRecord(data:Notebook,id:string):QuestionPage|undefined {
 const pages=pagesOf(data),roots=new Map(pages.map(page=>[page.rootId,page]));
 const notes=new Map(data.notes.map(note=>[note.id,note])),crosses=new Map(data.crossThoughts.map(cross=>[cross.id,cross]));
 const owners=new Map<string,string>();for(const item of [...data.notes,...data.cards,...data.crossThoughts,...data.readingNotes,...data.bookThoughts])for(const thought of item.thoughts||[])owners.set(thought.id,item.id);
 for(const card of data.cards)if(card.questionId)owners.set(card.id,card.questionId);
 for(const item of [...data.readingNotes,...data.bookThoughts])if(item.questionIds?.[0])owners.set(item.id,item.questionIds[0]);
 for(const reply of data.thoughtReplies)owners.set(reply.id,reply.thoughtId);
 const seen=new Set<string>(),queue=[id];
 for(let index=0;index<queue.length;index++){const current=queue[index];if(seen.has(current))continue;seen.add(current);
  if(roots.has(current))return roots.get(current);
  const cross=crosses.get(current);if(cross?.pageId)return pages.find(page=>page.id===cross.pageId);
  const parent=notes.get(current)?.parent||owners.get(current);if(parent)queue.push(parent);else if(cross)queue.push(...cross.anchorIds);
 }
 return undefined;
}
export function pageTitle(data:Notebook,page:QuestionPage){return data.notes.find(note=>note.id===page.rootId)?.title||'问题页';}
export function addQuestionPage(data:Notebook,title:string,members:string[]=[],id=crypto.randomUUID()):{data:Notebook;page:QuestionPage} {
 const text=title.trim();if(!text||text.length>300)throw Error('请填写1至300字的问题。');
 const pages=pagesOf(data),selected=[...new Set(members)];
 if(selected.length&&selected.length<2)throw Error('请选择至少两个问题页。');
 if(selected.some(key=>!pages.some(page=>page.id===key&&!page.archivedAt&&page.kind==='question')))throw Error('请选择有效的普通问题页。');
 const page:QuestionPage={id:'page-'+id,rootId:id,kind:selected.length?'collection':'question',order:Math.max(0,...pages.map(p=>p.order))+1,members:selected};
 const root:Note={id,kind:'question',parent:null,order:1,title:text,body:'',origin:'自己的思考',source:'',revisions:[],thoughts:[]};
 return {data:{...data,questionPages:[...pages,page],notes:[...data.notes,root]},page};
}
export function pageView(data:Notebook,pageId:string):Notebook {
 const page=pagesOf(data).find(p=>p.id===pageId);if(!page)return data;
 const memberPages=page.members.map(id=>pagesOf(data).find(p=>p.id===id)).filter((p):p is QuestionPage=>!!p);
 const included=new Set([page.id,...memberPages.map(p=>p.id)]);
 const includedRoots=new Set([page.rootId,...memberPages.map(p=>p.rootId)]);
 const notes=new Map(data.notes.map(note=>[note.id,note]));
 const crossIds=new Set(data.crossThoughts.filter(c=>c.pageId?included.has(c.pageId):c.anchorIds.some(id=>{const p=pageForRecord(data,id);return p&&included.has(p.id);})).map(c=>c.id));
 const belongs=(id:string)=>{const seen=new Set<string>();while(id&&!seen.has(id)){seen.add(id);if(includedRoots.has(id)||crossIds.has(id))return true;id=notes.get(id)?.parent||'';}return false;};
 const visible=data.notes.filter(note=>belongs(note.id)),ids=new Set([...visible.map(n=>n.id),...crossIds]);
 const owners=new Map<string,string>();for(const item of [...data.notes,...data.cards,...data.crossThoughts])for(const thought of item.thoughts||[])owners.set(thought.id,item.id);
 for(const card of data.cards)if(card.questionId)owners.set(card.id,card.questionId);
 const owner=(id:string)=>owners.get(id)||id;
 for(const card of data.cards)if(data.links.some(l=>owner(l.from)===card.id&&ids.has(owner(l.to))||owner(l.to)===card.id&&ids.has(owner(l.from)))||data.crossThoughts.some(c=>crossIds.has(c.id)&&c.anchorIds.some(id=>owner(id)===card.id)))ids.add(card.id);

 const start=1;
 const projected=visible.map(note=>{const index=memberPages.findIndex(p=>p.rootId===note.id);return index<0?(note.parent===page.rootId?{...note,order:memberPages.length+note.order}:note):{...note,parent:page.rootId,order:start+index};});
 return {...data,notes:projected,crossThoughts:data.crossThoughts.filter(c=>crossIds.has(c.id)),links:data.links.filter(l=>ids.has(owner(l.from))&&ids.has(owner(l.to)))};
}
export function recordLabel(data:Notebook,id:string){
 const note=data.notes.find(n=>n.id===id),page=pageForRecord(data,id);
 const number=note?numberOf(note,data.notes,data.crossThoughts):data.crossThoughts.find(c=>c.id===id)?crossNumber(data.crossThoughts.find(c=>c.id===id)!):'';
 return [page?pageTitle(data,page):'',number].filter(Boolean).join(' · ');
}
export function displayBook(book:LibraryBook):LibraryBook {
 return {...book,title:book.display?.title??book.zotero?.title??book.title,author:book.display?.author??book.zotero?.author??book.author};
}
export function visibleZoteroAnnotations(book:LibraryBook){const hidden=new Set(book.hiddenZoteroAnnotations||[]);return (book.zotero?.annotations||[]).filter(a=>!hidden.has(a.attachmentKey+':'+a.key));}
