import ocrCache from '../lib/ocr-cache.cjs';
import settings from '../lib/notebook-settings.cjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {z} from 'zod';

function load(file,imports={}) {
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{
  if(!(name in imports))throw new Error(`Missing test import: ${name}`);
  return imports[name];
 },Response,console});
 return module.exports;
}

const folders=load('lib/library-folders.ts');
const notebook=load('lib/notebook.ts',{'./library-folders':folders});
const deletion=load('lib/deletion.ts',{'./notebook':notebook});
const book={id:'book',title:'现代资本主义',author:'桑巴特',format:'pdf',storedFile:'book.pdf',originalName:'book.pdf',addedAt:'today',progress:{page:20,totalPages:300}};
const data=structuredClone(notebook.initialNotebook);
data.setupCompleted=true;data.zoteroEnabled=true;data.notes.push({...structuredClone(data.notes[0]),id:'language',parent:'world',title:'测试子问题'});
delete data.libraryFolders;
data.libraryBooks=[book,{...book,id:'epub',format:'epub',storedFile:'book.epub'}];
data.bookThoughts=[{id:'thought',libraryBookId:'book',bookTitle:book.title,text:'自己的思考',scope:'book',locator:'',questionIds:[],at:'today',thoughts:[]}];
data.readingNotes=[{id:'reading',libraryBookId:'book',questionIds:['language'],book:book.title,author:book.author,chapter:'第一章',locator:'第 20 页',quote:'原文',interpretation:'自己的理解',at:'today',thoughts:[]}];
const original=JSON.stringify(data);
assert.equal(notebook.normalize(data).libraryFolders.length,0,'legacy notebook needs no migration');
assert.equal(folders.folderForBook(book,[]),null);

let classified=folders.addLibraryFolder(data,{id:'economy',name:'  经济史  '});
classified=folders.addLibraryFolder(classified,{id:'philosophy',name:'哲学'});
classified=folders.assignBookFolder(classified,'book','economy');
classified=folders.assignBookFolder(classified,'epub','philosophy');
assert.equal(folders.folderForBook(classified.libraryBooks[0],classified.libraryFolders),'economy');
assert.equal(classified.libraryFolders[0].name,'经济史');
assert.equal(JSON.stringify(data),original,'classification never mutates the input or notes');
const renamed=folders.renameLibraryFolder(classified,'economy','社会与经济');
assert.equal(renamed.libraryBooks[0].folderId,'economy','rename does not disconnect books');
assert.equal(renamed.libraryFolders[0].name,'社会与经济');
assert.throws(()=>folders.addLibraryFolder(renamed,{id:'duplicate',name:' 社会与经济 '}),/同名/);
assert.throws(()=>folders.renameLibraryFolder(renamed,'economy','哲学'),/同名/);
assert.throws(()=>folders.renameLibraryFolder(renamed,'economy','  '),/名称/);
assert.throws(()=>folders.renameLibraryFolder(renamed,'economy','长'.repeat(101)),/100/);
assert.throws(()=>folders.assignBookFolder(renamed,'book','missing'),/不存在/);
assert.throws(()=>folders.assignBookFolder(renamed,'missing','economy'),/不存在/);

const removed=folders.removeLibraryFolder(renamed,'economy');
assert.equal(removed.libraryBooks.length,2,'removing a folder retains every book');
assert.equal(removed.libraryBooks[0].folderId,undefined);
assert.equal(removed.libraryBooks[1].folderId,'philosophy','other classifications are retained');
assert.equal(removed.readingNotes,renamed.readingNotes);
assert.equal(removed.bookThoughts,renamed.bookThoughts);
assert.equal(removed.libraryBooks[0].storedFile,book.storedFile);
assert.equal(removed.libraryBooks[0].progress,book.progress);
assert.equal(folders.assignBookFolder(renamed,'book',null).libraryBooks[0].folderId,undefined);

const restored=notebook.normalize(JSON.parse(JSON.stringify(renamed)));
assert.equal(restored.libraryBooks[0].folderId,'economy','classification survives save/reload');
assert.equal(restored.libraryFolders[0].name,'社会与经济');
const orphan=notebook.normalize({...data,libraryBooks:[{...book,folderId:'old-folder'}]});
assert.equal(folders.folderForBook(orphan.libraryBooks[0],orphan.libraryFolders),null);
assert.equal(orphan.libraryBooks[0].folderId,'old-folder','unknown references are not silently discarded');
const normalized=folders.normalizeLibraryFolders([null,{id:'empty',name:' '},{id:'f',name:'  文件夹  '},{id:'f',name:'重复'},{id:'g',name:'另一个'}]);
assert.equal(JSON.stringify(normalized),JSON.stringify([{id:'f',name:'文件夹'},{id:'g',name:'另一个'}]));

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
await put(renamed);
let saved=JSON.parse(state.content);
assert.equal(saved.libraryFolders[0].name,'社会与经济','server does not strip folder data');
assert.equal(saved.libraryBooks[0].folderId,'economy');
await put(folders.removeLibraryFolder(saved,'economy'));
saved=JSON.parse(state.content);
assert.equal(saved.libraryBooks[0].folderId,undefined);
assert.equal(saved.readingNotes.length,1);
assert.equal(saved.bookThoughts.length,1);
const savedBeforeInvalid=state.content;
await put({...saved,libraryFolders:[{id:'f',name:'A'},{id:'f',name:'B'}]},400);
await put({...saved,libraryFolders:[{id:'f',name:' '}]},400);
await put({...saved,libraryBooks:saved.libraryBooks.map(b=>({...b,folderId:'missing'}))},400);
assert.equal(state.content,savedBeforeInvalid,'invalid folders cannot silently replace saved data');
state={version:0,content:JSON.stringify(orphan)};
await put(orphan);
assert.equal(JSON.parse(state.content).libraryBooks[0].folderId,'old-folder','an old orphan does not prevent later note saves');
console.log('PASS: legacy compatibility, folder creation/rename/removal, preserved books and notes, save/reload, API persistence and validation');
