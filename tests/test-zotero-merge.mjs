import ocrCache from '../lib/ocr-cache.cjs';
import settings from '../lib/notebook-settings.cjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {z} from 'zod';

function load(file,imports={}) {
 const loaded={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module:loaded,exports:loaded.exports,require:name=>{
  if(!(name in imports))throw new Error(`Missing test import: ${name}`);
  return imports[name];
 },Response,console});
 return loaded.exports;
}
const notebook=load('lib/notebook.ts',{'./library-folders':load('lib/library-folders.ts')});
const {mergeZoteroCatalog,zoteroIdentity,isReadingBook,libraryBooksForMode,collectionIdentity,zoteroCollectionTree,libraryBooksForZoteroCollection}=load('lib/zotero.ts',{'./notebook':notebook});
const deletion=load('lib/deletion.ts',{'./notebook':notebook});
const same=(a,b,message)=>assert.equal(JSON.stringify(a),JSON.stringify(b),message);
const annotation={key:'ANN00001',type:'highlight',text:'原文',comment:'在 Zotero 写下的批注',pageLabel:'十二',page:15,position:'{"pageIndex":14}',color:'#ffd400',at:'2026-09-28T00:00:00Z',modifiedAt:'2026-09-28T01:00:00Z',attachmentKey:'ATT00001'};
const item={itemKey:'ITEM0001',itemVersion:12,itemType:'book',title:'现代资本主义',author:'桑巴特',format:'pdf',storedFile:'original.pdf',originalName:'现代资本主义.pdf',addedAt:'2026-09-28T00:00:00Z',attachmentKey:'ATT00001',date:'1902',publisher:'出版社',doi:'10.1/example',isbn:'1234567890',collections:['COLL0002','COLL0001'],annotations:[annotation],sourceAvailable:true};
const catalog={serverId:'local-library-1',library:'users/0',items:[item],collections:[],warnings:[],connected:true};
const empty=structuredClone(notebook.initialNotebook);
empty.setupCompleted=true;empty.zoteroEnabled=true;empty.notes.push({...structuredClone(empty.notes[0]),id:'language',parent:'world',title:'测试子问题'});
const local={id:'existing',title:'我整理的书名',author:'自填作者',format:'pdf',storedFile:item.storedFile,originalName:item.originalName,addedAt:'2025-01-01',progress:{page:20,totalPages:500,rotation:90},folderId:'economy',pdfChapters:[{id:'c',title:'第一章',startPage:10}]};
const data={...empty,libraryBooks:[local],libraryFolders:[{id:'economy',name:'经济史'}],readingNotes:[{id:'reading',libraryBookId:local.id,questionIds:['language'],book:local.title,author:local.author,chapter:'第一章',locator:'第 20 页',quote:'我选的原文',interpretation:'自己的理解',at:'today',thoughts:[]}],bookThoughts:[{id:'thought',libraryBookId:local.id,bookTitle:local.title,text:'后来的思考',scope:'book',locator:'',questionIds:[],at:'today',thoughts:[]}]};
const before=JSON.stringify(data);
const linked=mergeZoteroCatalog(data,catalog);
assert.equal(linked.added,0);
assert.equal(linked.updated,1);
assert.equal(linked.data.libraryBooks.length,1,'same confirmed original attaches to the existing book');
const book=linked.data.libraryBooks[0];
same({...book,zotero:undefined,inReadingLibrary:undefined},local,'existing book name, ID, progress and folder remain unchanged');
assert.equal(book.zotero.title,item.title);
assert.equal(book.zotero.annotations[0].comment,annotation.comment);
assert.equal(linked.data.readingNotes,data.readingNotes,'source comments never become personal interpretations');
assert.equal(linked.data.bookThoughts,data.bookThoughts);
assert.equal(JSON.stringify(data),before,'merge never mutates notebook input');
const repeated=mergeZoteroCatalog(linked.data,{...catalog,items:[{...item,collections:[...item.collections].reverse()}]});
assert.equal(repeated.changed,false,'equivalent fetches do not cause an autosave loop');
assert.equal(repeated.data,linked.data);

