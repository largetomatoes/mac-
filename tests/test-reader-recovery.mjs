import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
function load(file){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,AbortController,DOMException});return module.exports;}
const {OcrTaskController,waitForOcr}=load('lib/ocr-task.ts');
const gate=new OcrTaskController(),first=gate.start('book:1');
assert.equal(gate.start('book:2'),null);
// An OCR job that never resolves (the actual behavior after terminate).
const waiting=waitForOcr(new Promise(()=>{}),first.signal);
assert.equal(gate.cancel(),'book:1');
await assert.rejects(waiting,{name:'AbortError'});
assert.equal(gate.busy,false);
const second=gate.start('book:2');first.finish();
assert.equal(gate.busy,true,'old finally cannot unlock the new page');
assert.equal(first.isCurrent(),false);assert.equal(second.isCurrent(),true);
assert.equal(await waitForOcr(Promise.resolve('recognized'),second.signal),'recognized');
second.finish();assert.equal(gate.busy,false);
const hidden=gate.start('book:3');gate.cancel();
await assert.rejects(waitForOcr(Promise.resolve('stale'),hidden.signal),{name:'AbortError'});
assert.ok(gate.start('book:3'),'the cancelled page can be retried');gate.cancel();
const {findBookText}=load('lib/book-search.ts');
let hits=findBookText('这 是 原 文。\n另一处 原文。','原文');
assert.equal(hits.length,2);assert.equal(hits[0].match,'原 文');assert.equal(hits[1].match,'原文');
hits=findBookText('First Reading\nconnects ideas. Reading connects again.','reading connects');
assert.equal(hits.length,2);assert.equal(hits[0].match,'Reading\nconnects');
assert.equal(findBookText('abc',' ').length,0);assert.equal(findBookText('one one one','ONE',2).length,2);
assert.equal(findBookText('生命😀世界','😀世界')[0].start,2);
console.log('PASS: interrupted OCR settles, ownership survives stale cleanup, retry works; Chinese/English multiline search preserves exact offsets and quotations.');
// Exercise the real JSX copy handlers with an isolated clipboard, never the OS clipboard.
const reader=ts.createSourceFile('reader.tsx',fs.readFileSync('components/library-reader.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),copyHandlers=[];
function visit(node){if(ts.isJsxAttribute(node)&&node.name.getText(reader)==='onCopy')copyHandlers.push(node.initializer.expression.getText(reader));ts.forEachChild(node,visit);}visit(reader);
assert.equal(copyHandlers.length,2);
const {cleanReadingText}=load('lib/reader-text.ts');
for(const handler of copyHandlers){let prevented=false,copied='';const copy=vm.runInNewContext(`(${handler})`,{window:{getSelection:()=>({toString:()=> '我 们 如 何\nEnglish  words'})},cleanReadingText});copy({preventDefault:()=>prevented=true,clipboardData:{setData:(type,value)=>{assert.equal(type,'text/plain');copied=value;}}});assert.equal(prevented,true);assert.equal(copied,'我们如何\nEnglish words');}
console.log('PASS: native PDF and OCR copy handlers preserve English spaces and clean Chinese layout spaces using an isolated clipboard.');
// Chromium's rendered Selection text can omit spaces at absolute word boxes.
// The underlying DOM Range must supply both clipboard text and note excerpts.
const original='Reading connects ideas.\nAnother line',range={toString:()=>original,commonAncestorContainer:{},getBoundingClientRect:()=>({top:10,height:10})};
const selection={rangeCount:1,isCollapsed:false,toString:()=>original.replace(/\s/g,''),getRangeAt:()=>range};
let rangeCopy='';vm.runInNewContext(`(${copyHandlers[1]})`,{window:{getSelection:()=>selection},cleanReadingText})({preventDefault(){},clipboardData:{setData:(_,value)=>rangeCopy=value}});assert.equal(rangeCopy,original);
let excerpt,selectionFunction;
function findSelection(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='selectPdfText')selectionFunction=node.getText(reader);ts.forEachChild(node,findSelection);}findSelection(reader);
const selectionCode=ts.transpileModule(selectionFunction,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(selectionCode+';selectPdfText();',{window:{getSelection:()=>selection},cleanReadingText,ocrTextLayerRef:{current:{contains:()=>true}},pdfTextLayerRef:{current:null},pdfPageRef:{current:null},page:1,selectionMenu:()=>undefined,setExcerpt:value=>excerpt=value});assert.equal(excerpt.quote,original);
console.log('PASS: real copy/note handlers read OCR Range text without dropping English spaces or line breaks.');
if(process.argv.includes('--real-ocr')){
 const {createWorker}=await import('tesseract.js');
 const worker=await createWorker('eng',1,{langPath:fileURLToPath(new URL('../work/mac-app/local-spa/dist/reader/ocr/',import.meta.url)),cacheMethod:'none'});
 const active=gate.start('real:1');let settled=false;
 const pending=waitForOcr(worker.recognize(fileURLToPath(new URL('../work/reader-qa/scan.png',import.meta.url))),active.signal).finally(()=>{settled=true;active.finish();});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await new Promise(resolve=>setTimeout(resolve,15));gate.cancel();await worker.terminate();await rejected;
 assert.equal(settled,true);assert.ok(gate.start('real:2'));gate.cancel();
 console.log('PASS: real Tesseract recognize interrupted; promise settled and the following page can start.');
}
