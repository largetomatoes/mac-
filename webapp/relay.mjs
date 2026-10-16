const BASE='/dav/问间资料库/';
const ALLOWED=new Set(['GET','HEAD','PUT','PROPFIND','MKCOL','DELETE']);
const MAX_UPLOAD=80*1024*1024;
export function validDavPath(path,method){
 if(typeof path!=='string'||/[\x00-\x1f\x7f\\%?#]/.test(path)||path.includes('//')||path.split('/').some(p=>p==='.'||p==='..'))return false;
 if(path==='/dav/')return method==='PROPFIND';
 if(path===BASE)return ['PROPFIND','MKCOL'].includes(method);
 if(!path.startsWith(BASE+'sync-v1/'))return false;
 const key=path.slice((BASE+'sync-v1/').length);
 const folder=key===''||['changes/','books/','snapshots/','epochs/'].includes(key)||/^changes\/[a-f0-9]\/$/.test(key)||/^epochs\/[-a-zA-Z0-9_]{8,100}\/(?:changes\/(?:[a-f0-9]\/)?|)$/.test(key);
 const file=/^(library|lease)\.json$/.test(key)||key==='changes/upgrade-required.json'||/^changes\/[a-f0-9]\/([a-f0-9]{64})\.json$/.test(key)||/^epochs\/[-a-zA-Z0-9_]{8,100}\/changes\/[a-f0-9]\/([a-f0-9]{64})\.json$/.test(key)||/^snapshots\/[a-f0-9]{64}\.json$/.test(key)||/^books\/[a-f0-9]{64}\.(pdf|epub)$/.test(key);
 if(['MKCOL','PROPFIND'].includes(method))return folder;
 if(method==='DELETE')return file&&!/^(books\/|library\.json|lease\.json|changes\/upgrade-required\.json)/.test(key);
 return file;
}
const relayHeaders={'X-Wenjian-Relay':'1','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const error=(message,status)=>new Response(JSON.stringify({error:message}),{status,headers:{...relayHeaders,'Content-Type':'application/json;charset=utf-8'}});
export function createRelayLimiter({now=Date.now,limit=300,maxFailures=12}={}){const clients=new Map();let swept=0;function entry(ip){const minute=Math.floor(now()/60000);if(minute!==swept){for(const [key,value] of clients)if(value.minute!==minute)clients.delete(key);swept=minute;}if(!clients.has(ip)){if(clients.size>=4096)return null;clients.set(ip,{minute,hits:0,failures:0});}return clients.get(ip);}return {allow(ip){if(!ip)return true;const state=entry(ip);if(!state)return false;state.hits++;return state.hits<=limit&&state.failures<maxFailures;},failure(ip){if(ip){const state=entry(ip);if(state)state.failures++;}}};}
const publicLimiter=createRelayLimiter();
function validBasic(value){try{const bytes=Uint8Array.from(atob(value.slice(6)),c=>c.charCodeAt(0)),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),split=text.indexOf(':'),username=text.slice(0,split),password=text.slice(split+1);return split>0&&username.length<=254&&/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(username)&&password.length>=4&&password.length<=256&&!/[\r\n]/.test(password);}catch{return false;}}
export async function handleDavRelay(request,upstream=fetch){
 if(request.method!=='POST')return error('只接受同步请求。',405);
 const url=new URL(request.url),origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
 if(origin!==url.origin||site&&site!=='same-origin')return error('同步请求来源不正确。',403);
 const method=url.searchParams.get('method'),path=url.searchParams.get('path');
 if(!ALLOWED.has(method)||!validDavPath(path,method))return error('同步路径不在问间专用目录内。',400);
 const authorization=request.headers.get('Authorization')||'';
 if(!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization)||authorization.length>2048||!validBasic(authorization))return error('请先填写坚果云应用密码。',401);
 const clientIp=request.headers.get('CF-Connecting-IP');if(!publicLimiter.allow(clientIp))return new Response(JSON.stringify({error:'同步请求过于频繁，请一分钟后重试。'}),{status:429,headers:{...relayHeaders,'Content-Type':'application/json','Retry-After':'60','X-Wenjian-RateLimit':'1'}});
 const length=Number(request.headers.get('Content-Length')||0);if(!Number.isFinite(length)||length<0||length>MAX_UPLOAD)return error('Web 版单次上传暂限 80 MB。',413);
 const headers=new Headers({Authorization:authorization});
 for(const key of ['Depth','If-Match','If-None-Match']){const value=request.headers.get('X-Wenjian-'+key);if(value){if(value.length>1024||/[\r\n]/.test(value))return error('同步条件无效。',400);headers.set(key,value);}}
 if(method==='PROPFIND'){if(!['0','1'].includes(headers.get('Depth')))return error('目录读取深度无效。',400);headers.set('Content-Type','application/xml;charset=utf-8');}
 else if(method==='PUT')headers.set('Content-Type',path.endsWith('.json')?'application/json;charset=utf-8':'application/octet-stream');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
 try{
  let body;
  if(!['GET','HEAD','DELETE','MKCOL'].includes(method)&&request.body){let size=0;body=request.body.pipeThrough(new TransformStream({transform(chunk,writer){size+=chunk.byteLength;if(size>MAX_UPLOAD)throw Error('上传超过限制');writer.enqueue(chunk);}}));}
  const response=await upstream('https://dav.jianguoyun.com'+path.split('/').map(encodeURIComponent).join('/'),{method,headers,body,redirect:'manual',signal:controller.signal,duplex:'half'});
  if(response.status>=300&&response.status<400){await response.body?.cancel();return error('坚果云返回重定向，已停止传送账号信息。',502);}
  const output=new Headers(relayHeaders);for(const key of ['Content-Type','Content-Length','ETag','Last-Modified','Retry-After']){const value=response.headers.get(key);if(value)output.set(key,value);}
  // Never return the provider's error body: it can contain request/account details.
  if(response.status>=400){if(response.status===401)publicLimiter.failure(clientIp);await response.body?.cancel();output.delete('Content-Length');return new Response(null,{status:response.status,headers:output});}
  return new Response(method==='HEAD'?null:response.body,{status:response.status,headers:output});
 }catch{return error('同步中转连接暂不可用，请稍后重试。',502);}finally{clearTimeout(timer);}
}
