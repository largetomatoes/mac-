import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {z} from 'zod';
import cache from '../lib/ocr-cache.cjs';
import settings from '../lib/notebook-settings.cjs';
const copy=v=>JSON.parse(JSON.stringify(v));
const same=(a,b)=>assert.deepEqual(copy(a),copy(b));
function load(file,imports={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Response,URL,setTimeout,clearTimeout,console:{error(){}}});return module.exports;}
const model=load('lib/notebook.ts',{'./library-folders':load('lib/library-folders.ts')});
const deletion=load('lib/deletion.ts',{'./notebook':model});
const initial=model.changeCoreQuestion(copy(model.initialNotebook),'测试问题');
initial.libraryBooks=[{id:'book',title:'测试书',author:'',format:'pdf',storedFile:'test.pdf',originalName:'test.pdf',addedAt:'2026-10-06',progress:{page:2},pdfChapters:[],inReadingLibrary:true}];
initial.libraryHighlights=[{id:'h',libraryBookId:'book',quote:'原文',locator:'第2页',sourceLocation:'pdf:2',at:'2026-10-06'}];
const entry={libraryBookId:'book',page:2,text:'识别文字',lines:[{text:'识别文字',x0:0,y0:0,x1:1,y1:.1}],at:'2026-10-06T10:00:00Z',rotation:0,version:7};
assert.equal(cache.validOcrEntry(entry),true);
for(const invalid of [{...entry,page:0},{...entry,at:'bad'},{...entry,lines:[]},{...entry,rotation:45},{...entry,lines:[{...entry.lines[0],x0:2}]}])assert.equal(cache.validOcrEntry(invalid),false);
const source=fs.readFileSync('work/mac-app/asar-src/main.js','utf8'),ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
function desktop(){let state={version:0,data:copy(initial)},fail=false;const context=vm.createContext({...cache,...settings,restoringBackup:false,storageMode:'local',readStore:async()=>copy(state),writeStore:async value=>{await new Promise(r=>setTimeout(r,5));if(fail)throw Error('disk unavailable');state=copy(value);},requestBody:async r=>r.body,jsonReply:(_,status,body)=>({status,body}),console:{error(){}}});vm.runInContext('let notebookQueue=Promise.resolve();\n'+['serializeNotebook','validNotebookData','handleApi'].map(fn).join('\n'),context);return {get state(){return state;},set fail(v){fail=v;},request:(method,body)=>context.serializeNotebook(()=>context.handleApi({method,body},{}))};}
function web(){let row={version:0,content:JSON.stringify(initial)},fail=false;const DB={prepare(sql){return {bind(...args){return {first:async()=>({...row}),run:async()=>{await new Promise(r=>setTimeout(r,5));if(fail)throw Error('disk unavailable');if(sql.startsWith('UPDATE')){if(args[2]!==row.version)return{meta:{changes:0}};row={version:row.version+1,content:args[0]};}return{meta:{changes:1}};}};}};}};const api=load('app/api/notebook/route.ts',{'@/lib/ocr-cache.cjs':cache,'@/lib/notebook-settings.cjs':settings,'@/lib/deletion':deletion,'@/lib/notebook':model,'cloudflare:workers':{env:{DB}},zod:{z}});return {get state(){return{version:row.version,data:JSON.parse(row.content)};},set fail(v){fail=v;},request:(method,body)=>api[method](new Request('http://test/api/notebook',{method,body:JSON.stringify(body)}))};}
for(const factory of [desktop,web]){
 const h=factory(),next=copy(initial);next.notes[0].thoughts.push({id:'thought',text:'新笔记不能丢',origin:'自己的思考',reason:'',at:'2026-10-06'});
 const responses=await Promise.all([h.request('PUT',{version:0,data:next}),h.request('PATCH',{version:0,entry})]);
 same(responses.map(r=>r.status),[200,409]);
 assert.equal((await h.request('PATCH',{version:h.state.version,entry,data:{notes:[]}})).status,200);
 assert.equal(h.state.data.notes[0].thoughts[0].text,'新笔记不能丢');same(h.state.data.libraryBooks,initial.libraryBooks);same(h.state.data.libraryHighlights,initial.libraryHighlights);
 assert.equal((await h.request('PATCH',{version:h.state.version,entry:{...entry,at:'2020-01-01T00:00:00Z',text:'过时结果'}})).status,200);assert.equal(h.state.data.ocrCache[0].text,entry.text);
 let before=copy(h.state);h.fail=true;assert.ok((await h.request('PATCH',{version:h.state.version,entry:{...entry,page:3}})).status>=500);same(h.state,before);h.fail=false;
 assert.equal((await h.request('PATCH',{version:h.state.version,entry:{...entry,page:3}})).status,200);
 before=copy(h.state);assert.equal((await h.request('PATCH',{version:h.state.version,entry:{...entry,libraryBookId:'removed'}})).status,404);same(h.state,before);
 assert.equal((await h.request('PATCH',{version:h.state.version,entry:{...entry,lines:[]}})).status,400);
}
const {OcrSaveQueue}=load('lib/ocr-save-queue.ts');
let now=0,calls=0,mode='busy';const q=new OcrSaveQueue(async()=>{calls++;return {status:mode,error:'disk unavailable'};},()=>{},()=>now);
q.add(entry);await q.flush();assert.equal(q.pending.size,1);assert.equal([...q.pending.values()][0].attempts,0);
mode='retry';now=1000;for(let i=0;i<5;i++){await q.flush();now+=30001;}
assert.equal([...q.pending.values()][0].state,'failed');const attempts=calls;await q.flush();assert.equal(calls,attempts,'bounded retries');
mode='saved';q.retry();await q.flush();assert.equal(q.pending.size,0);q.stop();
let resolve;const racing=new OcrSaveQueue(()=>new Promise(r=>resolve=r),()=>{});racing.add(entry);const inFlight=racing.flush();const newer={...entry,at:'2026-10-06T11:00:00Z',text:'更新文字'};racing.add(newer);resolve({status:'saved'});await inFlight;assert.equal([...racing.pending.values()][0].entry.text,newer.text);racing.stop();
console.log('PASS: native and web page-only writes, concurrent note/cache conflict, preserved notes/progress/highlights, stale page prevention, disk failure and retry, removed books, bounded queue and in-flight replacement');
