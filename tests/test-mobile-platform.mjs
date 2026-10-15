import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import ocrCache from '../lib/ocr-cache.cjs';
import settings from '../lib/notebook-settings.cjs';
import maintenance from '../lib/maintenance.cjs';

// Run the production API adapter and normalizer. Only native storage, network
// transfer and the reader's platform registration are replaced at their edges.
function load(file,imports={},globals={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in imports,`unexpected import ${name}`);return imports[name];},crypto:webcrypto,structuredClone,Error,URL,Response,TextEncoder,...globals},{filename:file});
 return module.exports;
}
const folders=load('lib/library-folders.ts');
const notebook=load('lib/notebook.ts',{'./library-folders':folders});
const core=load('lib/sync/core.ts');
const updates=load('lib/app-updates.ts');
const original={id:'book-1',title:'中文书籍 📖',author:'测试作者',format:'pdf',storedFile:'中文原件.pdf',originalName:'中文原件.pdf',addedAt:'2026-10-13T00:00:00.000Z',progress:{page:3},inReadingLibrary:true};
const cloudFile={key:'books/'+ 'a'.repeat(64)+'.pdf',sha256:'a'.repeat(64),size:128};

function device(){
 const state={store:{version:7,syncRevision:3,data:notebook.normalize({...structuredClone(notebook.initialNotebook),setupCompleted:true,libraryBooks:[structuredClone(original)]}),sync:{...core.newSyncState('android-test'),target:'cloud-a',enabled:true},drafts:{reader:{text:'未保存的草稿'}}},writes:[],bookInfo:new Map(),transfers:[],reader:null};
 const native={
  readStore:async()=>({text:JSON.stringify(state.store)}),
  writeStore:async({text})=>{state.writes.push(text);state.store=JSON.parse(text);return {ok:true};},
  bookInfo:async({name})=>state.bookInfo.get(name)||{available:false,size:0,uri:''},
  transferBook:async input=>{state.transfers.push(structuredClone(input));return state.transfer?state.transfer(input):structuredClone(cloudFile);},
  setSyncConnection:async({config})=>{state.store={...state.store,syncRevision:state.store.syncRevision+1,sync:{...state.store.sync,target:config.target,enabled:false}};return {configured:true,target:config.target};},
 };
 const window={fetch:async()=>{throw Error('unexpected external request');}};
 state.module=load('mobile/platform.ts',{
  '@capacitor/app':{App:{}},'@capacitor/core':{Capacitor:{isNativePlatform:()=>true,convertFileSrc:uri=>uri},registerPlugin:name=>{assert.equal(name,'WenjianStorage');return native;}},
  '../lib/notebook-settings.cjs':settings,'../lib/maintenance.cjs':maintenance,'../lib/app-updates':updates,'../lib/notebook':notebook,'../lib/ocr-cache.cjs':ocrCache,'../lib/sync/core':core,
  '../lib/reader-platform':{setReaderPlatform:platform=>{state.reader=platform;}},
 },{window,location:{origin:'https://localhost'}});
 state.module.installMobileApi();
 state.api=async(route,payload,method=payload===undefined?'GET':'POST')=>{const response=await window.fetch(route,{method,...(payload===undefined?{}:{body:JSON.stringify(payload)})});return {status:response.status,body:await response.json()};};
 state.deferTransfer=()=>{let start,finish;const started=new Promise(resolve=>{start=resolve;}),done=new Promise(resolve=>{finish=resolve;});state.transfer=input=>{start(input);return done;};return {started,finish:()=>finish(structuredClone(cloudFile))};};
 return state;
}
const commit=(snapshot,sync=snapshot.sync,data=snapshot.data)=>({version:snapshot.version,syncRevision:snapshot.syncRevision,data,sync});

test('mobile idle saves, notebook PUT, identical drafts and sync commits do not write or advance revisions',async()=>{
 const phone=device(),before=await phone.module.mobileSnapshot();
 for(let index=0;index<20;index++){
  assert.equal((await phone.module.mobileSave(structuredClone(before.data),before.version)).version,before.version);
  const saved=await phone.api('/api/notebook',{version:before.version,data:before.data},'PUT');
  assert.equal(saved.status,200);assert.deepEqual(saved.body,JSON.parse(JSON.stringify(before)));
  const synced=await phone.api('/api/sync/commit',commit(before));
  assert.equal(synced.status,200);assert.deepEqual(synced.body,JSON.parse(JSON.stringify(before)));
  assert.equal((await phone.api('/api/drafts',{key:'reader',value:before.drafts.reader},'PUT')).status,200);
 }
 assert.equal(phone.writes.length,0,'idle checks must not touch native storage');
 assert.equal(phone.store.version,7);assert.equal(phone.store.syncRevision,3);
});

