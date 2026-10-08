import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
function load(file,imports){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name],console});return module.exports;}
const notebook=load('lib/notebook.ts',{'./library-folders':load('lib/library-folders.ts',{})});
const fixture=modelFixture();function modelFixture(){const data=structuredClone(notebook.initialNotebook);data.setupCompleted=true;data.zoteroEnabled=true;data.notes.push({...structuredClone(data.notes[0]),id:'language',parent:'world',title:'测试子问题'});return data;}
const graph=load('lib/graph-projection.ts',{'./notebook':notebook});
const layout=load('lib/graph-layout.ts',{'./notebook':notebook,'./graph-projection':graph});
const camera=load('lib/graph-camera.ts',{});
const data=structuredClone(fixture),template=data.notes[1];
const note=(id,parent,order=1)=>({...template,id,parent,order,title:id,thoughts:[]});
const cross=(id,anchorIds,order)=>({id,order,title:id,anchorIds,anchorRevisions:[],text:'',origin:'自己的思考',source:'',at:'',thoughts:[]});
data.notes.push(note('action','world',3),note('language-child','language'),note('cross-child','cross'));
data.notes.find(n=>n.id==='language-child').thoughts.push({id:'thought-anchor',text:'后续思考',origin:'自己的思考',reason:'',at:''});
data.crossThoughts.push(cross('cross',['thought-anchor','action'],1));
data.cards.push({id:'linked-card',text:'卡片',origin:'',source:'',at:'',thoughts:[]});
data.links.push({id:'link',from:'linked-card',to:'language-child',type:'启发'});
const original=JSON.stringify(data);
function verify(data){
 const projection=graph.projectGraph(data),positions=layout.layoutGraph(data,projection);
 assert.equal(Object.keys(positions).length,projection.visibleIds.length,'every visible item is placed');
 assert.equal(new Set(projection.visibleIds).size,projection.visibleIds.length);
 for(const p of Object.values(positions))assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
 for(const edge of projection.edges.filter(e=>e.kind==='hierarchy'))assert.ok(positions[edge.to].x>positions[edge.from].x,'children stay right of parents');
 const entries=Object.entries(positions);
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
  const [a,p]=entries[i],[b,q]=entries[j];assert.ok(Math.abs(p.x-q.x)>=layout.GRAPH_NODE_WIDTH||Math.abs(p.y-q.y)>=layout.GRAPH_NODE_HEIGHT,`${a} overlaps ${b}`);
 }
 return {projection,positions};
}
const {projection,positions}=verify(data);
assert.deepEqual([...projection.visibleIds].sort(),['action','cross','cross-child','language','language-child','linked-card','world']);
assert.ok(projection.edges.some(e=>e.from==='language-child'&&e.to==='cross'));
assert.ok(positions.cross.y>positions['language-child'].y&&positions.cross.y<positions.action.y,'cross between branches');
assert.equal(JSON.stringify(data),original,'data never mutated');
const contentEdit=structuredClone(data);contentEdit.notes[1].title='a much longer title';contentEdit.notes[1].body='new body';
assert.equal(JSON.stringify(layout.layoutGraph(contentEdit,graph.projectGraph(contentEdit))),JSON.stringify(positions),'content edits preserve layout');
const expanded=structuredClone(data);
expanded.crossThoughts.push(cross('parent-cross',['language','language-child'],2),cross('multi-cross',['language','action','cross-child'],3));
expanded.notes.push(note('parent-cross-child','parent-cross'));
expanded.cards.push({id:'card-cross-only',text:'关联卡片',origin:'',source:'',at:'',thoughts:[{id:'card-thought',text:'想法',origin:'',reason:'',at:''}]});
expanded.crossThoughts.push(cross('card-cross',['card-thought','action'],4));
assert.ok(verify(expanded).projection.visibleIds.includes('card-cross-only'));
const dense=structuredClone(expanded);
for(let i=0;i<12;i++){dense.notes.push(note(`branch-${i}`,'world',i+4));for(let j=0;j<5;j++)dense.notes.push(note(`leaf-${i}-${j}`,`branch-${i}`,j));}
for(let i=0;i<10;i++){dense.crossThoughts.push(cross(`dense-cross-${i}`,[`leaf-${i}-1`,`leaf-${i+1}-3`],i+5));dense.notes.push(note(`dense-cross-child-${i}`,`dense-cross-${i}`));}
verify(dense);
const odd=structuredClone(data);odd.notes.push(note('orphan','missing'));verify(odd);
const cyclic=structuredClone(data);cyclic.crossThoughts.push(cross('cycle-a',['cycle-b','action'],7),cross('cycle-b',['cycle-a','language'],8));verify(cyclic);
const c={x:30,y:80,zoom:1},point={x:200,y:250};
const z=camera.zoomAt(c,1.8,point);assert.ok(Math.abs((point.x-c.x)/c.zoom-(point.x-z.x)/z.zoom)<1e-9);assert.ok(Math.abs((point.y-c.y)/c.zoom-(point.y-z.y)/z.zoom)<1e-9);
const pan=camera.wheelCamera(c,{x:120,y:250},point,false);assert.equal(pan.x,-90);assert.equal(pan.y,-170);assert.equal(pan.zoom,1);
const pinch=camera.wheelCamera(c,{x:0,y:-20},point,true);assert.ok(pinch.zoom>1);
const fit=camera.fitGraph({left:-100,top:20,right:900,bottom:1020},{width:800,height:600});assert.ok(fit.x-100*fit.zoom>=0&&fit.y+1020*fit.zoom<=600);
assert.equal(camera.zoomAt(c,100,point).zoom,camera.MAX_GRAPH_ZOOM);
console.log('All-expanded graph, 100+ boards, cross descendants, data immutability and camera gestures passed');
