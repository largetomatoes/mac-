export type Revision = { title:string; body:string; origin:string; source:string; reason:string; at:string };
export type Note = { id:string; kind:'question'|'answer'; parent:string|null; order:number; title:string; body:string; origin:string; source:string; revisions:Revision[] };
export type Link = { id:string; from:string; to:string; type:string };
export type Notebook = { notes:Note[]; links:Link[] };
export const initialNotebook:Notebook = { notes:[
 {id:'world',kind:'question',parent:null,order:1,title:'我们该如何处理我们和世界的关系？',body:'',origin:'自己的推演',source:'',revisions:[]},
 {id:'language',kind:'question',parent:'world',order:2,title:'我们与言语结构、动机的关系是什么？',body:'',origin:'自己的推演',source:'',revisions:[]}
],links:[] };
export function numberOf(n:Note,notes:Note[]):string { if(n.kind==='answer')return '答 · '+n.id.slice(0,6).toUpperCase(); const p=notes.find(x=>x.id===n.parent);return p?numberOf(p,notes)+'.'+n.order:String(n.order); }