test('mobile real edits persist once, while stale notebook/sync CAS writes are rejected',async()=>{
 const phone=device(),before=await phone.module.mobileSnapshot(),changed=structuredClone(before.data);
 changed.notes[0].body='在安卓端继续写下中文与 emoji 📝';
 const saved=await phone.api('/api/notebook',{version:before.version,data:changed},'PUT');
 assert.equal(saved.status,200);assert.equal(saved.body.version,8);assert.equal(phone.writes.length,1);
 const repeated=await phone.api('/api/notebook',{version:saved.body.version,data:saved.body.data},'PUT');
 assert.equal(repeated.status,200);assert.equal(repeated.body.version,8);assert.equal(phone.writes.length,1);
 assert.equal((await phone.api('/api/notebook',{version:before.version,data:before.data},'PUT')).status,409);
 assert.equal((await phone.api('/api/sync/commit',commit(before))).status,409);
 await assert.rejects(phone.module.mobileSave(before.data,before.version),/有新内容/);
 const synced=await phone.api('/api/sync/commit',commit(saved.body,{...saved.body.sync,lastSync:'2026-10-13T01:00:00.000Z'}));
 assert.equal(synced.status,200);assert.equal(synced.body.version,8);assert.equal(synced.body.syncRevision,4);assert.equal(phone.writes.length,2);
 assert.equal((await phone.api('/api/sync/commit',commit(saved.body))).status,409,'stale sync revision cannot pass with the same data version');
 assert.equal((await phone.api('/api/sync/commit',commit(synced.body))).status,200);assert.equal(phone.writes.length,2);
 assert.equal(phone.store.data.notes[0].body,changed.notes[0].body);assert.deepEqual(phone.store.drafts,before.drafts);
});

test('mobile upload refuses a completed file from the previous sync connection',async()=>{
 const phone=device(),transfer=phone.deferTransfer(),pending=phone.api('/api/sync/book',{id:original.id,action:'upload'});
 const request=await transfer.started;assert.equal(request.target,'cloud-a');assert.equal(request.name,original.storedFile);
 assert.equal((await phone.api('/api/sync/settings',{target:'cloud-b'},'PUT')).status,200);
 transfer.finish();const result=await pending;
 assert.equal(result.status,500);assert.match(result.body.error,/同步连接已变化/);
 assert.equal(phone.writes.length,0,'stale transfer must not call native writeStore');
 assert.equal(phone.store.sync.target,'cloud-b');assert.equal(phone.store.data.libraryBooks[0].cloudFile,undefined);
 assert.equal(phone.store.version,7);assert.equal(phone.store.syncRevision,4);
});

test('mobile upload refuses a replaced or removed book without reverting the concurrent save',async()=>{
 for(const remove of [false,true]){
  const phone=device(),transfer=phone.deferTransfer(),pending=phone.api('/api/sync/book',{id:original.id,action:'upload',target:'cloud-a'});
  await transfer.started;
  const snapshot=await phone.module.mobileSnapshot(),changed=structuredClone(snapshot.data);
  changed.libraryBooks=remove?[]:changed.libraryBooks.map(book=>({...book,storedFile:'替换后的原件.pdf',title:'新版本书籍'}));
  assert.equal((await phone.api('/api/notebook',{version:snapshot.version,data:changed},'PUT')).status,200);
  transfer.finish();const result=await pending;
  assert.equal(result.status,500);assert.match(result.body.error,/书籍原件已变化/);
  assert.equal(phone.writes.length,1);assert.equal(phone.store.version,8);assert.equal(phone.store.syncRevision,3);
  assert.deepEqual(phone.store.data.libraryBooks,changed.libraryBooks);assert.deepEqual(phone.store.drafts,snapshot.drafts);
 }
});

