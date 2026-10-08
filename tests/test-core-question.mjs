import ocrCache from '../lib/ocr-cache.cjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {z} from 'zod';
import settings from '../lib/notebook-settings.cjs';
import backup from '../work/mac-app/asar-src/complete-backup.js';
function load(file,imports={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Response,console});return module.exports;}
const model=load('lib/notebook.ts',{'./library-folders':load('lib/library-folders.ts')});
const deletion=load('lib/deletion.ts',{'./notebook':model});
const copy=v=>JSON.parse(JSON.stringify(v));
const same=(a,b)=>assert.deepEqual(copy(a),copy(b));
const {readOnlyHtml}=load('lib/read-only-export.ts',{'./notebook':model});
const fresh=copy(model.initialNotebook);
same(fresh,JSON.parse(fs.readFileSync('work/mac-app/seed.json','utf8')).data);
assert.equal(fresh.setupCompleted,false);assert.equal(fresh.zoteroEnabled,false);
assert.equal(fresh.notes.length,1);assert.equal(fresh.cards.length,0);
const first=model.changeCoreQuestion(fresh,'  人如何获得理解？  ');
assert.equal(first.notes[0].title,'人如何获得理解？');assert.equal(first.setupCompleted,true);assert.equal(first.notes[0].revisions.length,0);assert.equal(first.zoteroEnabled,false);
assert.equal(settings.validateCoreTransition(fresh,first),'');
assert.throws(()=>model.changeCoreQuestion(fresh,'  '));assert.throws(()=>model.changeCoreQuestion(first,'a'.repeat(301)));
const legacy=copy(first);delete legacy.setupCompleted;delete legacy.zoteroEnabled;legacy.notes[0].title='我们该如何处理我们和世界的关系？';legacy.notes.push({...copy(first.notes[0]),id:'sub',parent:'world',title:'子问题'});legacy.cards=[{id:'card',text:'我的原话',origin:'自己的思考',source:'',at:'2026-09-29',thoughts:[]}];
const migrated=model.normalize(legacy);assert.equal(migrated.setupCompleted,true);assert.equal(migrated.zoteroEnabled,true);same(migrated.notes,legacy.notes);same(migrated.cards,legacy.cards);
assert.equal(model.normalize({...legacy,cards:undefined}).cards.length,0,'never resurrect a sample card');
const revised=model.changeCoreQuestion(migrated,'人与世界如何相互作用？','表述更准确','2026-09-29T12:00:00Z');
assert.equal(settings.validateCoreTransition(migrated,revised),'');
const exported=readOnlyHtml(revised);assert.ok(exported.includes('<h1>人与世界如何相互作用？</h1>'));assert.ok(!exported.includes('<h1>我们该如何处理我们和世界的关系？</h1>'));
const escaped=readOnlyHtml(model.changeCoreQuestion(first,'<script>alert(1)</script>'));assert.ok(escaped.includes('&lt;script&gt;'));assert.ok(!escaped.includes('<script>'));
same(revised.notes[1],migrated.notes[1]);same(revised.cards,migrated.cards);assert.equal(revised.notes[0].id,'world');assert.equal(revised.notes[0].revisions[0].title,migrated.notes[0].title);assert.equal(revised.notes[0].revisions[0].nextTitle,revised.notes[0].title);assert.equal(model.changeCoreQuestion(revised,revised.notes[0].title),revised);
assert.ok(settings.validateCoreTransition(revised,fresh));
const unrecorded=copy(revised);unrecorded.notes[0].title='偷偷改写';assert.ok(settings.validateCoreTransition(revised,unrecorded));
const tampered=copy(revised);tampered.notes[0].revisions=[];assert.ok(settings.validateCoreTransition(revised,tampered));
assert.equal(settings.validSettings({...fresh,cards:legacy.cards}),false);
assert.equal(settings.validSettings({...fresh,zoteroEnabled:true}),false);

