import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {z} from 'zod';
function load(file, imports){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in imports))throw Error(name);return imports[name];},Response,console});
 return module.exports;
}
const notebook=load('lib/notebook.ts',{});
const deletion=load('lib/deletion.ts',{});
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
const first=read();
first.notes.push({...first.notes[1],id:'child',parent:'language',order:1,title:'子板块'});
first.crossThoughts.push({id:'cross',title:'语言与诚实',anchorIds:['language','child'],text:'',origin:'自己的思考',source:'',at:'today',thoughts:[]});
await put(first);
let next=read();
next.readingNotes.push({id:'reading',questionIds:['cross'],book:'书',author:'作者',chapter:'一',locator:'1',quote:'原文',interpretation:'理解',at:'today',thoughts:[]});
next.crossThoughts[0].thoughts.push({id:'thought',text:'后续思考',origin:'自己的思考',reason:'',at:'today'});
await put(next);
next=read();next.crossThoughts[0].anchorIds=['world','child'];await put(next);
assert.equal(read().readingNotes[0].quote,'原文');assert.equal(read().crossThoughts[0].thoughts[0].text,'后续思考');
next=read();next.crossThoughts[0].anchorIds=['world'];await put(next,400);
next=read();next.crossThoughts[0].anchorIds=['world','world'];await put(next,400);
next=read();next.crossThoughts[0].anchorIds=['world','missing'];await put(next,400);
next=read();next.crossThoughts[0].thoughts=[];await put(next,400);
next=read();next.readingNotes[0].quote='覆盖';await put(next,400);
await put(read(),409,0);
const r=await api.DELETE(new Request('http://test/api/notebook',{method:'DELETE',body:JSON.stringify({id:'child',title:'子板块',version:state.version,confirmed:true,confirmation:'删除'})}));assert.equal(r.status,200);
assert.equal(read().crossThoughts.length,1);assert.equal(read().readingNotes.length,1);
await put(read());
next=read();next.crossThoughts[0].anchorIds=['world','language'];await put(next);
assert.equal(read().crossThoughts[0].thoughts.length,1);
console.log('PASS: create, readings, append, adjust, validation, conflicts, deletion preservation and reconnect');
