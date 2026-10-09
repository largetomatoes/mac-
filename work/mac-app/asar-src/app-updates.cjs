const https=require('node:https');
const fs=require('node:fs/promises');
const jobs=new Map();
const RELEASES_API='https://api.github.com/repos/largetomatoes/mac-/releases?per_page=30';
function allowedReleaseUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.pathname==='/largetomatoes/mac-/releases'||url.pathname.startsWith('/largetomatoes/mac-/releases/tag/')||url.pathname.startsWith('/largetomatoes/mac-/releases/download/'));}catch{return false;}}
function publicReleases(){return new Promise((resolve,reject)=>{
 const request=https.get(RELEASES_API,{headers:{'User-Agent':'Wenjian-Update-Check','Accept':'application/vnd.github+json'}},response=>{
  if(response.statusCode!==200){response.resume();return reject(Error(response.statusCode===403||response.statusCode===429?'更新检查达到访问限额，请稍后重试。':'未能读取正式发布信息，请稍后重试。'));}
  let bytes=0;const parts=[];response.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024){response.destroy(Error('更新信息过大'));return;}parts.push(chunk);});response.on('error',reject);response.on('end',()=>{try{const releases=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!Array.isArray(releases))throw Error('更新信息格式不正确');resolve(releases);}catch(error){reject(error);}});
 });
 const timer=setTimeout(()=>request.destroy(Error('连接发布服务器超时，请检查网络后重试。')),15000);request.once('close',()=>clearTimeout(timer));request.on('error',()=>reject(Error('暂时无法连接 GitHub，请检查网络后重试。')));
});}
async function cachedPublicReleases(file,manual=false){
 if(!manual){try{const value=JSON.parse(await fs.readFile(file,'utf8')),age=Date.now()-value.at;if(age>=0&&age<(value.error?3600000:86400000)){if(value.error)throw Object.assign(Error(value.error),{cached:true});if(Array.isArray(value.releases))return value.releases;}}catch(error){if(error.cached)throw error;}}
 if(jobs.has(file))return jobs.get(file);
 const job=publicReleases().then(async releases=>{await fs.writeFile(file,JSON.stringify({at:Date.now(),releases}),{mode:0o600}).catch(()=>{});return releases;}).catch(async error=>{await fs.writeFile(file,JSON.stringify({at:Date.now(),error:error.message}),{mode:0o600}).catch(()=>{});throw error;}).finally(()=>jobs.delete(file));jobs.set(file,job);return job;
}
module.exports={allowedReleaseUrl,publicReleases,cachedPublicReleases};
