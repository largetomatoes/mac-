const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const {defaultTransport} = require('./oss-cloud');
const ROOT = '/dav/问间资料库/sync-v1/';
const MAX_BOOK = 500 * 1000 * 1000;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function validateNutstoreConfig(input) {
  const username = String(input?.username || '').trim().toLowerCase();
  const password = input?.password;
  if (!/^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(username) || username.length > 254 || typeof password !== 'string' || password.length < 4 || password.length > 256 || /[\r\n]/.test(password)) throw new Error('请填写坚果云邮箱和应用密码。');
  return {username, password};
}
function nutstoreTarget(config) { return 'nutstore/' + config.username.toLowerCase() + '/问间资料库/'; }
function canCorrectUnconfirmedSync(state) {
  if (!state || state.lastSync || state.published?.length || !state.device || !Array.isArray(state.received) || state.received.length || !Array.isArray(state.operations) || !Array.isArray(state.pending)) return false;
  const pending = new Map(state.pending.map(operation => [operation.id, operation]));
  return pending.size === state.pending.length && pending.size === state.operations.length && state.operations.every(operation => operation.device === state.device && JSON.stringify(pending.get(operation.id)) === JSON.stringify(operation));
}
function objectPath(key) {
  if (!/^(changes\/[a-f0-9]{64}\.json|books\/[a-f0-9]{64}\.(pdf|epub))$/.test(key || '')) throw new Error('同步文件名无效。');
  return ROOT + (key.startsWith('changes/') ? 'changes/' + key[8] + '/' + key.slice(8) : key);
}
function decodeXml(value) { return value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (m,n,s) => n ? String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10)) : ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[s.toLowerCase()])); }
function children(xml, folder) {
  if (!/<(?:[\w-]+:)?multistatus[\s>]/.test(xml) || !/<\/(?:[\w-]+:)?multistatus>/.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('坚果云目录响应不完整。');
  const blocks = [...xml.matchAll(/<(?:[\w-]+:)?response[\s>]([\s\S]*?)<\/(?:[\w-]+:)?response>/g)];
  // Nutstore truncates long PROPFIND listings. Never merge a possibly partial listing.
  if(!blocks.length)throw new Error('坚果云目录响应为空，未合并。');
  if (blocks.length >= 750) throw new Error('坚果云目录达到单次读取上限，已暂停同步，未覆盖本机内容。');
  return blocks.map(block => {
    const href=/<(?:[\w-]+:)?href[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/.exec(block[1]);
    if (!href) throw new Error('坚果云目录缺少文件地址。');
    const url=new URL(decodeXml(href[1]),'https://dav.jianguoyun.com');
    if(url.origin!=='https://dav.jianguoyun.com')throw new Error('坚果云返回了外部地址。');
    const pathname=decodeURIComponent(url.pathname);
    if(!/<(?:[\w-]+:)?status[^>]*>HTTP\/\d(?:\.\d)? 2\d\d/.test(block[1]))throw new Error('坚果云文件状态读取失败。');
    if(pathname.replace(/\/$/,'')===folder.replace(/\/$/,''))return null;
    if(!pathname.startsWith(folder)||pathname.slice(folder.length).replace(/\/$/,'').includes('/'))throw new Error('坚果云返回了目录外的文件。');
    const child=pathname.slice(folder.length);
    // WebDAV collections may omit a trailing slash in href. Nutstore does so
    // in real PROPFIND replies; resourcetype, rather than href spelling, is decisive.
    return /<(?:[\w-]+:)?collection(?:\s[^>]*)?\/?>/.test(block[1])?child.replace(/\/?$/,'/'):child;
  }).filter(Boolean);
}
function createNutstoreClient(input, options={}) {
  const config=validateNutstoreConfig(input),transport=options.transport||defaultTransport;
  const ensured=new Set();
  async function request(method, pathname, options={}) {
    const headers={authorization:'Basic '+Buffer.from(config.username+':'+config.password).toString('base64'),...options.headers};
    if(options.body)headers['content-length']=String(options.body.length);
    return transport({method,hostname:'dav.jianguoyun.com',requestPath:pathname.split('/').map(encodeURIComponent).join('/'),...options,headers,timeoutMs:120000});
  }
  function success(result) { if(result.statusCode<200||result.statusCode>=300) {const code=result.statusCode;const error=new Error(code===401?'坚果云身份验证失败（401），请检查账号邮箱和第三方应用密码。':code===403?'坚果云拒绝访问（403），请检查应用授权或目录权限；这不一定是密码错误。':code===429?'坚果云请求过于频繁，请稍后重试。':code===507?'坚果云空间或流量不足。':'坚果云请求失败（'+code+'）。');error.status=code;throw error;}return result; }
  async function mkdir(folder){if(ensured.has(folder))return;const response=await request('MKCOL',folder);if(response.statusCode!==405)success(response);ensured.add(folder);}
  async function ensure(key){for(const folder of ['/dav/问间资料库/',ROOT,ROOT+'changes/',ROOT+'books/'])await mkdir(folder);if(key?.startsWith('changes/'))await mkdir(ROOT+'changes/'+key[8]+'/');}
  async function listing(folder){const r=await request('PROPFIND',folder,{headers:{Depth:'1','content-type':'application/xml'},body:Buffer.from('<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>')});if(r.statusCode===404)return [];success(r);return children(r.body.toString('utf8'),folder);}
  async function syncRemote({action,key,text}) {
    if(action==='check'){
      await ensure();
      const probe=Buffer.from('{"schema":1,"purpose":"wenjian-connection-check"}'),pathname=ROOT+'connection-check.json';
      const put=await request('PUT',pathname,{headers:{'If-None-Match':'*','content-type':'application/json'},body:probe});
      if(put.statusCode!==412)success(put);
      if(!success(await request('GET',pathname)).body.equals(probe))throw new Error('连接检查文件不一致，请检查云端问间目录。');
      return {ok:true,...await syncRemote({action:'list'})};
    }
    if(action==='list'){const keys=[];for(const dir of await listing(ROOT+'changes/')){if(!/^[a-f0-9]\/$/.test(dir))throw new Error('坚果云同步目录含未知项目（'+dir.slice(0,80)+'），未合并。');for(const name of await listing(ROOT+'changes/'+dir)){if(!new RegExp('^'+dir[0]+'[a-f0-9]{63}\\.json$').test(name))throw new Error('坚果云同步文件名不正确。');keys.push('changes/'+name);}}return {keys};}
    const pathname=objectPath(key);if(!key.startsWith('changes/'))throw new Error('请使用书籍接口。');
    if(action==='get'){const body=success(await request('GET',pathname)).body;return {text:body.toString('utf8')};}
    if(action!=='put'||typeof text!=='string'||Buffer.byteLength(text)>16*1024*1024||key!=='changes/'+sha(text)+'.json')throw new Error('同步文件校验不正确。');
    await ensure(key);const result=await request('PUT',pathname,{headers:{'If-None-Match':'*','content-type':'application/json'},body:Buffer.from(text)});
    if(result.statusCode===412){const existing=success(await request('GET',pathname));if(sha(existing.body)!==sha(text))throw new Error('云端文件校验失败。');}else success(result);return {ok:true};
  }
  async function uploadBook(filePath,format){if(!['pdf','epub'].includes(format))throw new Error('只支持 PDF / EPUB');const stat=await fsp.stat(filePath);if(!stat.isFile()||stat.size<1||stat.size>MAX_BOOK)throw new Error('坚果云 WebDAV 单本书需小于 500 MB；笔记仍可同步。');const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(filePath))digest.update(chunk);const sha256=digest.digest('hex'),key='books/'+sha256+'.'+format;await ensure();const result=await request('PUT',objectPath(key),{headers:{'If-None-Match':'*','content-length':String(stat.size),'content-type':'application/octet-stream'},uploadPath:filePath});if(result.statusCode===412){const head=success(await request('HEAD',objectPath(key)));if(Number(head.headers['content-length'])!==stat.size)throw new Error('云端书籍大小与本机不一致。');}else success(result);return {key,sha256,size:stat.size};}
  async function downloadBook(file,destination){if(!file||!/^[a-f0-9]{64}$/.test(file.sha256||'')||!['books/'+file.sha256+'.pdf','books/'+file.sha256+'.epub'].includes(file.key)||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_BOOK)throw new Error('云端书籍清单无效。');const temporary=destination+'.download-'+crypto.randomUUID();try{const result=success(await request('GET',objectPath(file.key),{downloadPath:temporary,expectedSize:file.size}));if(result.download?.size!==file.size||result.download?.sha256!==file.sha256)throw new Error('书籍校验失败，未替换本机文件。');await fsp.rename(temporary,destination);return {ok:true};}finally{await fsp.unlink(temporary).catch(()=>{});}}
  return {syncRemote,uploadBook,downloadBook,test:async()=>{await ensure();await listing(ROOT);return {ok:true};}};
}
module.exports={createNutstoreClient,validateNutstoreConfig,nutstoreTarget,canCorrectUnconfirmedSync,objectPath,children};
