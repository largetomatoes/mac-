import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Exercise the actual native request handler: a cloud association must not
// prevent an existing local original being read when cross-device writes pause.
const source=fs.readFileSync('work/mac-app/asar-src/main.js','utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const handler=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='handleDeviceSync');
assert(handler);
let networkCalls=0,reads=0;
const context={URL,path,ORGANIZATION_TRIAL:true,TRIAL_SYNC_NOTICE:'cloud writes paused',localPort:51234,
 requestBody:async request=>request.input,
 readStore:async()=>({data:{libraryBooks:[{id:'local-cloud',format:'pdf',storedFile:'local.pdf',cloudFile:{size:300}}]}}),
 fsp:{stat:async()=>{reads++;return {isFile:()=>true,size:300};}},libraryDir:'/local-library',
 jsonReply:(response,status,body)=>Object.assign(response,{status,body}),
 activeSyncClient:async()=>{networkCalls++;throw Error('Must not access a cloud service');},
};
vm.createContext(context);vm.runInContext(handler.getText(ast)+';this.handle=handleDeviceSync;',context);
async function request(route,input){const response={};await context.handle({headers:{host:'127.0.0.1:51234'},input},response,new URL('http://127.0.0.1:51234/api/sync/'+route));return response;}
const status=await request('book',{action:'status',id:'local-cloud'});
assert.equal(status.status,200);assert.equal(status.body.available,true);assert.equal(reads,1);
for(const action of ['upload','download'])assert.equal((await request('book',{action,id:'local-cloud'})).status,423);
for(const route of ['remote','commit','detach','backup-restore'])assert.equal((await request(route,{})).status,423);
assert.equal(networkCalls,0,'local availability check must be offline');

const module={exports:{}},calls=[];
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reader-platform.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 module,exports:module.exports,fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return {ok:true,json:async()=>({available:true})};},encodeURIComponent,
});
assert.equal(await module.exports.readerFileUrl({id:'local-cloud',cloudFile:{size:300}}),'/api/library/file/local-cloud');
assert.deepEqual(calls,[{action:'status',id:'local-cloud'}]);
calls.length=0;assert.equal(await module.exports.readerFileUrl({id:'imported-local'}),'/api/library/file/imported-local');assert.equal(calls.length,0);
console.log('PASS: local originals with cloud metadata remain readable offline while cloud transfers and commits are paused; no cloud request or re-download.');
