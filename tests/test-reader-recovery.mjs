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
const {cleanReadingText,reflowReadingExcerpt}=load('lib/reader-text.ts');
for(const handler of copyHandlers){let prevented=false,copied='';const copy=vm.runInNewContext(`(${handler})`,{window:{getSelection:()=>({toString:()=> '我 们 如 何\nEnglish  words'})},cleanReadingText,reflowReadingExcerpt});copy({preventDefault:()=>prevented=true,clipboardData:{setData:(type,value)=>{assert.equal(type,'text/plain');copied=value;}}});assert.equal(prevented,true);assert.equal(copied,'我们如何 English words');}
console.log('PASS: native PDF and OCR copy handlers preserve English spaces and clean Chinese layout spaces using an isolated clipboard.');
// Chromium's rendered Selection text can omit spaces at absolute word boxes.
// The underlying DOM Range must supply both clipboard text and note excerpts.
const original='Reading connects ideas.\nAnother line',range={toString:()=>original,commonAncestorContainer:{},getBoundingClientRect:()=>({top:10,height:10})};
const selection={rangeCount:1,isCollapsed:false,toString:()=>original.replace(/\s/g,''),getRangeAt:()=>range};
let rangeCopy='';vm.runInNewContext(`(${copyHandlers[1]})`,{window:{getSelection:()=>selection},cleanReadingText,reflowReadingExcerpt})({preventDefault(){},clipboardData:{setData:(_,value)=>rangeCopy=value}});assert.equal(rangeCopy,'Reading connects ideas. Another line');
let excerpt,selectionFunction;
function findSelection(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='selectPdfText')selectionFunction=node.getText(reader);ts.forEachChild(node,findSelection);}findSelection(reader);
const selectionCode=ts.transpileModule(selectionFunction,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(selectionCode+';selectPdfText();',{window:{getSelection:()=>selection},cleanReadingText,reflowReadingExcerpt,selectionSharedRef:{current:false},sharedSelectionPressed:()=>false,shortcutRef:{current:'Alt'},ocrTextLayerRef:{current:{contains:()=>true}},pdfTextLayerRef:{current:null},pdfPageRef:{current:null},page:1,selectionMenu:()=>undefined,acceptExcerpt:value=>excerpt=value});assert.equal(excerpt.quote,'Reading connects ideas. Another line');assert.equal(excerpt.rawQuote,original);assert.equal(excerpt.sourceLocation,'pdf:1');
console.log('PASS: real copy/note handlers reflow visual breaks while preserving Range spaces, raw quotation and source locator.');
function readerFunction(name){let found;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(reader);ts.forEachChild(node,visit);}visit(reader);assert.ok(found,`reader function ${name} exists`);return ts.transpileModule(found,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
// Reflow can remove a discretionary hyphen; source matching must still use the
// original OCR text, otherwise a successfully saved highlight disappears.
const originalHyphen='soft\u00ad\nware',textNode={data:originalHyphen},highlightRanges=[];
vm.runInNewContext(readerFunction('applyPdfHighlights')+';applyPdfHighlights();',{
 paneKey:'test-pane',requestAnimationFrame:callback=>callback(),window:{Highlight:class{constructor(...ranges){highlightRanges.push(...ranges);}}},CSS:{highlights:{delete(){},set(){}}},
 document:{getElementById:()=>true,createTreeWalker:()=>{let read=false;return {nextNode:()=>read?null:(read=true,textNode)};},createRange:()=>({setStart(node,offset){this.start=offset;},setEnd(node,offset){this.end=offset;}})},NodeFilter:{SHOW_TEXT:4},
 dataRef:{current:{libraryHighlights:[{libraryBookId:'b',sourceLocation:'pdf:1',quote:'software',rawQuote:originalHyphen}]}},activeId:'b',page:1,pdfTextLayerRef:{current:null},ocrTextLayerRef:{current:{}},...load('lib/reader-text.ts'),
});
assert.equal(highlightRanges.length,1);assert.equal(highlightRanges[0].start,0);assert.equal(highlightRanges[0].end,originalHyphen.length);
let savedNote;
const sourceExcerpt={quote:'software',rawQuote:originalHyphen,locator:'第 4 页',sourceLocation:'pdf:4',chapter:'',anchorY:.42};
await vm.runInNewContext(readerFunction('saveReadingNote')+';saveReadingNote({preventDefault(){}});',{
 currentSource:()=>({id:'source',libraryBookId:'b',bookTitle:'测试书',...sourceExcerpt}),active:{id:'b',title:'测试书',format:'pdf'},excerpt:sourceExcerpt,interpretation:'我的理解',questionIds:[],chapter:'测试章节',page:4,
 data:{libraryBooks:[{id:'b'}],readingNotes:[]},crypto:{randomUUID:()=> 'new-note'},clean:value=>value.trim(),
 save:async data=>{savedNote=data.readingNotes[0];return false;},
});
assert.equal(savedNote.quote,'software');assert.equal(savedNote.rawQuote,originalHyphen);assert.equal(savedNote.sourceLocation,'pdf:4');assert.equal(savedNote.anchorY,.42);
let layoutControl;
function findLayoutControl(node){if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(reader)==='button'&&node.getText(reader).includes('保留原文分行')){let expression=node.parent;while(expression&&!ts.isJsxExpression(expression))expression=expression.parent;layoutControl=expression.expression.getText(reader);}ts.forEachChild(node,findLayoutControl);}findLayoutControl(reader);
assert.ok(layoutControl);
const layoutCode=ts.transpileModule(`const control=(${layoutControl});control;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const renderLayout=excerpt=>vm.runInNewContext(layoutCode,{React:{createElement:(tag,props,...children)=>({tag,props,children})},excerpt,reflowReadingExcerpt,setExcerpt:value=>savedNote=value});
renderLayout(sourceExcerpt).props.onClick();assert.equal(savedNote.quote,originalHyphen);assert.equal(savedNote.sourceLocation,sourceExcerpt.sourceLocation);
renderLayout({...sourceExcerpt,quote:originalHyphen}).props.onClick();assert.equal(savedNote.quote,'software');
assert.equal(renderLayout({...sourceExcerpt,quote:'校对后的自定义摘录'}),false,'layout controls cannot discard manual quotation corrections');
console.log('PASS: raw quotations preserve source highlight ranges and saved note anchors after reflow removes a discretionary hyphen.');
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

let accepted=null,selectionError='';const draftState={processExcerpt:{sourceLocation:'pdf:1',quote:'old quote'},interpretation:'unsaved comment'};
const acceptContext={bookDraftsRef:{current:{book:draftState}},viewRef:{current:{activeId:'book'}},setReaderError:value=>selectionError=value,setExcerpt:value=>accepted=value};
vm.runInNewContext(readerFunction('acceptExcerpt')+";acceptExcerpt({sourceLocation:'pdf:2',quote:'new quote'});",acceptContext);assert.equal(accepted,null);assert.ok(selectionError);
vm.runInNewContext(readerFunction('acceptExcerpt')+";acceptExcerpt({sourceLocation:'pdf:1',quote:'old quote'});",acceptContext);assert.equal(accepted.quote,'old quote');
console.log('PASS: selecting a new source never silently replaces an unsaved process quotation.');
