import assert from 'node:assert/strict';import {load,plain} from './load-ts.cjs';
const {zoteroCfi,zoteroPdfRects}=load('lib/zotero-position.ts');
const annotation={position:JSON.stringify({pageIndex:0,rects:[[10,20,40,60]]})};
const viewport={width:200,height:200,convertToViewportPoint:(x,y)=>[x*2,200-y*2]};
assert.deepEqual(plain(zoteroPdfRects(annotation,1,viewport)),[{left:20,top:80,width:60,height:80}]);assert.equal(zoteroPdfRects(annotation,2,viewport).length,0);assert.equal(zoteroPdfRects({position:'bad'},1,viewport).length,0);assert.equal(zoteroPdfRects({position:JSON.stringify({pageIndex:0,rects:[[1,2,'bad',4]]})},1,viewport).length,0);
const cfi='epubcfi(/6/8!/4/2/12,/1:0,/1:9)';assert.equal(zoteroCfi({position:JSON.stringify({type:'FragmentSelector',value:cfi})}),cfi);assert.equal(zoteroCfi({position:JSON.stringify({type:'CssSelector',value:cfi})}),null);
console.log('PASS: PDF page identity, scaled coordinates, invalid positions and official EPUB FragmentSelector');

assert.deepEqual(plain(load('lib/zotero-position.ts').clipEpubSourceRects([{left:-20,top:10,width:70,height:30},{left:1000,top:0,width:40,height:20}],{left:110,top:200},{left:100,top:200,width:300,height:400})),[{left:0,top:10,width:60,height:30}]);console.log('PASS: EPUB multiline source coordinates clip to the visible reader without changing text nodes');
