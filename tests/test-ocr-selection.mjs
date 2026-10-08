import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
function load(file,imports={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>imports[name]});return module.exports;}
const text=load('lib/reader-text.ts'),{ocrSelectionRuns}=load('lib/ocr-selection.ts',{'./reader-text':text});
const word=(text,x0,x1,y0=.1,y1=.12)=>({text,x0,x1,y0,y1});
const line=(text,words)=>({text,words,x0:words[0].x0,x1:words.at(-1).x1,y0:.099,y1:.122});
const chinese=line('我 们 如何，理解 世界？',[word('我',.1,.12),word('们',.124,.143,.102,.118),word('如何，',.148,.205),word('理解',.21,.25),word('世界？',.255,.315)]);
const english=line('Reading connects ideas.',[word('Reading',.1,.17),word('connects',.178,.255,.103,.12),word('ideas.',.264,.324)]);
for(const sample of [chinese,english]){
 const runs=ocrSelectionRuns([sample]);
 assert.equal(runs.map(r=>r.text+r.suffix).join(''),text.cleanReadingText(sample.text)+'\n','exact normalized source');
 for(let i=1;i<runs.length;i++){assert.equal(runs[i-1].x1,runs[i].x0,'no dead gap or overlap');assert.equal(runs[i].y0,runs[0].y0);assert.equal(runs[i].y1,runs[0].y1);}
 for(const scale of [.5,1,2])for(let i=1;i<runs.length;i++)assert.equal(runs[i-1].x1*600*scale,runs[i].x0*600*scale,'zoom invariant');
}
assert.equal(ocrSelectionRuns([english]).map(r=>r.text+r.suffix).join('').slice(4,20),'ing connects ide','partial words preserved');
const columns=ocrSelectionRuns([line('左栏 右栏',[word('左栏',.1,.2),word('右栏',.65,.75)])]);assert.equal(columns[0].x1,.2);assert.equal(columns[1].x0,.65);
const overlap=ocrSelectionRuns([line('相 邻',[word('相',.1,.15),word('邻',.145,.19)])]);assert.equal(overlap[0].x1,overlap[1].x0);
const backwards=ocrSelectionRuns([line('第一 第二',[word('第一',.6,.7),word('第二',.1,.2)])]);assert.equal(backwards[0].x1,.7);assert.equal(backwards[1].x0,.1);
const incomplete=ocrSelectionRuns([line('不能丢失最后文字',[word('不能',.1,.2),word('丢失',.22,.32)])]);assert.equal(incomplete.length,1);assert.equal(incomplete[0].text,'不能丢失最后文字');
const oldCache={...english,words:undefined};assert.equal(ocrSelectionRuns([oldCache])[0].text,english.text);
const snapshot=JSON.stringify(chinese);ocrSelectionRuns([chinese]);assert.equal(JSON.stringify(chinese),snapshot,'cached OCR geometry stays unchanged');
assert.equal(ocrSelectionRuns([chinese,english]).map(r=>r.text+r.suffix).join(''),'我们如何，理解世界？\nReading connects ideas.\n');
console.log('PASS: continuous hit boxes, consistent line height, exact Chinese/English excerpts, partial words, zoom, column gutters, overlapping boxes, incomplete/legacy caches and immutable OCR data');
