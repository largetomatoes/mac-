import {env} from 'cloudflare:workers';
import {removeRecord,type MaintenanceTarget} from '@/lib/maintenance.cjs';
import {validSettings} from '@/lib/notebook-settings.cjs';
import {normalize,type Notebook} from '@/lib/notebook';
export async function POST(req:Request){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'无效请求来源'},{status:403});
 const input=await req.json() as {version:number;confirmed:boolean;confirmation:string;target:MaintenanceTarget};
 if(input.confirmed!==true||input.confirmation!=='删除')return Response.json({error:'请先确认范围'},{status:400});
 const db=env.DB;if(!db)throw Error('资料库暂不可用');
 const current=await db.prepare('SELECT version,content FROM notebooks WHERE id=?').bind('personal').first<{version:number;content:string}>();
 if(!current||input.version!==current.version)return Response.json({error:'资料刚有修改，请重新选择。'},{status:409});
 const data=removeRecord(normalize(JSON.parse(current.content) as Notebook),input.target);if(!validSettings(data))throw Error('删除结果无法验证。');
 const result=await db.prepare('UPDATE notebooks SET content=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),'personal',current.version).run();
 if(!result.meta.changes)return Response.json({error:'资料刚有修改，请重新选择。'},{status:409});
 return Response.json({data,version:current.version+1});
 }catch(error){return Response.json({error:(error as Error).message},{status:400});}}