const changed=mergeZoteroCatalog(linked.data,{...catalog,items:[{...item,title:'源端修正的标题',itemVersion:13,annotations:[{...annotation,comment:'修改后的原批注'},{...annotation,key:'ANN00002',page:21,text:'另一个原文'}]}]});
assert.equal(changed.updated,1);
assert.equal(changed.data.libraryBooks[0].title,local.title);
assert.equal(changed.data.libraryBooks[0].zotero.title,'源端修正的标题');
assert.equal(changed.data.libraryBooks[0].zotero.annotations.length,2);
assert.equal(changed.data.libraryBooks[0].zotero.annotations[0].comment,'修改后的原批注');
const removedSourceAnnotation=mergeZoteroCatalog(changed.data,{...catalog,items:[{...item,itemVersion:14,annotations:[]}]});
assert.equal(removedSourceAnnotation.data.libraryBooks[0].zotero.annotations.length,2,'removing source highlights does not erase collected material');
assert.equal(mergeZoteroCatalog(changed.data,{...catalog,items:[]}).data,changed.data,'removing a source item never deletes notebook content');
assert.equal(mergeZoteroCatalog(changed.data,{...catalog,connected:false}).changed,false,'a disconnected source does not mutate local data');

const newItems=mergeZoteroCatalog(empty,{...catalog,items:[item,item,{...item,itemKey:'ITEM0002',format:'reference',storedFile:'',attachmentKey:undefined,annotations:[]}]});
assert.equal(newItems.added,2,'duplicate source rows are imported once');
const reference=newItems.data.libraryBooks.find(entry=>entry.zotero.itemKey==='ITEM0002');
assert.equal(reference.format,'reference');
assert.equal(reference.storedFile,'');
const acquired=mergeZoteroCatalog(newItems.data,{...catalog,items:[{...item,itemKey:'ITEM0002',storedFile:'new-original.pdf'}]});
assert.equal(acquired.data.libraryBooks.find(entry=>entry.id===reference.id).storedFile,'new-original.pdf','a reference can acquire its original later without changing ID');
const replacedAttachment=mergeZoteroCatalog(linked.data,{...catalog,items:[{...item,attachmentKey:'NEWFILE1',storedFile:'replacement.pdf',annotations:[{...annotation,attachmentKey:'NEWFILE1'}]}]});
assert.equal(replacedAttachment.data.libraryBooks[0].storedFile,local.storedFile);
assert.equal(replacedAttachment.data.libraryBooks[0].zotero.attachmentKey,'ATT00001','local PDF and its attachment key remain paired when a source attachment changes');
assert.equal(replacedAttachment.data.libraryBooks[0].zotero.annotations.length,2,'annotations from other attachments keep their own provenance');
const standalone=mergeZoteroCatalog(empty,{...catalog,items:[{...item,itemKey:item.attachmentKey,itemType:'attachment'}]}).data;
const promoted=mergeZoteroCatalog(standalone,catalog);
assert.equal(promoted.added,0,'Zotero metadata retrieval does not create a duplicate local book');
assert.equal(promoted.updated,1);
assert.equal(promoted.data.libraryBooks[0].id,standalone.libraryBooks[0].id);
assert.equal(promoted.data.libraryBooks[0].zotero.itemKey,item.itemKey);
assert.equal(mergeZoteroCatalog(promoted.data,catalog).changed,false);
const ignoredStandalone=mergeZoteroCatalog({...empty,dismissedSuggestions:[zoteroIdentity(catalog.serverId,item.attachmentKey)]},catalog);
assert.equal(ignoredStandalone.changed,false,'a removed standalone PDF stays dismissed after source metadata retrieval');
const documentOrdered=mergeZoteroCatalog(empty,{...catalog,items:[{...item,annotations:[{...annotation,key:'ZZZZ0001',text:'同页前一段'},{...annotation,key:'AAAA0001',text:'同页后一段'}]}]}).data;
same(documentOrdered.libraryBooks[0].zotero.annotations.map(entry=>entry.text),['同页前一段','同页后一段'],'preserve document order instead of sorting random annotation keys');
same(mergeZoteroCatalog(empty,catalog).data.libraryBooks,mergeZoteroCatalog(empty,catalog).data.libraryBooks,'new source IDs are deterministic');
const otherLibrary=mergeZoteroCatalog(linked.data,{...catalog,serverId:'local-library-2'});
assert.equal(otherLibrary.added,1,'distinct Zotero libraries do not overwrite each other');
assert.equal(otherLibrary.data.libraryBooks[0].zotero.serverId,'local-library-1');
const ignored=mergeZoteroCatalog({...empty,dismissedSuggestions:[zoteroIdentity(catalog.serverId,item.itemKey)]},catalog);
assert.equal(ignored.changed,false,'explicitly removed source books do not reappear automatically');
const titleCollision=mergeZoteroCatalog({...empty,libraryBooks:[{...local,storedFile:'other.pdf',title:item.title}]},catalog);
assert.equal(titleCollision.added,1,'title alone is insufficient to combine books or editions');
same(notebook.normalize(JSON.parse(JSON.stringify(linked.data))).libraryBooks[0].zotero,book.zotero,'save and reload preserve full Zotero provenance');

