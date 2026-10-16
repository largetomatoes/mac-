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

export {children};