test('mobile successful upload merges into the latest notebook and preserves concurrent notes',async()=>{
 const phone=device(),transfer=phone.deferTransfer(),pending=phone.api('/api/sync/book',{id:original.id,action:'upload'});
 await transfer.started;
 const before=await phone.module.mobileSnapshot(),changed=structuredClone(before.data);
 changed.notes[0].body='传输过程中写下的思考';changed.libraryBooks[0].progress.page=10;
 const local=await phone.api('/api/notebook',{version:before.version,data:changed},'PUT');assert.equal(local.status,200);
 transfer.finish();const result=await pending;
 assert.equal(result.status,200);assert.deepEqual(result.body.cloudFile,cloudFile);
 assert.equal(phone.store.version,9);assert.equal(phone.writes.length,2);assert.equal(phone.store.syncRevision,3);
 assert.equal(phone.store.data.notes[0].body,changed.notes[0].body);assert.equal(phone.store.data.libraryBooks[0].progress.page,10);
 assert.deepEqual(phone.store.data.libraryBooks[0].cloudFile,cloudFile);assert.deepEqual(phone.store.drafts,before.drafts);
});

test('mobile book availability rejects missing, empty and size-mismatched originals',async()=>{
 const phone=device(),book={...original,cloudFile};
 assert.equal(await phone.module.mobileBookAvailable(book),false);
 phone.bookInfo.set(book.storedFile,{available:false,size:0,uri:'file:///empty.pdf'});
 assert.equal(await phone.module.mobileBookAvailable(book),false);
 phone.bookInfo.set(book.storedFile,{available:true,size:0,uri:'file:///empty.pdf'});
 assert.equal(await phone.module.mobileBookAvailable(book),false);
 phone.bookInfo.set(book.storedFile,{available:true,size:cloudFile.size-1,uri:'file:///partial.pdf'});
 assert.equal(await phone.module.mobileBookAvailable(book),false);
 phone.bookInfo.set(book.storedFile,{available:true,size:cloudFile.size,uri:'file:///verified.pdf'});
 assert.equal(await phone.module.mobileBookAvailable(book),true);
 assert.equal(await phone.module.mobileBookAvailable(original),true,'local imports can be available before they have cloud metadata');
 assert.equal(phone.writes.length,0);assert.equal(phone.transfers.length,0,'availability probes must not start a transfer');
});

test('mobile reading view avoids copying sync history while native history remains intact',async()=>{const phone=device(),full=await phone.module.mobileSnapshot(),view=await phone.module.mobileViewSnapshot();assert.equal(view.sync,undefined);assert.deepEqual(view.data,full.data);assert.deepEqual(JSON.parse(JSON.stringify(phone.store.sync)),full.sync);assert.deepEqual((await phone.module.mobileSnapshot()).sync,full.sync);assert.equal(phone.writes.length,0);});


test('mobile maintenance batch preserves children, recovery history, later writes and sync state',async()=>{
 const phone=device();phone.store.data.cards=[{id:'parent',text:'原话',thoughts:[{id:'child',text:'后续思考'}]},{id:'other',text:'其他卡片',thoughts:[]}];phone.store.data.thoughtReplies=[{id:'reply',thoughtId:'child',text:'回答'}];
 const first=await phone.api('/api/notebook/maintenance',{version:7,action:'remove',targets:[{kind:'card',id:'parent'}],confirmed:true,confirmation:'删除'});assert.equal(first.status,200);assert.equal(phone.store.localTrash.length,1);assert(phone.store.data.cards.some(c=>c.thoughts.some(t=>t.id==='child')));assert.equal(phone.store.data.thoughtReplies.length,1);
 const data=structuredClone(phone.store.data);data.libraryBooks[0].readingCompletion={finished:true,at:'2026-10-15T00:00:00Z'};await phone.api('/api/notebook',{version:phone.store.version,data},'PUT');assert.equal(phone.store.localTrash.length,1);assert.deepEqual(phone.store.drafts,{reader:{text:'未保存的草稿'}});
 const view=await phone.module.mobileViewSnapshot();assert.equal(view.localTrash,undefined);const list=await phone.api('/api/notebook/maintenance');assert.equal(list.body.entries.length,1);
 const restored=await phone.api('/api/notebook/maintenance',{version:phone.store.version,action:'restore',receiptId:first.body.receiptId,confirmed:true,confirmation:'删除'});assert.equal(restored.status,200);assert(restored.body.data.cards.some(c=>c.id==='parent'));assert(restored.body.data.libraryBooks[0].readingCompletion.finished);assert.equal(phone.store.localTrash.length,0);assert.equal(phone.store.sync.target,'cloud-a');
});

test('mobile maintenance rejects stale or unconfirmed changes without writing',async()=>{const p=device(),n=p.writes.length;assert.equal((await p.api('/api/notebook/maintenance',{version:0,action:'remove'})).status,409);assert.equal((await p.api('/api/notebook/maintenance',{version:7,action:'remove'})).status,500);assert.equal(p.writes.length,n);});