// Exercise both shipped storage implementations with the same edits and failures.
const source=fs.readFileSync('work/mac-app/asar-src/main.js','utf8');const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
function desktop(initial){let state={version:0,data:copy(initial)},fail=false;const context=vm.createContext({...settings,storageMode:'local',restoringBackup:false,readStore:async()=>copy(state),writeStore:async v=>{if(fail)throw Error('disk unavailable');state=copy(v);},requestBody:async r=>r.body,jsonReply:(_,status,body)=>({status,body}),console:{error(){}}});vm.runInContext(fn('validNotebookData')+'\n'+fn('handleApi'),context);return {get state(){return state;},set fail(v){fail=v;},put:async(data,version=state.version)=>context.handleApi({method:'PUT',body:{data:copy(data),version}},{} )};}
function web(initial){let state={version:0,content:JSON.stringify(initial)},fail=false;const DB={prepare(sql){return{bind(...args){return{async first(){return {...state};},async run(){if(fail)throw Error('disk unavailable');if(sql.startsWith('UPDATE')){if(args[2]!==state.version)return{meta:{changes:0}};state={version:state.version+1,content:args[0]};}return{meta:{changes:1}};}};}};}};const api=load('app/api/notebook/route.ts',{'@/lib/ocr-cache.cjs':ocrCache,'@/lib/notebook-settings.cjs':settings,'@/lib/deletion':deletion,'@/lib/notebook':model,'cloudflare:workers':{env:{DB}},zod:{z}});return {get state(){return{version:state.version,data:JSON.parse(state.content)};},set fail(v){fail=v;},put:async(data,version=state.version)=>api.PUT(new Request('http://test/api/notebook',{method:'PUT',body:JSON.stringify({data,version})}))};}
for(const factory of [desktop,web]){
 const h=factory(fresh);
 assert.equal((await h.put(first)).status,200);
 const before=copy(h.state);
 assert.equal((await h.put({...first,zoteroEnabled:'true'})).status,400);
 assert.equal((await h.put(first,0)).status,409);
 same(h.state,before);
 const next=model.changeCoreQuestion(h.state.data,'怎样理解他人？','', '2026-09-29T13:00:00Z');
 h.fail=true;assert.ok((await h.put(next)).status>=500);same(h.state,before);h.fail=false;
 assert.equal((await h.put(next)).status,200);assert.equal(h.state.data.notes[0].revisions.length,1);
 assert.equal(h.state.data.notes[0].revisions[0].nextTitle,'怎样理解他人？');
 assert.equal((await h.put({...h.state.data,setupCompleted:false})).status,400);
 const edited=copy(h.state.data);edited.notes[0].title='无历史改名';assert.equal((await h.put(edited)).status,400);
 assert.equal((await h.put({...h.state.data,zoteroEnabled:true})).status,200);
 const withReading=copy(h.state.data);withReading.readingNotes=[{id:'reading-flow',questionIds:[],book:'测试书',author:'',chapter:'',locator:'第 1 页',quote:'原文 保留',interpretation:'我的理解',at:'2026-09-30T00:00:00Z',thoughts:[]}];
 assert.equal((await h.put(withReading)).status,200);
 const linked=copy(h.state.data);linked.readingNotes[0].questionIds=['world'];assert.equal((await h.put(linked)).status,200);same(h.state.data.readingNotes[0].quote,'原文 保留');
 const invalidLink=copy(h.state.data);invalidLink.readingNotes[0].questionIds=['missing'];assert.equal((await h.put(invalidLink)).status,400);
 const rewritten=copy(h.state.data);rewritten.readingNotes[0].quote='改写原文';assert.equal((await h.put(rewritten)).status,400);
 const unlinked=copy(h.state.data);unlinked.readingNotes[0].questionIds=[];assert.equal((await h.put(unlinked)).status,200);
 const old=factory(legacy);assert.equal((await old.put(revised)).status,200);same(old.state.data.cards,legacy.cards);
}
const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'wenjian-core-test-'));
try{
 for(const data of [fresh,revised]){
  const notebookPath=path.join(directory,'notebook.json'),draftsPath=path.join(directory,'drafts.json'),libraryDir=path.join(directory,'library'),destination=path.join(directory,`backup-${data.setupCompleted}.wenjian-backup`);
  await fsp.mkdir(libraryDir,{recursive:true});await fsp.writeFile(notebookPath,JSON.stringify({version:7,data}));await fsp.writeFile(draftsPath,JSON.stringify({home:{capture:'未保存的原话'}}));
  await backup.exportCompleteBackup({notebookPath,draftsPath,libraryDir,destination,validateNotebook:v=>settings.validSettings(v.data)});
  let restored,drafts;await backup.restoreCompleteBackup({archivePath:destination,notebookPath,draftsPath,libraryDir,validateNotebook:v=>settings.validSettings(v.data),writeNotebook:async v=>{restored=v;},writeDrafts:async v=>{drafts=v;}});
  same(restored.data,data);assert.equal(drafts.home.capture,'未保存的原话');
 }
}finally{await fsp.rm(directory,{recursive:true,force:true});}
console.log('PASS: clean seeds, legacy migration, root identity, revision audit, no-op edits, both storage APIs, failure/retry/conflict, consent and complete-backup roundtrip');
