import {type Notebook,type ManuscriptLink,type Thought,ROOT,numberOf,crossNumber,crossSignature} from './notebook';

export type MaterialKind='heading'|'original'|'quote'|'understanding'|'thought'|'reply';
export type ManuscriptSourceSnapshot={
 key:string; kind:MaterialKind; text:string; label:string; citation:string; at:string;
 targetKind:'note'|'cross'|'card'|'reading'|'bookThought'; targetId:string;
 thoughtId?:string; replyId?:string; libraryBookId?:string; sourceLocation?:string;
 origin?:string; reason?:string;
};
export type ManuscriptBlock={id:string;kind:'paragraph'|'heading'|'quote';text:string;source?:ManuscriptSourceSnapshot;links?:ManuscriptLink[]};
export type MaterialScope={id:string;kind:'question'|'cross'|'card'|'book';label:string};
export type Material=ManuscriptSourceSnapshot&{scopeIds:string[]};
export type MaterialCatalog={scopes:MaterialScope[];materials:Material[]};
export const materialKindLabel:Record<MaterialKind,string>={heading:'标题',original:'最初记录',quote:'引用原文',understanding:'自己的理解',thought:'后来想到的',reply:'我的回答'};

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
 const bookScope=(id:string|undefined,title:string)=>id?`book:${id}`:`book-title:${title}`;
 for(const book of data.libraryBooks)addScope({id:bookScope(book.id,book.title),kind:'book',label:book.title});
 const readingBooks=[...data.readingNotes.map(item=>({id:item.libraryBookId,title:item.book})),...data.bookThoughts.map(item=>({id:item.libraryBookId,title:item.bookTitle}))];
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
  const label=`${id===ROOT?'核心问题':numberOf(note,data.notes,data.crossThoughts)} · ${note.title}`;
  if(note.kind==='question')addScope({id:questionScope(id),kind:'question',label});
  const scopeIds=scopeAncestors(id),context={label,citation:note.source,targetKind:'note' as const,targetId:id,origin:note.origin};
  add({...context,key:`note:${id}:title`,kind:'heading',text:note.title,at:''},scopeIds);
  add({...context,key:`note:${id}:body`,kind:'original',text:note.body,at:''},scopeIds);
  appendThoughts(note.thoughts||[],context,scopeIds);
  data.notes.filter(child=>child.parent===id).sort((a,b)=>a.order-b.order).forEach(child=>visit(child.id));
 };
 visit(ROOT);
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
  const citation=[reading.book?`《${reading.book}》`:'',reading.author,reading.chapter,reading.locator].filter(Boolean).join(' · ');
  const scopeIds=[...reading.questionIds.flatMap(scopeAncestors),bookScope(reading.libraryBookId,reading.book)];
  const context={label:`阅读笔记 · ${reading.book}`,citation,targetKind:'reading' as const,targetId:reading.id,libraryBookId:reading.libraryBookId,sourceLocation:reading.sourceLocation};
  add({...context,key:`reading:${reading.id}:quote`,kind:'quote',text:reading.quote,at:reading.at,origin:'引用原文'},scopeIds);
  add({...context,key:`reading:${reading.id}:interpretation`,kind:'understanding',text:reading.interpretation,at:reading.at,origin:'自己的理解'},scopeIds);
  appendThoughts(reading.thoughts,context,scopeIds);
 }
 for(const entry of data.bookThoughts){
  const scopeIds=[...entry.questionIds.flatMap(scopeAncestors),bookScope(entry.libraryBookId,entry.bookTitle)];
  const citation=[entry.bookTitle?`《${entry.bookTitle}》`:'',entry.chapter,entry.locator].filter(Boolean).join(' · ');
  const context={label:`本书思考 · ${entry.bookTitle}`,citation,targetKind:'bookThought' as const,targetId:entry.id,libraryBookId:entry.libraryBookId,sourceLocation:entry.sourceLocation};
  if(entry.quote)add({...context,key:`bookThought:${entry.id}:quote`,kind:'quote',text:entry.quote,at:entry.at,origin:'引用原文'},scopeIds);
  add({...context,key:`bookThought:${entry.id}:text`,kind:'understanding',text:entry.text,at:entry.at,origin:'自己的思考'},scopeIds);
  appendThoughts(entry.thoughts,context,scopeIds);
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
