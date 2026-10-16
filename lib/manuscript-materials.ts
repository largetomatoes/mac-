import {processSources} from './process-note-sources';
import {thoughtSources,thoughtPrimary,sourceLabel} from './book-notebook';
import {type Notebook,type ManuscriptLink,type Thought,displayBook,pagesOf,pageView,numberOf,crossNumber,crossSignature} from './notebook';

export type MaterialKind='heading'|'original'|'quote'|'understanding'|'thought'|'reply';
export type ManuscriptSourceSnapshot={
 key:string; kind:MaterialKind; text:string; label:string; citation:string; at:string;
 targetKind:'note'|'cross'|'card'|'reading'|'bookThought'; targetId:string;
 thoughtId?:string; replyId?:string; libraryBookId?:string; sourceLocation?:string;
 origin?:string; reason?:string;
};
export type ManuscriptBlock={id:string;kind:'paragraph'|'heading'|'quote';text:string;source?:ManuscriptSourceSnapshot;links?:ManuscriptLink[]};
export type MaterialScope={id:string;kind:'question'|'cross'|'card'|'book'|'chapter';label:string;parentId?:string};
export type Material=ManuscriptSourceSnapshot&{scopeIds:string[]};
export type MaterialCatalog={scopes:MaterialScope[];materials:Material[]};
export const materialKindLabel:Record<MaterialKind,string>={heading:'标题',original:'当前记录',quote:'引用原文',understanding:'自己的理解',thought:'后来想到的',reply:'我的回答'};