assert.equal(book.inReadingLibrary,true,'linking a confirmed local original retains membership in reading');
assert.equal(reference.inReadingLibrary,false,'automatically imported sources initially belong only to Zotero');
assert.equal(isReadingBook(local),true);
assert.equal(isReadingBook({...local,id:'zotero-name-without-source'}),true,'an ID alone never marks a local book as imported');
assert.equal(isReadingBook({...book,inReadingLibrary:undefined}),true,'legacy deduplicated local books retain reading membership');
assert.equal(isReadingBook({...reference,inReadingLibrary:undefined}),false,'legacy automatic imports stay out of reading');
assert.equal(isReadingBook({...reference,inReadingLibrary:true}),true,'explicit reading membership overrides the automatic ID');
assert.equal(isReadingBook({...local,inReadingLibrary:false}),false,'explicit membership also applies to local books');
same(libraryBooksForMode(linked.data,'reading').map(entry=>entry.id),[local.id]);
same(libraryBooksForMode(linked.data,'zotero').map(entry=>entry.id),[local.id],'a local original associated with Zotero can be present in both views');
same(libraryBooksForMode(newItems.data,'reading'),[]);
assert.equal(libraryBooksForMode(newItems.data,'zotero').length,2);
const legacyNormalized=notebook.normalize({...empty,libraryBooks:[{...reference,inReadingLibrary:undefined},{...book,inReadingLibrary:undefined},local]});
same(legacyNormalized.libraryBooks.map(entry=>entry.inReadingLibrary),[false,true,true],'normalization migrates legacy membership without editing content');
assert.equal(mergeZoteroCatalog({...linked.data,libraryBooks:[{...book,inReadingLibrary:false}]},catalog).data.libraryBooks[0].inReadingLibrary,false,'sync preserves explicit membership changes');

const collection=(key,name,parentKey)=>({key,name,...(parentKey?{parentKey}:{})});
const taxonomy=[collection('ROOT','社会科学'),collection('COLL0001','经济史','ROOT'),collection('COLL0002','资本主义','COLL0001'),collection('EMPTY','暂未收书')];
const withCollections=mergeZoteroCatalog(linked.data,{...catalog,collections:taxonomy});
assert.equal(withCollections.changed,true,'collection metadata alone schedules persistence');
assert.equal(withCollections.added,0);assert.equal(withCollections.updated,0);
assert.equal(withCollections.data.libraryBooks[0],book,'collection sync leaves the existing book record untouched');
assert.equal(withCollections.data.readingNotes,data.readingNotes);
assert.equal(withCollections.data.zoteroCollections.length,4,'empty collections are retained');
assert.equal(mergeZoteroCatalog(withCollections.data,{...catalog,collections:[...taxonomy].reverse()}).changed,false,'collection order does not trigger repeat saves');
assert.equal(mergeZoteroCatalog(withCollections.data,{serverId:catalog.serverId,items:[]}).data,withCollections.data,'older or partial connector responses keep collection metadata');
const unordered={...withCollections.data,zoteroCollections:[...withCollections.data.zoteroCollections].reverse()};
assert.equal(mergeZoteroCatalog(unordered,{serverId:catalog.serverId,items:[]}).data,unordered,'missing snapshots never reorder old metadata or cause autosave loops');
const flatten=roots=>{const entries=[];for(const node of roots){entries.push(node,...flatten(node.children));}return entries;};
const tree=flatten(zoteroCollectionTree(withCollections.data));
const node=(entries,key,serverId=catalog.serverId)=>entries.find(entry=>entry.id===collectionIdentity(serverId,key));
assert.equal(node(tree,'ROOT').count,1,'ancestors include books from all child levels');
assert.equal(node(tree,'ROOT').directCount,0);
assert.equal(node(tree,'COLL0001').count,1,'books assigned to parent and child are counted once');
assert.equal(node(tree,'COLL0001').directCount,1);
assert.equal(node(tree,'EMPTY').count,0);
same(node(tree,'ROOT').bookIds,[local.id]);
same(libraryBooksForZoteroCollection(withCollections.data,collectionIdentity(catalog.serverId,'ROOT')).map(entry=>entry.id),[local.id]);
same(libraryBooksForZoteroCollection(withCollections.data,null).map(entry=>entry.id),[local.id]);
same(libraryBooksForZoteroCollection(withCollections.data,''),[]);
same(libraryBooksForZoteroCollection(withCollections.data,collectionIdentity(catalog.serverId,'MISSING')),[]);

