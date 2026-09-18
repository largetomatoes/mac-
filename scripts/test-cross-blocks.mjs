import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {z} from 'zod';
function load(file, imports){
 const loadedModule={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module:loadedModule,exports:loadedModule.exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Response,console});
 return loadedModule.exports;
}
const notebook=load('lib/notebook.ts',{});
const deletion=load('lib/deletion.ts',{'./notebook':notebook});
let state={version:0,content:JSON.stringify(notebook.initialNotebook)};
const DB={prepare(sql){
 return {bind(...args){
  return {
   async first(){return {...state};},
   async run(){
    if(sql.startsWith('UPDATE')){
     if(state.version!==args[2])return {meta:{changes:0}};
     state={content:args[0],version:state.version+1};
    }
    return {meta:{changes:1}};
   }
  };
 }};
}};
const api=load('app/api/notebook/route.ts',{'@/lib/deletion':deletion,'@/lib/notebook':notebook,'cloudflare:workers':{env:{DB}},zod:{z}});
const read=()=>JSON.parse(state.content);
async function put(data,expected=200,version=state.version){const r=await api.PUT(new Request('http://test/api/notebook',{method:'PUT',body:JSON.stringify({data,version})}));assert.equal(r.status,expected,await r.text());}
const legacy=structuredClone(notebook.initialNotebook);
legacy.crossThoughts=[
 {id:'legacy-a',order:1,title:'',anchorIds:['world','language'],text:'旧关联一',origin:'自己的思考',source:'',at:'',thoughts:[]},
 {id:'legacy-b',order:1,title:'旧关联二',anchorIds:['world','language'],text:'',origin:'自己的思考',source:'',at:'',thoughts:[]}
];
state={version:0,content:JSON.stringify(legacy)};
const repaired=notebook.normalize(read());
assert.deepEqual(repaired.crossThoughts.map(c=>c.order),[1,2]);
assert.equal(repaired.crossThoughts[0].title,undefined);
repaired.notes[1].thoughts.push({id:'legacy-thought',text:'旧数据修复后仍能新增思考',origin:'自己的思考',reason:'',at:'today'});
await put(repaired);
assert.equal(read().notes[1].thoughts.length,1);
const rich=structuredClone(notebook.initialNotebook);
rich.libraryBooks.push({id:'book',title:'无作者 PDF',author:'',format:'pdf',storedFile:'book.pdf',originalName:'book.pdf',addedAt:'today',progress:{page:2,totalPages:10,rotation:90}});
rich.libraryHighlights.push({id:'highlight',libraryBookId:'book',quote:'原文',locator:'第 2 页',sourceLocation:'pdf:2',at:'today'});
rich.ocrCache.push({libraryBookId:'book',page:2,text:'识别文字',at:'today'});
rich.readingNotes.push({id:'blank-source',questionIds:['language'],book:'无作者 PDF',author:'',chapter:'',locator:'第 2 页',quote:'原文',interpretation:'理解',at:'today',thoughts:[],libraryBookId:'book',sourceLocation:'pdf:2'});
rich.manuscripts.push({id:'draft',title:'文稿',body:'引用这段文字。',links:[{id:'draft-link',questionId:'blank-source',targetKind:'reading',quote:'这段文字',start:2,end:6,prefix:'引用',suffix:'。',at:'today'}],at:'today',updatedAt:'today',revisions:[]});
state={version:0,content:JSON.stringify(notebook.initialNotebook)};
await put(rich);
assert.equal(read().readingNotes[0].chapter,'');
assert.equal(read().manuscripts[0].links[0].targetKind,'reading');
assert.equal(read().libraryBooks[0].progress.rotation,90);
assert.equal(read().libraryHighlights[0].quote,'原文');
assert.equal(read().ocrCache[0].text,'识别文字');
state={version:0,content:JSON.stringify(notebook.initialNotebook)};
const first=read();
first.notes.push({...first.notes[1],id:'child',parent:'language',order:1,title:'子板块'});
first.notes.push({...first.notes[1],id:'cross-child',parent:'cross',order:1,title:'交叉产生的子问题'});
first.crossThoughts.push({id:'cross',order:1,title:'语言与诚实',anchorIds:['language','child'],anchorRevisions:[],text:'',origin:'自己的思考',source:'',at:'today',thoughts:[]});
await put(first);
assert.equal(notebook.numberOf(read().notes.find(n=>n.id==='cross-child'),read().notes,read().crossThoughts),'X1.1');
let next=read();
next.readingNotes.push({id:'reading',questionIds:['cross'],book:'书',author:'作者',chapter:'一',locator:'1',quote:'原文',interpretation:'理解',at:'today',thoughts:[]});
next.crossThoughts[0].thoughts.push({id:'thought',text:'后续思考',origin:'自己的思考',reason:'',at:'today'});
next.notes.find(n=>n.id==='child').thoughts.push({id:'child-thought',text:'将随子问题删除',origin:'自己的思考',reason:'',at:'today'});
await put(next);
next=read();next.crossThoughts[0].anchorRevisions.push({from:['language','child'],to:['world','child'],fromLabel:'1 ↔ 1.1',toLabel:'核心 ↔ 1.1',at:'later',reason:'手动调整关联板块'});next.crossThoughts[0].anchorIds=['world','child'];await put(next);
assert.equal(read().readingNotes[0].quote,'原文');assert.equal(read().crossThoughts[0].thoughts[0].text,'后续思考');
next=read();next.thoughtReplies.push({id:'reply',thoughtId:'thought',text:'我对这条思考的回答',at:'later'},{id:'child-reply',thoughtId:'child-thought',text:'对子问题思考的回答',at:'later'});await put(next);
assert.equal(read().thoughtReplies[0].at,'later');
next=read();next.thoughtReplies.push({id:'reply-2',thoughtId:'thought',text:'重复回答',at:'later'});await put(next,400);
next=read();next.thoughtReplies[0].text='覆盖原回答';await put(next,400);
next=read();next.crossThoughts[0].anchorIds=['world'];next.crossThoughts[0].anchorRevisions.push({from:['world','child'],to:['world'],at:'later',reason:'手动调整关联板块'});await put(next,400);
next=read();next.crossThoughts[0].anchorIds=['world','world'];next.crossThoughts[0].anchorRevisions.push({from:['world','child'],to:['world','world'],at:'later',reason:'手动调整关联板块'});await put(next,400);
next=read();next.crossThoughts[0].anchorIds=['world','missing'];next.crossThoughts[0].anchorRevisions.push({from:['world','child'],to:['world','missing'],at:'later',reason:'手动调整关联板块'});await put(next,400);
next=read();next.crossThoughts[0].thoughts=[];await put(next,400);
next=read();next.readingNotes[0].quote='覆盖';await put(next,400);
await put(read(),409,0);
const r=await api.DELETE(new Request('http://test/api/notebook',{method:'DELETE',body:JSON.stringify({id:'child',title:'子板块',version:state.version,confirmed:true,confirmation:'删除'})}));assert.equal(r.status,200);
assert.equal(read().crossThoughts.length,1);assert.equal(read().readingNotes.length,1);
assert.deepEqual(read().thoughtReplies.map(r=>r.id),['reply']);
assert.equal(read().crossThoughts[0].anchorRevisions.at(-1).reason,'关联板块被删除');
assert.equal(read().notes.some(n=>n.id==='cross-child'),true);
await put(read());
next=read();next.crossThoughts[0].anchorRevisions.push({from:['world'],to:['world','language'],at:'later',reason:'手动调整关联板块'});next.crossThoughts[0].anchorIds=['world','language'];await put(next);
assert.equal(read().crossThoughts[0].thoughts.length,1);
next=read();next.crossThoughts.push({id:'cross-2',order:2,title:'由关联主题继续生长',anchorIds:['cross','world'],anchorRevisions:[],text:'',origin:'自己的思考',source:'',at:'today',thoughts:[]});await put(next);
next=read();next.crossThoughts[0].anchorRevisions.push({from:['world','language'],to:['language','cross-2'],at:'later',reason:'手动调整关联板块'});next.crossThoughts[0].anchorIds=['language','cross-2'];await put(next,400);
console.log('PASS: legacy repair, create, readings, append, single replies with timestamps, branches, cross-theme anchors, cycle checks, conflicts and deletion preservation');
