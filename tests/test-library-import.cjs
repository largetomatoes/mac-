const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { importLibraryFile } = require('../work/mac-app/asar-src/library-import.js');
async function fixture(t) {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wenjian-import-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const libraryDir=path.join(directory,'library');await fs.mkdir(libraryDir);
 return {directory,libraryDir};
}
test('adding a Zotero original to reading reuses its book ID, source, notes identity and file',async t=>{
 const {directory,libraryDir}=await fixture(t);
 const source=path.join(directory,'renamed-original.pdf');await fs.writeFile(source,'%PDF-1.7\nOriginal content');
 await fs.copyFile(source,path.join(libraryDir,'zotero-original.pdf'));
 const book={id:'zotero-fixture',title:'My retained title',author:'Author',storedFile:'zotero-original.pdf',format:'pdf',folderId:'reading',progress:{page:9},zotero:{itemKey:'BOOK0001',annotations:[{key:'ANN00001',text:'Original excerpt'}]},inReadingLibrary:false};
 const imported=await importLibraryFile({source,libraryDir,books:[book]});
 assert.deepEqual(imported,{...book,inReadingLibrary:true});assert.equal(book.inReadingLibrary,false);
 assert.deepEqual(await fs.readdir(libraryDir),['zotero-original.pdf']);
});
test('same title with different bytes stays a separate book',async t=>{
 const {directory,libraryDir}=await fixture(t),source=path.join(directory,'Title.pdf');
 await fs.writeFile(source,'%PDF-1.7\nChanged original');await fs.writeFile(path.join(libraryDir,'old.pdf'),'%PDF-1.7\nAnother original');
 const imported=await importLibraryFile({source,libraryDir,books:[{id:'old',format:'pdf',storedFile:'old.pdf',title:'Title'}]});
 assert.notEqual(imported.id,'old');assert.equal(imported.inReadingLibrary,true);
 assert.deepEqual(await fs.readFile(path.join(libraryDir,imported.storedFile)),await fs.readFile(source));
 assert.equal(await fs.readFile(path.join(libraryDir,'old.pdf'),'utf8'),'%PDF-1.7\nAnother original');
});
test('repeated reading import is idempotent and also handles EPUB',async t=>{
 const {directory,libraryDir}=await fixture(t),source=path.join(directory,'Book.epub');await fs.writeFile(source,'PK\x03\x04fake-epub-for-copy-test');
 const first=await importLibraryFile({source,libraryDir});const second=await importLibraryFile({source,libraryDir,books:[first]});
 assert.deepEqual(second,first);assert.equal((await fs.readdir(libraryDir)).length,1);
});
test('missing and unsafe stored-file records do not replace existing books',async t=>{
 const {directory,libraryDir}=await fixture(t),source=path.join(directory,'Book.pdf');await fs.writeFile(source,'%PDF-1.7\nOriginal');
 const book=await importLibraryFile({source,libraryDir,books:[{id:'unsafe',format:'pdf',storedFile:'../Book.pdf'},{id:'missing',format:'pdf',storedFile:'gone.pdf'}]});
 assert.notEqual(book.id,'unsafe');assert.notEqual(book.id,'missing');assert.ok(book.inReadingLibrary);
});
test('non-book inputs are rejected before creating originals',async t=>{
 const {directory,libraryDir}=await fixture(t),source=path.join(directory,'Notes.txt');await fs.writeFile(source,'notes');
 await assert.rejects(importLibraryFile({source,libraryDir}),/PDF/);assert.deepEqual(await fs.readdir(libraryDir),[]);
});