/** Collect existing records only: no inference, rewriting, or network access. */
export function buildManuscriptMaterials(data:Notebook):MaterialCatalog{
 const scopes:MaterialScope[]=[],materials:Material[]=[];
 const notes=new Map(data.notes.map(note=>[note.id,note])),crosses=new Map(data.crossThoughts.map(cross=>[cross.id,cross]));
 const questionScope=(id:string)=>crosses.has(id)?`cross:${id}`:`question:${id}`;
 const scopeAncestors=(id:string)=>{
  const result:string[]=[],seen=new Set<string>();
  while(id&&!seen.has(id)){seen.add(id);const note=notes.get(id);if(note?.kind==='question'||crosses.has(id))result.push(questionScope(id));id=note?.parent||'';}
  return result;
 };
 const addScope=(scope:MaterialScope)=>{if(!scopes.some(item=>item.id===scope.id))scopes.push(scope);};
 const chapterScope=(bookId:string|undefined,title:string,chapter:string)=>{const id=bookScope(bookId,title)+':chapter:'+encodeURIComponent(chapter||'全书/未分章');addScope({id,kind:'chapter',label:chapter||'全书/未分章',parentId:bookScope(bookId,title)});return id;};
 const bookScope=(id:string|undefined,title:string)=>id?`book:${id}`:`book-title:${title}`;
 for(const original of data.libraryBooks){const book=displayBook(original);addScope({id:bookScope(book.id,book.title),kind:'book',label:book.title});}
 const readingBooks=[...data.readingNotes.flatMap(item=>processSources(item).map(source=>({id:source.libraryBookId,title:source.bookTitle}))),...data.bookThoughts.flatMap(item=>thoughtSources(item).map(source=>({id:source.libraryBookId,title:source.bookTitle})))];
 for(const book of readingBooks)addScope({id:bookScope(book.id,book.title),kind:'book',label:book.title});
 const add=(source:ManuscriptSourceSnapshot,scopeIds:string[])=>{if(source.text.trim())materials.push({...source,scopeIds:[...new Set(scopeIds)]});};
 const appendThoughts=(thoughts:Thought[],context:Omit<ManuscriptSourceSnapshot,'key'|'kind'|'text'|'at'>,scopeIds:string[])=>{
  for(const thought of thoughts){
   add({...context,key:`thought:${thought.id}`,kind:'thought',text:thought.text,at:thought.at,thoughtId:thought.id,origin:thought.origin,reason:thought.reason},scopeIds);
   for(const reply of data.thoughtReplies.filter(reply=>reply.thoughtId===thought.id))add({...context,key:`reply:${reply.id}`,kind:'reply',text:reply.text,at:reply.at,thoughtId:thought.id,replyId:reply.id,origin:'自己的回答'},scopeIds);
  }
 };
 const visited=new Set<string>();
 const visit=(id:string)=>{
  if(visited.has(id))return;visited.add(id);
  const note=notes.get(id);if(!note)return;
  const label=`${!note.parent?'问题页':numberOf(note,data.notes,data.crossThoughts)} · ${note.title}`;
  if(note.kind==='question')addScope({id:questionScope(id),kind:'question',label,...(note.parent?{parentId:questionScope(note.parent)}:{})});
  const scopeIds=scopeAncestors(id),context={label,citation:note.source,targetKind:'note' as const,targetId:id,origin:note.origin};
  add({...context,key:`note:${id}:title`,kind:'heading',text:note.title,at:''},scopeIds);
  add({...context,key:`note:${id}:body`,kind:'original',text:note.body,at:''},scopeIds);
  appendThoughts(note.thoughts||[],context,scopeIds);
  data.notes.filter(child=>child.parent===id).sort((a,b)=>a.order-b.order).forEach(child=>visit(child.id));
 };
 for(const page of pagesOf(data))visit(page.rootId);
 for(const cross of [...data.crossThoughts].sort((a,b)=>a.order-b.order)){
  const label=`${crossNumber(cross)}〔${crossSignature(cross,data)}〕 · ${cross.title||'交叉思考'}`,scopeIds=[`cross:${cross.id}`];
  addScope({id:scopeIds[0],kind:'cross',label});
  const context={label,citation:cross.source,targetKind:'cross' as const,targetId:cross.id,origin:cross.origin};
  if(cross.title)add({...context,key:`cross:${cross.id}:title`,kind:'heading',text:cross.title,at:cross.at},scopeIds);
  add({...context,key:`cross:${cross.id}:text`,kind:'original',text:cross.text,at:cross.at},scopeIds);
  appendThoughts(cross.thoughts,context,scopeIds);
  data.notes.filter(note=>note.parent===cross.id).sort((a,b)=>a.order-b.order).forEach(note=>visit(note.id));
 }
 data.notes.forEach(note=>visit(note.id));
 for(const card of data.cards){
  const label=`卡片 · ${card.text.slice(0,36)}${card.text.length>36?'…':''}`,scopeIds=[`card:${card.id}`];
  // Only confirmed links add a card to a question scope; cross anchors do not fan out.
  for(const link of data.links){const other=link.from===card.id?link.to:link.to===card.id?link.from:null;if(other)scopeIds.push(...scopeAncestors(other));}
  addScope({id:scopeIds[0],kind:'card',label});
  const context={label,citation:card.source,targetKind:'card' as const,targetId:card.id,origin:card.origin};
  add({...context,key:`card:${card.id}:text`,kind:'original',text:card.text,at:card.at},scopeIds);
  appendThoughts(card.thoughts,context,scopeIds);
 }
 for(const reading of data.readingNotes){
  const sources=processSources(reading),primary=sources[0];
  const scopeIds=[...reading.questionIds.flatMap(scopeAncestors),...sources.flatMap(source=>[bookScope(source.libraryBookId,source.bookTitle),chapterScope(source.libraryBookId,source.bookTitle,source.chapter||'')])];
  const context={label:`过程笔记 · ${sources.map(s=>s.bookTitle).filter((v,i,all)=>all.indexOf(v)===i).join(' ↔ ')}`,citation:sources.map(sourceLabel).join(' ↔ '),targetKind:'reading' as const,targetId:reading.id,libraryBookId:primary.libraryBookId,sourceLocation:primary.sourceLocation};
  for(const source of sources)add({...context,key:reading.sources?.length?`reading:${reading.id}:quote:${source.id}`:`reading:${reading.id}:quote`,citation:sourceLabel(source),libraryBookId:source.libraryBookId,sourceLocation:source.sourceLocation,kind:'quote',text:source.quote||'',at:reading.at,origin:'引用原文'},scopeIds);
  add({...context,key:`reading:${reading.id}:interpretation`,kind:'understanding',text:reading.interpretation,at:reading.at,origin:'自己的理解'},scopeIds);
  appendThoughts(reading.thoughts,context,scopeIds);
 }
 for(const entry of data.bookThoughts){
  const sources=thoughtSources(entry),primary=thoughtPrimary(entry,data.libraryBooks)||sources[0];
  const scopeIds=[...entry.questionIds.flatMap(scopeAncestors),...sources.flatMap(source=>[bookScope(source.libraryBookId,source.bookTitle),chapterScope(source.libraryBookId,source.bookTitle,source.chapter||'')])];
  const citation=sources.map(sourceLabel).join(' ↔ ');
  const context={label:`${entry.sources?.length?'共同思考':'本书思考'} · ${sources.map(source=>source.bookTitle).join(' ↔ ')}`,citation,targetKind:'bookThought' as const,targetId:entry.id,libraryBookId:primary.libraryBookId,sourceLocation:primary.sourceLocation};
  for(const source of sources){
   if(source.quote)add({...context,key:entry.sources?.length?`bookThought:${entry.id}:quote:${source.id}`:`bookThought:${entry.id}:quote`,citation:sourceLabel(source),kind:'quote',text:source.quote,at:entry.at,origin:'引用原文'},scopeIds);
   if(source.noteText)add({...context,key:`bookThought:${entry.id}:reference:${source.id}`,citation:sourceLabel(source),kind:'understanding',text:source.noteText,at:entry.at,origin:'既有笔记'},scopeIds);
  }
  add({...context,key:`bookThought:${entry.id}:text`,kind:'understanding',text:entry.text,at:entry.at,origin:'自己的思考'},scopeIds);
  appendThoughts(entry.thoughts,context,scopeIds);
 }
 // Collection pages use their saved positions, never legacy member lists or canonical parents.
 for(const page of pagesOf(data).filter(page=>page.kind==='collection')){
  const view=pageView(data,page.id),rows=page.placements||[],rowByRecord=new Map(rows.map(row=>[row.recordId,row])),rootScope=questionScope(page.rootId);
  const localScope=(id:string)=>id===page.rootId?rootScope:`page:${page.id}:${id}`;
  for(const row of rows){if(row.recordId===page.rootId)continue;const note=view.notes.find(n=>n.id===row.recordId),cross=view.crossThoughts.find(c=>c.id===row.recordId);if(note?.kind==='answer')continue;addScope({id:localScope(row.recordId),kind:cross?'cross':'question',label:note?`${numberOf(note,view.notes,view.crossThoughts)} · ${note.title}`:`${cross?crossNumber(cross):''} · ${cross?.title||'交叉思考'}`,parentId:row.parentId?localScope(row.parentId):rootScope});}
  for(const material of materials){
   material.scopeIds=material.scopeIds.filter(id=>id!==rootScope);
   const direct=material.targetKind==='reading'?data.readingNotes.find(n=>n.id===material.targetId)?.questionIds||[]:material.targetKind==='bookThought'?data.bookThoughts.find(n=>n.id===material.targetId)?.questionIds||[]:material.targetKind==='card'?data.links.filter(l=>l.from===material.targetId||l.to===material.targetId).map(l=>l.from===material.targetId?l.to:l.from):[material.targetId];
   for(let id of direct){const seen=new Set<string>();while(rowByRecord.has(id)&&!seen.has(id)){seen.add(id);if(!view.notes.some(n=>n.id===id&&n.kind==='answer'))material.scopeIds.push(localScope(id));id=rowByRecord.get(id)!.parentId||'';}}
   material.scopeIds=[...new Set(material.scopeIds)];
  }
 }

 return {scopes:[...scopes.filter(scope=>scope.kind!=='book'),...scopes.filter(scope=>scope.kind==='book')],materials};
}

export function collectMaterials(catalog:MaterialCatalog,orderedScopeIds:string[]):Material[]{
 const seen=new Set<string>(),result:Material[]=[];
 for(const id of orderedScopeIds)for(const item of catalog.materials)if(item.scopeIds.includes(id)&&!seen.has(item.key)){seen.add(item.key);result.push(item);}
 return result;
}
export function materialSnapshot(material:Material):ManuscriptSourceSnapshot{
 const {scopeIds,...source}=material;void scopeIds;return {...source};
}
export function sourceStatus(source:ManuscriptSourceSnapshot,catalog:MaterialCatalog):'current'|'changed'|'missing'{
 const current=catalog.materials.find(item=>item.key===source.key);
 if(!current)return 'missing';
 return current.text===source.text&&current.citation===source.citation&&current.label===source.label&&current.reason===source.reason?'current':'changed';
}
export function createManuscriptBlocks(materials:Material[],makeId:()=>string=()=>crypto.randomUUID()):ManuscriptBlock[]{
 return materials.map(material=>({id:makeId(),kind:material.kind==='heading'?'heading':material.kind==='quote'?'quote':'paragraph',text:material.text,source:materialSnapshot(material),links:[]}));
}
