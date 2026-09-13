import { env } from 'cloudflare:workers';
import { initialNotebook,normalize } from '@/lib/notebook';
import { z } from 'zod';
const thought=z.object({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(100000),origin:z.string().max(100),reason:z.string().max(10000),at:z.string().max(100)});
const revision=z.object({title:z.string().max(300),body:z.string().max(100000),origin:z.string().max(100),source:z.string().max(10000),reason:z.string().max(10000),at:z.string()});
const note=z.object({id:z.string().min(1).max(100),kind:z.enum(['question','answer']),parent:z.string().nullable(),order:z.number().int().positive(),title:z.string().trim().min(1).max(300),body:z.string().max(100000),origin:z.string().max(100),source:z.string().max(10000),revisions:z.array(revision).max(1000),thoughts:z.array(thought).max(1000).default([])});
const card=z.object({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(100000),origin:z.string().max(100),source:z.string().max(10000),at:z.string().max(100),thoughts:z.array(thought).max(1000)});
const schema=z.object({version:z.number().int().nonnegative(),data:z.object({notes:z.array(note).min(1).max(3000),cards:z.array(card).max(5000),links:z.array(z.object({id:z.string(),from:z.string(),to:z.string(),type:z.enum(['相关','支持','反驳','启发'])})).max(10000),dismissedSuggestions:z.array(z.string()).max(15000)})});
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
 const ids=new Set([...data.notes,...data.cards].map(n=>n.id));if(ids.size!==data.notes.length+data.cards.length)return response('记录标识重复。',400);
 if(data.notes.filter(n=>!n.parent).length!==1)return response('这个空间只保留一个核心问题。',400);
 for(const n of data.notes){if(n.parent&&!data.notes.some(p=>p.id===n.parent&&p.kind==='question'))return response('子问题与回答需要连接到问题。',400);if(n.kind==='answer'&&!n.parent)return response('回答需要有所属问题。',400);let p=n;const visited=new Set<string>();while(p.parent){if(visited.has(p.id))return response('问题层级不能形成循环。',400);visited.add(p.id);p=data.notes.find(x=>x.id===p.parent)!;}}
 for(const l of data.links)if(!ids.has(l.from)||!ids.has(l.to)||l.from===l.to)return response('这条联系无效。',400);
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 for(const c of old.cards){const next=data.cards.find(n=>n.id===c.id);if(!next||!same({...c,thoughts:[]},{...next,thoughts:[]})||!same(c.thoughts,next.thoughts.slice(0,c.thoughts.length)))return response('原话和已有思考需要保留，请追加新的思考。',400);}
 for(const n of old.notes){const next=data.notes.find(x=>x.id===n.id);if(!next||!same({...n,thoughts:[]},{...next,thoughts:[]})||!same(n.thoughts,next.thoughts.slice(0,n.thoughts?.length||0)))return response('原有问题与回答需要保留，请追加新的思考。',400);}
 const result=await db().prepare('UPDATE notebooks SET content=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),'personal',version).run();if(!result.meta.changes)return response('另一窗口已更新内容。请先复制输入，再刷新。',409);
 return Response.json({version:version+1});
 }catch(e){console.error(e);return response('保存没有完成，输入仍在，请重试。',503);}}
