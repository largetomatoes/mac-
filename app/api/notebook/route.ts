import { deletionPlan } from '@/lib/deletion';
import { env } from 'cloudflare:workers';
import { initialNotebook,normalize } from '@/lib/notebook';
import { z } from 'zod';
const thought=z.object({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(100000),origin:z.string().max(100),reason:z.string().max(10000),at:z.string().max(100)});
const revision=z.object({title:z.string().max(300),body:z.string().max(100000),origin:z.string().max(100),source:z.string().max(10000),reason:z.string().max(10000),at:z.string()});
const note=z.object({id:z.string().min(1).max(100),kind:z.enum(['question','answer']),parent:z.string().nullable(),order:z.number().int().positive(),title:z.string().trim().min(1).max(300),body:z.string().max(100000),origin:z.string().max(100),source:z.string().max(10000),revisions:z.array(revision).max(1000),thoughts:z.array(thought).max(1000).default([])});
const card=z.object({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(100000),origin:z.string().max(100),source:z.string().max(10000),at:z.string().max(100),thoughts:z.array(thought).max(1000)});
const readingNote=z.object({id:z.string().min(1).max(100),questionIds:z.array(z.string().min(1).max(100)).min(1).max(100),book:z.string().trim().min(1).max(500),author:z.string().trim().min(1).max(300),chapter:z.string().trim().min(1).max(500),locator:z.string().max(300),quote:z.string().trim().min(1).max(100000),interpretation:z.string().trim().min(1).max(100000),at:z.string().max(100),thoughts:z.array(thought).max(1000)});
const anchorRevision=z.object({from:z.array(z.string().min(1).max(100)).max(30),to:z.array(z.string().min(1).max(100)).max(30),fromLabel:z.string().max(1000).optional(),toLabel:z.string().max(1000).optional(),at:z.string().max(100),reason:z.string().max(300)});
const crossThought=z.object({title:z.string().trim().min(1).max(300).optional(),id:z.string().min(1).max(100),order:z.number().int().positive(),anchorIds:z.array(z.string().min(1).max(100)).max(30),anchorRevisions:z.array(anchorRevision).max(1000),text:z.string().trim().max(100000),origin:z.string().max(100),source:z.string().max(10000),at:z.string().max(100),thoughts:z.array(thought).max(1000)});
const schema=z.object({version:z.number().int().nonnegative(),data:z.object({notes:z.array(note).min(1).max(3000),cards:z.array(card).max(5000),readingNotes:z.array(readingNote).max(10000),crossThoughts:z.array(crossThought).max(10000),links:z.array(z.object({id:z.string(),from:z.string(),to:z.string(),type:z.enum(['相关','支持','反驳','启发'])})).max(10000),dismissedSuggestions:z.array(z.string()).max(15000)})});
function db(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
const response=(error:string,status:number)=>Response.json({error},{status});
export async function GET(){try{const d=db();await d.prepare('INSERT OR IGNORE INTO notebooks(id,version,content) VALUES(?,0,?)').bind('personal',JSON.stringify(initialNotebook)).run();const row=await d.prepare('SELECT version,content FROM notebooks WHERE id=?').bind('personal').first<{version:number;content:string}>();return Response.json({version:row!.version,data:normalize(JSON.parse(row!.content))},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error(e);return response('暂时无法读取卡片，请重试。',503);}}
export async function PUT(req:Request){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return response('无效请求来源',403);
 const parsed=schema.safeParse(await req.json());if(!parsed.success)return response('内容格式不正确或超出容量。',400);
 const {data,version}=parsed.data;
 const current=await db().prepare('SELECT version,content FROM notebooks WHERE id=?').bind('personal').first<{version:number;content:string}>();
 if(!current||current.version!==version)return response('另一窗口已保存新内容。请先复制当前输入，再刷新页面。',409);
 const old=normalize(JSON.parse(current.content));
 const records=[...data.notes,...data.cards,...data.crossThoughts,...data.readingNotes];const allIds=new Set(records.map(n=>n.id));const ids=new Set([...data.notes,...data.cards,...data.crossThoughts].map(n=>n.id));if(allIds.size!==records.length)return response('记录标识重复。',400);
 if(new Set(data.crossThoughts.map(c=>c.order)).size!==data.crossThoughts.length)return response('交叉板块编号重复。',400);
 if(data.notes.filter(n=>!n.parent).length!==1)return response('这个空间只保留一个核心问题。',400);
 for(const n of data.notes){if(n.parent&&!data.notes.some(p=>p.id===n.parent&&p.kind==='question')&&!data.crossThoughts.some(c=>c.id===n.parent))return response('子问题与回答需要连接到问题或交叉板块。',400);if(n.kind==='answer'&&!n.parent)return response('回答需要有所属问题。',400);let p:typeof n|undefined=n;const visited=new Set<string>();while(p?.parent&&data.notes.some(x=>x.id===p!.parent)){if(visited.has(p.id))return response('问题层级不能形成循环。',400);visited.add(p.id);p=data.notes.find(x=>x.id===p!.parent);}}
 for(const l of data.links)if(!ids.has(l.from)||!ids.has(l.to)||l.from===l.to)return response('这条联系无效。',400);
 for(const r of data.readingNotes)if(r.questionIds.some(id=>!data.notes.some(n=>n.id===id&&n.kind==='question')&&!data.crossThoughts.some(c=>c.id===id)))return response('阅读笔记需要属于有效的问题。',400);
 const anchorIds=new Set([...data.notes.map(n=>n.id),...data.notes.flatMap(n=>(n.thoughts||[]).map(t=>t.id)),...data.cards.flatMap(c=>c.thoughts.map(t=>t.id))]);
 for(const c of data.crossThoughts)if((!c.title&&!c.text.trim())||(c.anchorIds.length<2&&JSON.stringify(old.crossThoughts.find(x=>x.id===c.id)?.anchorIds)!==JSON.stringify(c.anchorIds))||new Set(c.anchorIds).size!==c.anchorIds.length||c.anchorIds.some(id=>!anchorIds.has(id)))return response('交叉思考需要连接至少两个有效板块。',400);
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 for(const c of old.cards){const next=data.cards.find(n=>n.id===c.id);if(!next||!same({...c,thoughts:[]},{...next,thoughts:[]})||!same(c.thoughts,next.thoughts.slice(0,c.thoughts.length)))return response('原话和已有思考需要保留，请追加新的思考。',400);}
 for(const n of old.notes){const next=data.notes.find(x=>x.id===n.id);if(!next||!same({...n,thoughts:[]},{...next,thoughts:[]})||!same(n.thoughts,next.thoughts.slice(0,n.thoughts?.length||0)))return response('原有问题与回答需要保留，请追加新的思考。',400);}
 for(const r of old.readingNotes){const next=data.readingNotes.find(n=>n.id===r.id);if(!next||!same({...r,thoughts:[]},{...next,thoughts:[]})||!same(r.thoughts,next.thoughts.slice(0,r.thoughts.length)))return response('阅读笔记的原文、来源和已有理解需要保留，请追加新的思考。',400);}
 for(const c of old.crossThoughts){const next=data.crossThoughts.find(n=>n.id===c.id);const baseSame=next&&same({...c,anchorIds:[],anchorRevisions:[],thoughts:[]},{...next,anchorIds:[],anchorRevisions:[],thoughts:[]});const thoughtsSame=next&&same(c.thoughts,next.thoughts.slice(0,c.thoughts.length));const historySame=next&&same(c.anchorRevisions,next.anchorRevisions.slice(0,c.anchorRevisions.length));const changed=next&&!same(c.anchorIds,next.anchorIds);const changeRecorded=!changed||(next!.anchorRevisions.length===c.anchorRevisions.length+1&&same(next!.anchorRevisions.at(-1)?.from,c.anchorIds)&&same(next!.anchorRevisions.at(-1)?.to,next!.anchorIds));if(!next||!baseSame||!thoughtsSame||!historySame||!changeRecorded)return response('交叉板块和已有记录需要保留，请追加新的思考。',400);}
 const result=await db().prepare('UPDATE notebooks SET content=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),'personal',version).run();if(!result.meta.changes)return response('另一窗口已更新内容。请先复制输入，再刷新。',409);
 return Response.json({version:version+1});
 }catch(e){console.error(e);return response('保存没有完成，输入仍在，请重试。',503);}}

export async function DELETE(req:Request){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return response('无效请求来源',403);
 const input=z.object({id:z.string().min(1),version:z.number().int().nonnegative(),title:z.string().min(1),confirmed:z.literal(true),confirmation:z.literal('删除')}).safeParse(await req.json());
 if(!input.success)return response('请完成两步删除确认。',400);
 const row=await db().prepare('SELECT version,content FROM notebooks WHERE id=?').bind('personal').first<{version:number;content:string}>();
 if(!row||row.version!==input.data.version)return response('笔记已发生变化，请刷新后重新核对删除范围。',409);
 const current=normalize(JSON.parse(row.content));const target=current.notes.find(n=>n.id===input.data.id);
 if(!target||target.kind!=='question'||!target.parent)return response('只能删除子问题，核心问题不能删除。',400);
 if(target.title!==input.data.title)return response('问题已发生变化，请重新确认。',409);
 const plan=deletionPlan(current,target.id);
 const result=await db().prepare('UPDATE notebooks SET content=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(plan.next),'personal',row.version).run();
 if(!result.meta.changes)return response('笔记已更新，删除没有执行，请刷新后重试。',409);
 return Response.json({data:plan.next,version:row.version+1});
 }catch(e){console.error(e);return response('删除没有完成，请重试。',503);}}
