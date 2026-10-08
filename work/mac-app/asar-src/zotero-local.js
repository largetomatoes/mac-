/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');

const API_ROOT = 'http://127.0.0.1:23119/api';
const MAX_ITEMS = 100000;

class ZoteroError extends Error {
  constructor(code, message) { super(message); this.name = 'ZoteroError'; this.code = code; }
}

function plainText(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 1000000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
      const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '';
    }).replace(/\u0000/g, '').trim();
}

function objectData(row) {
  if (!row || typeof row !== 'object') return null;
  const data = row.data && typeof row.data === 'object' ? row.data : row;
  const key = row.key || data.key;
  if (typeof key !== 'string' || !/^[A-Z0-9]{1,64}$/i.test(key)) return null;
  return { ...data, key, version: Number.isSafeInteger(row.version ?? data.version) ? row.version ?? data.version : 0 };
}

function attachmentFormat(item) {
  if (item.itemType !== 'attachment') return null;
  if (item.contentType === 'application/pdf' || /\.pdf$/i.test(item.filename || '')) return 'pdf';
  if (item.contentType === 'application/epub+zip' || /\.epub$/i.test(item.filename || '')) return 'epub';
  return null;
}

function safeStoredFile(value) {
  return typeof value === 'string' && value.length < 250 && !value.startsWith('.') &&
    !/[\x00-\x1f<>:"/\\|?*]/.test(value) && /\.(pdf|epub)$/i.test(value);
}

function dateText(value) { return typeof value === 'string' ? value.slice(0, 100) : ''; }
function statKey(stat) { return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
function checkAbort(signal) { if (signal?.aborted) throw new ZoteroError('CANCELLED', '已停止读取 Zotero。'); }

function createZoteroClient({ fetchImpl = globalThis.fetch, timeoutMs = 10000, pageSize = 100 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('缺少本机连接功能。');
  const limit = Math.max(1, Math.min(100, Math.floor(pageSize) || 100));
  const deadline = Math.max(10, Number(timeoutMs) || 10000);
  // Hashes are keyed by file identity and modification metadata. Nothing is written into Zotero.
  const hashCache = new Map();

  async function fileHash(filePath, signal) {
    checkAbort(signal);
    const stat = await fsp.lstat(filePath);
    if (!stat.isFile()) throw new ZoteroError('INVALID_FILE', '原文不是普通文件。');
    const signature = statKey(stat);
    const cached = hashCache.get(filePath);
    if (cached?.signature === signature) return { ...cached, size: stat.size };
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) { checkAbort(signal); hash.update(chunk); }
    if (statKey(await fsp.lstat(filePath)) !== signature) throw new ZoteroError('FILE_CHANGED', '原文正在修改，请稍后重试。');
    const result = { signature, hash: hash.digest('hex'), size: stat.size };
    if (hashCache.size > 20000) hashCache.clear();
    hashCache.set(filePath, result);
    return result;
  }

  async function readCatalog({ libraryDir, existingBooks = [], signal, expectedServerId } = {}) {
    if (typeof libraryDir !== 'string' || !path.isAbsolute(libraryDir)) throw new Error('本地书库目录不正确。');
    checkAbort(signal);
    let serverId = expectedServerId || '';
    const warnings = [];

    async function request(endpoint, { text = false, missingOK = false } = {}) {
      if (!/^\/users\/0\/(items|collections)(?:[/?]|$)/.test(endpoint)) throw new ZoteroError('INVALID_URL', 'Zotero 请求地址不正确。');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let timer;
      try {
        checkAbort(signal);
        return await Promise.race([
          (async () => {
            const response = await fetchImpl(`${API_ROOT}${endpoint}`, {
              method: 'GET', redirect: 'manual', signal: controller.signal,
              headers: { 'Zotero-API-Version': '3', Accept: text ? 'text/plain' : 'application/json', ...(serverId ? { 'Zotero-Server-ID': serverId } : {}) },
            });
            if (response.status >= 300 && response.status < 400) throw new ZoteroError('REDIRECT', 'Zotero 返回了跳转地址，已停止读取。');
            if (response.status === 403) throw new ZoteroError('PERMISSION', '请在 Zotero 的设置 → 高级中开启“允许此计算机上的其他应用程序与 Zotero 通信”。');
            if (response.status === 412) throw new ZoteroError('SERVER_CHANGED', 'Zotero 资料库发生切换，请重新连接。');
            const responseServer = response.headers.get('Zotero-Server-ID');
            if (!responseServer || !/^[\x21-\x7e]{1,128}$/.test(responseServer)) throw new ZoteroError('MISSING_SERVER_ID', '请使用支持本机资料库识别的新版 Zotero。');
            if (serverId && serverId !== responseServer) throw new ZoteroError('SERVER_CHANGED', 'Zotero 资料库发生切换，请重新连接。');
            serverId = responseServer;
            if (missingOK && [404, 409].includes(response.status)) return null;
            if (!response.ok) throw new ZoteroError('HTTP_ERROR', `Zotero 暂时无法读取（${response.status}）。`);
            const body = await response.text();
            if (text) return body;
            let rows;
            try { rows = JSON.parse(body); } catch { throw new ZoteroError('INVALID_DATA', 'Zotero 返回的资料格式不正确。'); }
            return { rows, total: Number(response.headers.get('Total-Results')) || null, link: response.headers.get('Link') || '' };
          })(),
          new Promise((resolve, reject) => { timer = setTimeout(() => { reject(new ZoteroError('TIMEOUT', '连接 Zotero 超时，请确认 Zotero 已打开后重试。')); controller.abort(); }, deadline); }),
        ]);
      } catch (error) {
        checkAbort(signal);
        if (error instanceof ZoteroError) throw error;
        throw new ZoteroError('UNAVAILABLE', '请先打开本机 Zotero，再连接书库。');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }

    async function readAll(kind) {
      const result = [], seen = new Set();
      for (let start = 0; start <= MAX_ITEMS; start += limit) {
        const page = await request(`/users/0/${kind}?format=json&limit=${limit}&start=${start}`);
        if (!Array.isArray(page.rows)) throw new ZoteroError('INVALID_DATA', 'Zotero 返回的资料格式不正确。');
        let additions = 0;
        for (const row of page.rows) {
          const item = objectData(row);
          if (!item || seen.has(item.key) || item.deleted) continue;
          seen.add(item.key); result.push(item); additions++;
        }
        const hasNext = /rel\s*=\s*["']?next(?:["';,\s]|$)/i.test(page.link);
        if (!hasNext && (page.rows.length < limit || (page.total !== null && start + page.rows.length >= page.total))) return result;
        if (page.rows.length === 0 || additions === 0 || result.length > MAX_ITEMS) throw new ZoteroError('INCOMPLETE', 'Zotero 文献列表未能完整读取，请重试。');
      }
      throw new ZoteroError('TOO_MANY_ITEMS', 'Zotero 文献数量过多，请稍后重试。');
    }

    const rows = await readAll('items');
    const collections = (await readAll('collections')).map(row => ({ key: row.key, name: plainText(row.name), ...(typeof row.parentCollection === 'string' ? { parentKey: row.parentCollection } : {}) }));
    const byKey = new Map(rows.map(row => [row.key, row]));
    const attachments = new Map(), annotations = new Map();
    for (const row of rows) {
      if (attachmentFormat(row)) {
        const parent = byKey.get(row.parentItem);
        const root = parent && !['attachment', 'annotation', 'note'].includes(parent.itemType) ? parent.key : row.key;
        if (!attachments.has(root)) attachments.set(root, []);
        attachments.get(root).push(row);
      } else if (row.itemType === 'annotation' && typeof row.parentItem === 'string') {
        if (!annotations.has(row.parentItem)) annotations.set(row.parentItem, []);
        annotations.get(row.parentItem).push(row);
      }
    }
    const roots = rows.filter(row => !['attachment', 'annotation', 'note'].includes(row.itemType) || attachments.has(row.key));
    await fsp.mkdir(libraryDir, { recursive: true });
    const existingBySize = new Map();
    for (const name of new Set(existingBooks.map(book => book?.storedFile).filter(safeStoredFile))) {
      checkAbort(signal);
      const stat = await fsp.lstat(path.join(libraryDir, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat?.isFile()) continue;
      if (!existingBySize.has(stat.size)) existingBySize.set(stat.size, []);
      existingBySize.get(stat.size).push(name);
    }

    async function copyAttachment(attachment) {
      const format = attachmentFormat(attachment);
      const location = await request(`/users/0/items/${encodeURIComponent(attachment.key)}/file/view/url`, { text: true, missingOK: true });
      if (!location) return null;
      let source;
      try {
        const url = new URL(location.trim());
        if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) throw new Error('non-local');
        source = fileURLToPath(url);
        if (!path.isAbsolute(source) || path.extname(source).toLowerCase() !== `.${format}`) throw new Error('wrong extension');
      } catch { warnings.push(`${plainText(attachment.title) || attachment.key}：原文不是可读取的本机 PDF／EPUB。`); return null; }
      let original;
      try { original = await fileHash(source, signal); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'INVALID_FILE' || error.code === 'EACCES') return null; throw error; }
      const handle = await fsp.open(source, 'r');
      try {
        const header = Buffer.alloc(1024);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const valid = format === 'pdf' ? header.subarray(0, bytesRead).includes(Buffer.from('%PDF-')) : header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        if (!valid) { warnings.push(`${plainText(attachment.title) || attachment.key}：文件格式与附件类型不一致。`); return null; }
      } finally { await handle.close(); }
      for (const name of existingBySize.get(original.size) || []) {
        if (path.extname(name).toLowerCase() === `.${format}` && (await fileHash(path.join(libraryDir, name), signal)).hash === original.hash) return { storedFile: name, originalName: path.basename(source), format };
      }
      const name = `zotero-${original.hash}.${format}`;
      const destination = path.join(libraryDir, name);
      const destinationHash = await fileHash(destination, signal).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (destinationHash) {
        if (destinationHash.hash !== original.hash) throw new ZoteroError('FILE_COLLISION', '书库中有名称相同但内容不同的文件，已保留原文件。');
        return { storedFile: name, originalName: path.basename(source), format };
      }
      const temporary = path.join(libraryDir, `.zotero-${crypto.randomUUID()}.partial`);
      try {
        checkAbort(signal);
        await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
        if ((await fileHash(temporary, signal)).hash !== original.hash || (await fileHash(source, signal)).hash !== original.hash) throw new ZoteroError('FILE_CHANGED', '复制时 Zotero 原文发生修改，请重试。');
        try { await fsp.link(temporary, destination); }
        catch (error) { if (error.code !== 'EEXIST' || (await fileHash(destination, signal)).hash !== original.hash) throw error; }
      } finally { hashCache.delete(temporary); await fsp.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      if (!existingBySize.has(original.size)) existingBySize.set(original.size, []);
      existingBySize.get(original.size).push(name);
      return { storedFile: name, originalName: path.basename(source), format };
    }

    const items = [];
    for (const root of roots) {
      checkAbort(signal);
      const candidates = (attachments.get(root.key) || []).sort((a, b) => {
        const aPDF = attachmentFormat(a) === 'pdf', bPDF = attachmentFormat(b) === 'pdf';
        return Number(bPDF) - Number(aPDF) || String(a.dateAdded || '').localeCompare(String(b.dateAdded || '')) || a.key.localeCompare(b.key);
      });
      // Retain an existing primary attachment when a later import adds another edition.
      const previous = existingBooks.find(book => book?.zotero?.serverId === serverId && book?.zotero?.itemKey === root.key);
      const previousAttachment = previous?.zotero?.attachmentKey;
      if (previousAttachment) candidates.sort((a, b) => Number(b.key === previousAttachment) - Number(a.key === previousAttachment));
      let primary = candidates[0], file = null;
      for (const candidate of candidates) {
        const available = await copyAttachment(candidate);
        if (available) { primary = candidate; file = available; break; }
      }
      if (candidates.length && !file) warnings.push(`${plainText(root.title) || root.key}：原文尚未在本机可用，已保留文献与摘录。`);
      const importedAnnotations = candidates.flatMap(attachment => (annotations.get(attachment.key) || []).map(row => {
        let position;
        try { position = JSON.parse(typeof row.annotationPosition === 'string' ? row.annotationPosition : '{}'); } catch { position = {}; }
        const pageIndex = position && Number.isSafeInteger(position.pageIndex) && position.pageIndex >= 0 ? position.pageIndex : null;
        return {
          // Zotero quotes are already plain text; preserve literal angle brackets and entities.
          key: row.key, type: plainText(row.annotationType), text: typeof row.annotationText === 'string' ? row.annotationText.replace(/\u0000/g, '') : '', comment: plainText(row.annotationComment),
          pageLabel: plainText(row.annotationPageLabel), ...(attachmentFormat(attachment) === 'pdf' && pageIndex !== null ? { page: pageIndex + 1 } : {}),
          ...(typeof row.annotationPosition === 'string' ? { position: row.annotationPosition.slice(0, 100000) } : {}),
          color: /^#[0-9a-f]{6}$/i.test(row.annotationColor || '') ? row.annotationColor : '',
          at: dateText(row.dateAdded), modifiedAt: dateText(row.dateModified), attachmentKey: attachment.key,
          _sort: typeof row.annotationSortIndex === 'string' ? row.annotationSortIndex : '',
        };
      })).sort((a, b) => a.attachmentKey.localeCompare(b.attachmentKey) || a._sort.localeCompare(b._sort) || (a.page || 0) - (b.page || 0) || a.key.localeCompare(b.key))
        .map(annotation => { delete annotation._sort; return annotation; });
      const creators = Array.isArray(root.creators) ? root.creators : [];
      const authors = creators.filter(creator => !creator.creatorType || ['author', 'bookAuthor', 'editor'].includes(creator.creatorType));
      items.push({
        itemKey: root.key, itemVersion: Math.max(root.version, ...candidates.map(item => item.version), ...candidates.flatMap(item => (annotations.get(item.key) || []).map(annotation => annotation.version)), 0),
        itemType: plainText(root.itemType), title: plainText(root.title) || plainText(primary?.filename) || '未命名文献',
        author: authors.map(creator => plainText(creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))).filter(Boolean).join('、'),
        date: plainText(root.date), publisher: plainText(root.publisher), doi: plainText(root.DOI), isbn: plainText(root.ISBN),
        collections: [...new Set((Array.isArray(root.collections) ? root.collections : []).filter(key => typeof key === 'string'))],
        format: file?.format || 'reference', storedFile: file?.storedFile || '', originalName: file?.originalName || plainText(primary?.filename),
        addedAt: dateText(root.dateAdded), sourceAvailable: true, ...(primary ? { attachmentKey: primary.key } : {}), annotations: importedAnnotations,
      });
    }
    return { connected: true, serverId, library: 'users/0', items, collections, warnings };
  }
  return { readCatalog };
}

const defaultClient = createZoteroClient();
module.exports = { createZoteroClient, readZoteroCatalog: options => defaultClient.readCatalog(options), ZoteroError };
