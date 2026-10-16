const fs=require('node:fs/promises'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),cp=require('node:child_process');
const {createReadStream}=require('node:fs');
const publicKey=require('./update-public-key.cjs');
const hosts=new Set(['github.com','api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
function trustedUrl(value){const u=new URL(value);if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.username||u.password||u.port)throw Error('更新地址不受信任。');return u;}
function responseFor(value,signal,redirects=0){return new Promise((resolve,reject)=>{let url;try{url=trustedUrl(value);}catch(e){reject(e);return;}
 const request=https.get(url,{headers:{'User-Agent':'Wenjian-Signed-Updater','Accept':'application/octet-stream'},signal},response=>{
  if([301,302,303,307,308].includes(response.statusCode)){response.resume();if(redirects>=5||!response.headers.location)return reject(Error('更新跳转过多。'));responseFor(new URL(response.headers.location,url).href,signal,redirects+1).then(resolve,reject);return;}
  if(response.statusCode!==200){response.resume();return reject(Error('更新下载未完成（'+response.statusCode+'）。'));}resolve(response);
 });request.setTimeout(30000,()=>request.destroy(Error('更新下载超时，请稍后重试。')));request.on('error',reject);
});}
async function getJson(url,signal){const response=await responseFor(url,signal),parts=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>1024*1024){response.destroy();throw Error('更新清单过大。');}parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
function verifyManifest(envelope,platform,arch,currentBuild,version,key=publicKey){
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>1024*1024||typeof envelope.signature!=='string'||!crypto.verify('sha256',Buffer.from(envelope.payload,'utf8'),key,Buffer.from(envelope.signature,'base64')))throw Error('更新发布签名验证失败。');
 const manifest=JSON.parse(envelope.payload);
 if(manifest.schema!==1||manifest.version!==version||!Number.isInteger(manifest.build)||manifest.build<=currentBuild||!Array.isArray(manifest.assets))throw Error('更新版本信息不匹配或已经安装。');
 const asset=manifest.assets.find(a=>a.platform===platform&&a.arch===arch);
 if(!asset||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>1024*1024*1024||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('没有有效的本平台更新包。');
 const url=trustedUrl(asset.url);if(url.hostname!=='github.com'||!url.pathname.startsWith('/largetomatoes/mac-/releases/download/v'+version+'/'))throw Error('更新包来源不匹配。');
 return {manifest,asset};
}
async function hashFile(file){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function zipEntries(file){
 const h=await fs.open(file,'r');try{const stat=await h.stat(),tail=Buffer.alloc(Math.min(stat.size,65557));await h.read(tail,0,tail.length,stat.size-tail.length);let end=-1;
 for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('安装包归档不完整。');const count=tail.readUInt16LE(end+10),size=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
 if(!count||count>20000||size>16*1024*1024||offset+size>stat.size)throw Error('安装包目录无效。');const directory=Buffer.alloc(size);await h.read(directory,0,size,offset);let cursor=0,unpacked=0;const names=[];
 for(let i=0;i<count;i++){if(cursor+46>size||directory.readUInt32LE(cursor)!==0x02014b50)throw Error('安装包目录损坏。');const n=directory.readUInt16LE(cursor+28),extra=directory.readUInt16LE(cursor+30),comment=directory.readUInt16LE(cursor+32);if(cursor+46+n+extra+comment>size)throw Error('安装包目录不完整。');
 const name=directory.subarray(cursor+46,cursor+46+n).toString('utf8');if(!name||name.includes('\0')||name.includes('\\')||name.startsWith('/')||name.includes(':')||name.split('/').includes('..'))throw Error('安装包包含越界路径。');unpacked+=directory.readUInt32LE(cursor+24);if(unpacked>2*1024*1024*1024)throw Error('安装包解压大小异常。');names.push(name);cursor+=46+n+extra+comment;
 }return names;
 }finally{await h.close();}
}
async function atomic(file,value){const tmp=file+'.new';await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});await fs.rename(tmp,file);}
function createUpdater(options){
 const directory=path.resolve(options.directory);let state={state:'idle'},controller=null,job=null;
 const persist=async()=>{await fs.mkdir(directory,{recursive:true,mode:0o700});await atomic(path.join(directory,'status.json'),state);};
 const init=async()=>{try{const old=JSON.parse((await fs.readFile(path.join(directory,'status.json'),'utf8')).replace(/^\uFEFF/,''));if(old.state==='ready'&&old.file&&old.envelope)state=old;}catch{}return {...state};};
 async function download(version,build){
  controller=new AbortController();state={state:'downloading',version,build,completed:0,total:0};await persist();
  try{
   const releases=await options.releases(),release=releases.find(r=>!r.draft&&!r.prerelease&&r.tag_name==='v'+version);
   const item=release?.assets?.find(a=>a.name===(build?'update-manifest-'+build+'.json':'update-manifest.json')&&a.state==='uploaded');
   if(!item||!item.browser_download_url.startsWith('https://github.com/largetomatoes/mac-/releases/download/v'+version+'/'))throw Error('此版本尚未提供应用内更新清单。');
   const envelope=await (options.getJson||getJson)(item.browser_download_url,controller.signal);
   const {asset,manifest}=verifyManifest(envelope,options.platform,options.arch,options.build,version,options.verificationKey||publicKey);if(build&&manifest.build!==build)throw Error('更新构建号与所选版本不一致。');
   const space=await fs.statfs(directory);if(Number(space.bavail)*Number(space.bsize)<asset.size*5)throw Error('磁盘空间不足，请至少保留更新包大小的5倍可用空间。');state.total=asset.size;const suffix=options.platform==='darwin'?'.zip':'.zip',file=path.join(directory,'update-'+version+'-'+manifest.build+suffix),temporary=file+'.partial';await fs.rm(temporary,{force:true});
   const handle=await fs.open(temporary,'wx',0o600),hash=crypto.createHash('sha256');let count=0;
   try{const response=await (options.responseFor||responseFor)(asset.url,controller.signal);for await(const chunk of response){if(controller.signal.aborted)throw Error('更新下载已取消。');count+=chunk.length;if(count>asset.size)throw Error('更新包超过清单大小。');hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw Error('更新包未完整写入，请检查磁盘。');offset+=written.bytesWritten;}state.completed=count;}await handle.sync();}finally{await handle.close();}
   state={...state,state:'verifying'};await persist();
   if(count!==asset.size||hash.digest('hex')!==asset.sha256)throw Error('更新包校验失败，未修改当前应用。');
   await zipEntries(temporary);await fs.rename(temporary,file);state={state:'ready',version,build:manifest.build,completed:count,total:count,file,envelope};await persist();
  }catch(error){const failed={state:controller?.signal.aborted?'cancelled':'failed',version,error:controller?.signal.aborted?'下载已取消':error.message};const files=await fs.readdir(directory).catch(()=>[]);for(const name of files.filter(n=>n.endsWith('.partial')))await fs.rm(path.join(directory,name),{force:true});state=failed;await persist();}
  finally{controller=null;job=null;}
 }
 return {
  init,status:()=>({...state,file:undefined,envelope:undefined}),
  start(version,build){if(build!==undefined&&(!Number.isSafeInteger(build)||build<=options.build))throw Error('更新构建号无效或已安装。');if(state.state==='ready'&&state.version===version&&(!build||state.build===build))return {...state};if(job)return {...state};if(!/^3[.][0-9]{1,50}$/.test(version))throw Error('更新版本无效。');job=download(version,build);job.catch(()=>{});return {...state};},
  cancel(){controller?.abort();return {...state};},
  async install(){
   if(state.state!=='ready')throw Error('请先下载并校验更新。');
   const {manifest,asset}=verifyManifest(state.envelope,options.platform,options.arch,options.build,state.version,options.verificationKey||publicKey);
   if(path.dirname(state.file)!==directory||(await fs.stat(state.file)).size!==asset.size||await hashFile(state.file)!==asset.sha256)throw Error('暂存更新包已变化，请重新下载。');
   const names=await zipEntries(state.file);
   if(options.platform==='darwin'&&!names.some(name=>name.startsWith('问间.app/Contents/')))throw Error('Mac应用目录不匹配。');
   if(options.platform==='win32'&&!names.some(name=>name.endsWith('/Wenjian.exe')))throw Error('Windows应用目录不匹配。');
   await options.protect();
   const nonce=crypto.randomUUID(),config=path.join(directory,'install-'+nonce+'.json');
   const target=options.platform==='darwin'?path.dirname(path.dirname(path.dirname(options.exePath))):path.dirname(options.exePath);
   if(options.platform==='darwin'&&path.extname(target)!=='.app'||options.platform==='win32'&&path.parse(target).root===target)throw Error('当前应用路径不能原位更新。');
   await fs.access(path.dirname(target),require('node:fs').constants.W_OK);
   const spec={directory,zip:state.file,target,pid:process.pid,platform:options.platform,exe:options.exePath,bundleId:options.bundleId,version:state.version,build:manifest.build,nonce,confirmation:path.join(directory,'boot-'+nonce+'.json')};
   await atomic(config,spec);await atomic(path.join(directory,'pending-install.json'),spec);
   let child;
   if(options.platform==='darwin'){const helper=path.join(directory,'update-installer.cjs');await fs.copyFile(path.join(__dirname,'update-installer.cjs'),helper);child=cp.spawn(options.exePath,[helper,config],{detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});}
   else {const script=path.join(directory,'update-installer.ps1');await fs.copyFile(path.join(__dirname,'update-installer.ps1'),script);child=cp.spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Config',config],{detached:true,stdio:'ignore',windowsHide:true});}
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();state={state:'installing',version:state.version};await persist();return {...state};
  },
  async confirmBoot(){try{const spec=JSON.parse(await fs.readFile(path.join(directory,'pending-install.json'),'utf8'));if(spec.build===options.build){await atomic(spec.confirmation,{build:options.build,nonce:spec.nonce});await fs.rm(path.join(directory,'pending-install.json'),{force:true});state={state:'succeeded',version:options.version};await persist();}}catch{}}
 };
}
module.exports={createUpdater,verifyManifest,hashFile,zipEntries,trustedUrl};
