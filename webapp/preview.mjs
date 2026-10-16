import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {handleDavRelay} from './relay.mjs';
const root=path.resolve('webapp/public');
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.mjs':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.wasm':'application/wasm','.gz':'application/gzip'};
export function createPreview(relay=handleDavRelay){return http.createServer(async(req,res)=>{try{const origin='http://'+req.headers.host,url=new URL(req.url,origin);if(url.pathname==='/api/webdav'){const request=new Request(url,{method:req.method,headers:req.headers,body:Readable.toWeb(req),duplex:'half'}),result=await relay(request);res.writeHead(result.status,Object.fromEntries(result.headers));if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();return;}if(url.pathname==='/'){res.writeHead(302,{location:'/read/'});res.end();return;}const relative=decodeURIComponent(url.pathname).replace(/^\//,'')+(url.pathname.endsWith('/')?'index.html':''),file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||(await stat(file)).isDirectory()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});}
if(process.argv[1]?.endsWith('preview.mjs')){const server=createPreview();server.listen(Number(process.env.WENJIAN_PREVIEW_PORT)||0,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port));}