const renamedTaxonomy=taxonomy.map(entry=>entry.key==='COLL0001'?{...entry,name:'思想与经济'}:entry.key==='COLL0002'?{...entry,parentKey:'EMPTY'}:entry);
const renamedCollections=mergeZoteroCatalog(withCollections.data,{...catalog,items:[],collections:renamedTaxonomy});
const renamedTree=flatten(zoteroCollectionTree(renamedCollections.data));
assert.equal(node(renamedTree,'COLL0001').name,'思想与经济','source renames replace the displayed name');
assert.equal(node(renamedTree,'EMPTY').children[0].key,'COLL0002','source moves change the collection hierarchy');
assert.equal(node(renamedTree,'EMPTY').count,1);
assert.equal(renamedCollections.data.readingNotes,data.readingNotes);
const deletedCollections=mergeZoteroCatalog(renamedCollections.data,{...catalog,items:[],collections:[]});
same(deletedCollections.data.zoteroCollections,[],'an empty complete snapshot removes deleted source collections');
assert.equal(deletedCollections.data.libraryBooks[0],book,'deleting source collections never deletes or edits books');
assert.equal(deletedCollections.data.readingNotes,data.readingNotes,'deleting source collections preserves notes');
same(libraryBooksForZoteroCollection(deletedCollections.data,'').map(entry=>entry.id),[local.id],'stale source memberships appear as unclassified');
assert.equal(mergeZoteroCatalog(deletedCollections.data,{...catalog,items:[],collections:[]}).changed,false);
assert.equal(mergeZoteroCatalog(withCollections.data,{...catalog,collections:[],connected:false}).data,withCollections.data,'offline sync preserves the last complete collection snapshot');

const secondServer='local-library-2';
const second=mergeZoteroCatalog(withCollections.data,{...catalog,serverId:secondServer,items:[{...item,collections:['COLL0001']}],collections:[collection('COLL0001','另一个文库')]});
assert.equal(second.data.zoteroCollections.length,5);
const secondBook=second.data.libraryBooks.find(entry=>entry.zotero.serverId===secondServer);
same(libraryBooksForZoteroCollection(second.data,collectionIdentity(catalog.serverId,'ROOT')).map(entry=>entry.id),[local.id],'same keys in different servers never combine books');
same(libraryBooksForZoteroCollection(second.data,collectionIdentity(secondServer,'COLL0001')).map(entry=>entry.id),[secondBook.id]);
const deleteFirstServer=mergeZoteroCatalog(second.data,{...catalog,items:[],collections:[]});
same(deleteFirstServer.data.zoteroCollections.map(entry=>entry.serverId),[secondServer],'only the syncing server snapshot is replaced');
assert.notEqual(collectionIdentity('a:b','c'),collectionIdentity('a','b:c'),'collection identity separates encoded components');

