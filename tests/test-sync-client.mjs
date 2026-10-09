import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import ts from 'typescript';import {webcrypto} from 'node:crypto';
function load(path,imports={},extra={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>imports[name],crypto:webcrypto,structuredClone,TextEncoder,CustomEvent,window:{dispatchEvent(){}},...extra});return module.exports;}
const core=load('lib/sync/core.ts'),cloud=new Map();const seed=JSON.parse(fs.readFileSync('work/mac-app/seed.json')).data;
function device(data=seed){const state={store:{version:0,syncRevision:0,data:structuredClone(data),sync:{...core.newSyncState(),enabled:true}},fail:false,onList:null,puts:0,failPut:0,bookAttempts:[]};state.api=load('lib/sync/client.ts',{'./core':core},{fetch:async(url,request={})=>{
 const body=request.body?JSON.parse(request.body):{},route=url.split('/').at(-1);let result,status=200;
 if(route==='identity')result={configured:true,target:'cn-test/example/wenjian/'};
 else if(route==='local')result=structuredClone(state.store);
 else if(route==='commit'){if(body.version!==state.store.version||(body.syncRevision||0)!==state.store.syncRevision){result={error:'concurrent write'};status=409;}else {state.store={version:state.store.version+(core.stable(body.data)===core.stable(state.store.data)?0:1),syncRevision:state.store.syncRevision+1,data:structuredClone(body.data),sync:structuredClone(body.sync)};result=structuredClone(state.store);}}
 else if(route==='remote'){if(state.fail)throw Error('offline');if(body.action==='put'){state.puts++;if(state.failPut===state.puts)throw Error('interrupted upload');cloud.set(body.key,body.text);result={ok:true};}else if(body.action==='get')result={text:cloud.get(body.key)};else {if(state.onList){const fn=state.onList;state.onList=null;fn();}result={keys:[...cloud.keys()]};}}
 else if(route==='book'){if(body.action==='status')result={available:true};else {state.bookAttempts.push(body.id);if(body.id==='book-fail')throw Error('oversized book');state.store.data.libraryBooks=state.store.data.libraryBooks.map(book=>book.id===body.id?{...book,cloudFile:{key:'books/'+'c'.repeat(64)+'.pdf',sha256:'c'.repeat(64),size:22}}:book);state.store.version++;result={ok:true};}}
 else throw Error('unexpected endpoint');return {ok:status===200,status,json:async()=>result};}});return state;}
const data=structuredClone(seed);data.setupCompleted=true;data.notes[0].title='虚构同步问题';const mac=device(data),win=device(),phone=device();
await mac.api.syncNow();await win.api.syncNow();await phone.api.syncNow();assert.equal(phone.store.data.notes[0].title,'虚构同步问题');assert.equal(win.store.data.notes[0].title,'虚构同步问题');
const makeCard=(id,text)=>({id,text,origin:'自己的思考',source:'',at:new Date().toISOString(),thoughts:[]});mac.store.data.cards.push(makeCard('card-mac','电脑思考'));mac.store.version++;phone.store.data.cards.push(makeCard('card-phone','手机注解'));phone.store.version++;
phone.fail=true;await assert.rejects(phone.api.syncNow());assert(phone.store.sync.pending.length>0,'pending changes persisted offline');phone.fail=false;await phone.api.syncNow();await mac.api.syncNow();await win.api.syncNow();await phone.api.syncNow();assert.equal(phone.store.data.cards.length,2);assert.equal(win.store.data.cards.length,2);
mac.onList=()=>{mac.store.data.cards.push(makeCard('card-during','同步传输期间继续输入'));mac.store.version++;};await mac.api.syncNow();assert(mac.store.data.cards.some(c=>c.id==='card-during'),'save during network preserved');assert(mac.store.sync.pending.some(op=>op.key==='cards/card-during'),'new edit queued for next upload');await mac.api.syncNow();await phone.api.syncNow();assert(phone.store.data.cards.some(c=>c.id==='card-during'));
const versionsBefore=cloud.size;await phone.api.syncNow();assert.equal(cloud.size,versionsBefore,'unchanged run does not add cloud files');
// An incorrect body for a hash-addressed object must never be applied.
const bad='changes/'+ 'a'.repeat(64)+'.json';cloud.set(bad,'{}');const before=structuredClone(win.store.data);await assert.rejects(win.api.syncNow(),/校验失败/);assert.equal(core.stable(win.store.data),core.stable(before));cloud.delete(bad);
// Resolve a conflict after an unrelated local edit: neither CAS metadata nor the edit may be lost.
mac.store.data.cards.find(c=>c.id==='card-mac').text='电脑版本';mac.store.version++;
phone.store.data.cards.find(c=>c.id==='card-mac').text='手机版本';phone.store.version++;
await mac.api.syncNow();await phone.api.syncNow();await mac.api.syncNow();
const conflict=core.materialize(mac.store.sync,mac.store.data).conflicts.find(c=>c.key==='cards/card-mac');assert(conflict);
mac.store.data.cards.push(makeCard('resolution-edit','选择冲突前的新思考'));mac.store.version++;
await mac.api.resolveSync(conflict.key,conflict.options[0].id);assert(mac.store.data.cards.some(c=>c.id==='resolution-edit'));
assert.equal(core.materialize(mac.store.sync,mac.store.data).conflicts.length,0);await mac.api.syncNow();await phone.api.syncNow();assert(phone.store.data.cards.some(c=>c.id==='resolution-edit'));
console.log('PASS: three-device onboarding, offline durable queue, independent edits, concurrent local saves during transfer, retry idempotency, unchanged sync and corrupted downloads');

// Manual sync remains available while automatic sync is paused.
phone.store.sync.enabled=false;phone.store.data.cards.push(makeCard('paused-manual','暂停后手动同步'));phone.store.version++;
await phone.api.syncNow();assert.equal(phone.store.sync.enabled,false);await mac.api.syncNow();assert(mac.store.data.cards.some(card=>card.id==='paused-manual'));
// Partial upload acknowledgements survive a later failed batch, keeping the account bound.
const partial=device();partial.store.data.setupCompleted=true;partial.store.data.cards=[makeCard('large-a','a'.repeat(3*1024*1024)),makeCard('large-b','b'.repeat(3*1024*1024))];partial.store.version++;partial.failPut=2;
await assert.rejects(partial.api.syncNow(),/interrupted/);assert.equal(partial.store.sync.published.length,1);assert(partial.store.sync.pending.length>0);partial.failPut=0;await partial.api.syncNow();assert.equal(partial.store.sync.pending.length,0);
// A bad book does not block another book or hide successful note sync.
const books=device();books.store.data.setupCompleted=true;books.store.data.libraryBooks=[{id:'book-fail',title:'虚构大文件',format:'pdf',storedFile:'fake-a.pdf'},{id:'book-ok',title:'虚构小文件',format:'pdf',storedFile:'fake-b.pdf'}];books.store.version++;
const notes=await books.api.syncNow();notes.data.libraryBooks.sort((a,b)=>a.id==='book-fail'?-1:b.id==='book-fail'?1:0);const result=await books.api.syncBooks(notes);assert.deepEqual(books.bookAttempts,['book-fail','book-ok']);assert(result.sync.books.errors['book-fail']);assert(!result.sync.books.errors['book-ok']);assert(result.data.libraryBooks.find(book=>book.id==='book-ok').cloudFile);assert(result.sync.lastSync);
console.log('PASS: paused manual sync, durable partial-upload binding, individual book retries and successful book manifests');
