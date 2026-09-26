import assert from 'node:assert/strict';
import test from 'node:test';
import {rankSearch} from '../lib/search-ranking.ts';

const doc=(id,text)=>({id,title:id,label:'思考',fields:[{text}]});

test('a remembered related word can find a thought without an exact phrase',()=>{
 const results=rankSearch([doc('honesty','维特根斯坦对诚实的要求'),doc('language','语言结构与动机')],'真诚');
 assert.equal(results[0]?.id,'honesty');
 assert.equal(results.some(result=>result.id==='language'),false);
});

test('a multi-part idea ranks the record covering more of it first',()=>{
 const results=rankSearch([doc('partial','语言与动机'),doc('full','语言如何塑造我们与世界的关系')],'语言 世界');
 assert.equal(results[0]?.id,'full');
});

test('long records show the matching passage rather than their opening',()=>{
 const content='读书过程中的其他想法。'.repeat(40)+'人与世界的接口也表现为对诚实的要求。';
 const result=rankSearch([doc('long',content)],'诚实')[0];
 assert.ok(result?.excerpt.includes('诚实'));
 assert.ok(result?.excerpt.startsWith('…'));
 assert.ok(result.excerpt.length<=172);
});

test('irrelevant entries are omitted and the result limit is respected',()=>{
 const documents=Array.from({length:9},(_,index)=>doc(String(index),`关于诚实的思考 ${index}`));
 assert.equal(rankSearch(documents,'完全无关的字串').length,0);
 assert.equal(rankSearch(documents,'诚实',3).length,3);
});