const broken={...second.data,zoteroCollections:[
 {serverId:catalog.serverId,...collection('A','环 A','B')},
 {serverId:catalog.serverId,...collection('B','环 B','A')},
 {serverId:catalog.serverId,...collection('SELF','自身','SELF')},
 {serverId:catalog.serverId,...collection('ORPHAN','缺少父分类','MISSING')},
 {serverId:catalog.serverId,...collection('CHILD','不同文库的父分类','FOREIGN')},
 {serverId:secondServer,...collection('FOREIGN','其他文库')},
]};
const brokenTree=zoteroCollectionTree(broken),brokenNodes=flatten(brokenTree);
assert.equal(brokenNodes.length,6,'cycles are broken without losing categories');
assert.equal(new Set(brokenNodes.map(entry=>entry.id)).size,6);
for(const key of ['SELF','ORPHAN','CHILD'])assert.ok(brokenTree.some(entry=>entry.key===key),`${key} is safely displayed at the root`);
assert.ok(brokenTree.some(entry=>entry.key==='A'||entry.key==='B'),'each cyclic component gets a visible root');
assert.equal(node(brokenNodes,'FOREIGN',secondServer).children.length,0,'parent keys cannot link across servers');
const deep={...empty,zoteroCollections:Array.from({length:3000},(_,index)=>({serverId:catalog.serverId,key:String(index),name:String(index),...(index?{parentKey:String(index-1)}:{})}))};
assert.equal(zoteroCollectionTree(deep)[0].count,0,'deep source trees do not overflow recursive traversal');
same(notebook.normalize(JSON.parse(JSON.stringify(withCollections.data))).zoteroCollections,withCollections.data.zoteroCollections,'collection snapshots survive save/reload');
same(notebook.normalize({...empty,zoteroCollections:[null,{serverId:' ',key:'a',name:'无效'},...withCollections.data.zoteroCollections,...withCollections.data.zoteroCollections]}).zoteroCollections,withCollections.data.zoteroCollections,'legacy malformed and duplicate collection entries normalize safely');

let state={version:0,content:JSON.stringify(data)};
const DB={prepare(sql){return {bind(...args){return {
 async first(){return {...state};},
 async run(){
  if(sql.startsWith('UPDATE')){
   if(args[2]!==state.version)return {meta:{changes:0}};
   state={version:state.version+1,content:args[0]};
  }
  return {meta:{changes:1}};
 }
};}};}};
const api=load('app/api/notebook/route.ts',{'@/lib/ocr-cache.cjs':ocrCache,'@/lib/notebook-settings.cjs':settings,'@/lib/deletion':deletion,'@/lib/notebook':notebook,'cloudflare:workers':{env:{DB}},zod:{z}});
async function put(value,expected=200){
 const response=await api.PUT(new Request('http://test/api/notebook',{method:'PUT',body:JSON.stringify({data:value,version:state.version})}));
 assert.equal(response.status,expected,await response.text());
}
await put(linked.data);
same(JSON.parse(state.content).libraryBooks[0].zotero,book.zotero,'web validation preserves source fields and annotations');
const withReference={...JSON.parse(state.content),libraryBooks:[...JSON.parse(state.content).libraryBooks,reference]};
await put(withReference);
assert.equal(JSON.parse(state.content).libraryBooks[1].format,'reference','a bibliography-only item saves without a local file');
const persistent={...JSON.parse(state.content),zoteroCollections:withCollections.data.zoteroCollections};
await put(persistent);
same(JSON.parse(state.content).zoteroCollections,withCollections.data.zoteroCollections,'web schema preserves collection hierarchy and empty collections');
same(JSON.parse(state.content).libraryBooks.map(entry=>entry.inReadingLibrary),[true,false],'web schema preserves explicit reading membership');
await put({...persistent,zoteroCollections:[{serverId:catalog.serverId,key:'bad',name:' '}]},400);
await put({...persistent,zoteroCollections:[...persistent.zoteroCollections,persistent.zoteroCollections[0]]},400);
await put({...persistent,libraryBooks:persistent.libraryBooks.map(entry=>({...entry,inReadingLibrary:'false'}))},400);
await put({...persistent,libraryBooks:persistent.libraryBooks.map(entry=>({...entry,inReadingLibrary:null}))},400);
await put({...withReference,libraryBooks:withReference.libraryBooks.map(entry=>entry.id===reference.id?{...entry,format:'pdf'}:entry)},400);
console.log('PASS: Zotero merge, reading/source membership, collection snapshots and hierarchy, cycle safety, preserved local work, repeated sync and API persistence');
