const { app, BrowserWindow, Menu, dialog, shell, session, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { createAnnotatedPdf } = require('./pdf-export');
const { MAGIC: BACKUP_MAGIC, exportCompleteBackup, inspectCompleteBackup, restoreCompleteBackup } = require('./complete-backup');
const { createOssArchiveClient, validateOssConfig } = require('./oss-cloud');
const { prepareLocalLibrary } = require('./library-location');

let mainWindow = null;
let server = null;
let localPort = null;
let dataPath = null;
let libraryDir = null;
let storageMode = 'local';
let storageDir = null;
let restoringBackup = false;
let draftsPath = null;
let draftQueue = Promise.resolve();
let cloudJob = { state: 'idle' };
let cloudBusy = false;
const MAX_DRAFT_BYTES = 32 * 1024 * 1024;

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-features', 'PushMessaging,BackgroundFetch,PeriodicBackgroundSync,OptimizationHints,MediaRouter');
app.commandLine.appendSwitch('proxy-server', '127.0.0.1:9');
app.commandLine.appendSwitch('proxy-bypass-list', 'localhost;127.0.0.1;[::1]');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * 0.0.0.0, EXCLUDE localhost');
app.setName('问间');
if (process.env.WENJIAN_TEST_DATA_DIR) app.setPath('userData', process.env.WENJIAN_TEST_DATA_DIR);
app.setAboutPanelOptions({ applicationName: '问间', applicationVersion: '1.12.0', version: '25', copyright: '私人本地笔记应用' });

async function resolveStorageDirectory() {
  const localDir = app.getPath('userData');
  if (process.env.WENJIAN_TEST_DATA_DIR) return { directory: localDir, mode: 'local' };
  const configPath = path.join(localDir, 'sync-config.json');
  const defaultNutstoreDir = path.join(app.getPath('home'), 'Documents', '问间同步');
  let config;
  try {
    config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('同步目录配置无法读取，请检查 sync-config.json。');
  }
  if (config) {
    if (config.provider !== 'nutstore' || typeof config.dataDirectory !== 'string' || !path.isAbsolute(config.dataDirectory)) throw new Error('同步目录配置不正确，请检查 sync-config.json。');
    const stat = await fsp.stat(config.dataDirectory).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('原来的坚果云目录暂时不可用。请先恢复目录连接，问间不会打开其他位置的数据。');
    return { directory: config.dataDirectory, mode: 'nutstore' };
  }
  try {
    await fsp.access(path.join(defaultNutstoreDir, '.wenjian-sync.json'));
    if (!(await fsp.stat(defaultNutstoreDir)).isDirectory()) throw new Error('同步目录不是文件夹。');
    await fsp.access(path.join(defaultNutstoreDir, 'notebook.json'));
    await fsp.writeFile(configPath, `${JSON.stringify({ provider: 'nutstore', dataDirectory: defaultNutstoreDir }, null, 2)}\n`, 'utf8');
    return { directory: defaultNutstoreDir, mode: 'nutstore' };
  } catch (error) {
    if (fs.existsSync(path.join(defaultNutstoreDir, '.wenjian-sync.json'))) throw new Error('检测到坚果云资料库，但笔记文件不可用。请检查同步目录，问间不会打开其他位置的数据。');
    if (error.code !== 'ENOENT') throw error;
  }
  return { directory: localDir, mode: 'local' };
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.pdf': 'application/pdf', '.epub': 'application/epub+zip' };
function jsonReply(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function validNotebookData(data) {
  return data && typeof data === 'object' && ['notes', 'cards', 'readingNotes', 'crossThoughts', 'thoughtReplies', 'manuscripts', 'libraryBooks', 'libraryHighlights', 'ocrCache', 'bookThoughts', 'links', 'dismissedSuggestions'].every((key) => Array.isArray(data[key])) && data.notes.length > 0;
}
function normalizeNotebookData(data) {
  return { ...data, thoughtReplies: data.thoughtReplies || [], manuscripts: data.manuscripts || [], libraryBooks: (data.libraryBooks || []).map((book) => ({ ...book, pdfChapters: (book.pdfChapters || []).filter((chapter) => chapter && typeof chapter.title === 'string' && Number.isInteger(chapter.startPage) && chapter.startPage > 0) })), libraryHighlights: data.libraryHighlights || [], ocrCache: data.ocrCache || [], bookThoughts: (data.bookThoughts || []).map((entry) => ({ ...entry, scope: entry.scope || 'book', locator: entry.locator || '', quote: entry.quote || undefined, chapter: entry.chapter || undefined, questionIds: entry.questionIds || [], thoughts: entry.thoughts || [] })), links: data.links || [], dismissedSuggestions: data.dismissedSuggestions || [] };
}
async function readStore() {
  const value = JSON.parse(await fsp.readFile(dataPath, 'utf8'));
  value.data = normalizeNotebookData(value.data || {});
  if (!Number.isInteger(value.version) || !validNotebookData(value.data)) throw new Error('本地数据格式不正确');
  return value;
}
async function writeStore(value) {
  const temporary = `${dataPath}.new`;
  const backup = `${dataPath}.backup`;
  const backupTemporary = `${backup}.new-${crypto.randomUUID()}`;
  try {
    await fsp.copyFile(dataPath, backupTemporary);
    await fsp.rename(backupTemporary, backup);
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(temporary, dataPath);
  } catch (error) {
    await fsp.unlink(backupTemporary).catch(() => {});
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function requestBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 40 * 1024 * 1024) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readDrafts() {
  let bytes;
  try { bytes = await fsp.readFile(draftsPath); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  if (bytes.length > MAX_DRAFT_BYTES) throw new Error('草稿文件超过大小限制。');
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('草稿文件格式不正确。');
  return value;
}
async function writeDrafts(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (bytes.length > MAX_DRAFT_BYTES) throw new Error('草稿超过 32 MB，请先整理后再保存。');
  const temporary = `${draftsPath}.new-${crypto.randomUUID()}`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fsp.rename(temporary, draftsPath);
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function handleDrafts(request, response) {
  try {
    if (request.method === 'GET') {
      await draftQueue;
      return jsonReply(response, 200, { drafts: await readDrafts() });
    }
    if (request.method !== 'PUT') return jsonReply(response, 405, { error: '不支持的操作。' });
    if (restoringBackup) return jsonReply(response, 423, { error: '正在恢复备份，请稍候。' });
    const input = await requestBody(request);
    if (!input || typeof input.key !== 'string' || input.key.length < 1 || input.key.length > 128 ||
        ['__proto__', 'constructor', 'prototype'].includes(input.key) || !Object.hasOwn(input, 'value')) {
      return jsonReply(response, 400, { error: '草稿名称不正确。' });
    }
    const operation = draftQueue.then(async () => {
      const drafts = { ...(await readDrafts()) };
      if (input.value === null) delete drafts[input.key];
      else drafts[input.key] = input.value;
      await writeDrafts(drafts);
    });
    draftQueue = operation.catch(() => {});
    await operation;
    return jsonReply(response, 200, { saved: true });
  } catch (error) {
    console.error(error);
    return jsonReply(response, 500, { error: error.message || '草稿没有保存，请重试。' });
  }
}

function deleteQuestion(data, id) {
  const target = data.notes.find((note) => note.id === id);
  if (!target || target.kind !== 'question' || !target.parent) throw new Error('只能删除子问题，核心问题不能删除。');
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const note of data.notes) if (note.parent && ids.has(note.parent) && !ids.has(note.id)) { ids.add(note.id); changed = true; }
  }
  const removedReading = data.readingNotes.filter((note) => note.questionIds.some((questionId) => ids.has(questionId)));
  const removedNotes = data.notes.filter((note) => ids.has(note.id));
  const thoughtIds = new Set(removedNotes.flatMap((note) => (note.thoughts || []).map((thought) => thought.id)));
  const removedAnchors = new Set([...ids, ...thoughtIds]);
  const readingNotes = data.readingNotes.map((note) => ({ ...note, questionIds: note.questionIds.filter((questionId) => !ids.has(questionId)) }));
  const crossThoughts = data.crossThoughts.map((cross) => {
    const anchorIds = cross.anchorIds.filter((anchorId) => !removedAnchors.has(anchorId));
    if (anchorIds.length === cross.anchorIds.length) return cross;
    return { ...cross, anchorIds, anchorRevisions: [...cross.anchorRevisions, { from: cross.anchorIds, to: anchorIds, fromLabel: cross.anchorIds.join(' ↔ '), toLabel: anchorIds.join(' ↔ '), at: new Date().toISOString(), reason: '关联板块被删除' }] };
  });
  return {
    ...data,
    notes: data.notes.filter((note) => !ids.has(note.id)), readingNotes, bookThoughts: data.bookThoughts.map((entry) => ({ ...entry, questionIds: entry.questionIds.filter((questionId) => !ids.has(questionId)) })), crossThoughts,
    thoughtReplies: (data.thoughtReplies || []).filter((reply) => !thoughtIds.has(reply.thoughtId)),
    manuscripts: (data.manuscripts || []).map((manuscript) => ({ ...manuscript, links: (manuscript.links || []).filter((link) => link.targetKind === 'reading' || !ids.has(link.questionId)) })),
    links: data.links.filter((link) => !ids.has(link.from) && !ids.has(link.to)),
    dismissedSuggestions: data.dismissedSuggestions.filter((suggestion) => ![...ids].some((removedId) => suggestion.endsWith(`:${removedId}`)))
  };
}

async function handleApi(request, response) {
  try {
    if (request.method === 'GET') return jsonReply(response, 200, { ...(await readStore()), storage: storageMode, storageDirectory: storageDir });
    if (restoringBackup) return jsonReply(response, 423, { error: '正在恢复备份，请稍候。' });
    const input = await requestBody(request);
    const current = await readStore();
    if (!Number.isInteger(input.version) || input.version !== current.version) return jsonReply(response, 409, { error: '另一窗口已保存新内容。请先复制当前输入，再重新载入。' });
    if (request.method === 'PUT') {
      if (!validNotebookData(input.data)) return jsonReply(response, 400, { error: '笔记数据格式不正确。' });
      await writeStore({ version: current.version + 1, data: input.data });
      return jsonReply(response, 200, { version: current.version + 1 });
    }
    if (request.method === 'DELETE') {
      const target = current.data.notes.find((note) => note.id === input.id);
      if (!input.confirmed || input.confirmation !== '删除' || !target || target.title !== input.title) return jsonReply(response, 400, { error: '请完成两步删除确认。' });
      const data = deleteQuestion(current.data, input.id);
      await writeStore({ version: current.version + 1, data });
      return jsonReply(response, 200, { version: current.version + 1, data });
    }
    return jsonReply(response, 405, { error: '不支持的操作。' });
  } catch (error) {
    console.error(error);
    const location = storageMode === 'nutstore' ? '请检查坚果云资料目录。' : '请检查本地资料目录。';
    return jsonReply(response, 500, { error: request.method === 'GET' ? `资料库暂时无法读取。${location}` : `保存没有完成。${location}` });
  }
}

async function handleStatic(request, response, pathname) {
  const staticRoot = path.join(process.resourcesPath, 'static');
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const resolved = path.resolve(staticRoot, requested);
  if (resolved !== path.join(staticRoot, 'index.html') && !resolved.startsWith(`${staticRoot}${path.sep}`)) { response.writeHead(403); response.end(); return; }
  try {
    const body = await fsp.readFile(resolved);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': pathname === '/' ? 'no-store' : 'public, max-age=31536000, immutable' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}
async function handleShare(request, response) {
  try {
    if (request.method !== 'POST') return jsonReply(response, 405, { error: '不支持的操作。' });
    const input = await requestBody(request);
    if (typeof input.html !== 'string' || !input.html.startsWith('<!doctype html>') || input.html.length > 25 * 1024 * 1024) return jsonReply(response, 400, { error: '只读副本格式不正确。' });
    const suggested = typeof input.filename === 'string' && input.filename.endsWith('.html') ? input.filename.replace(/[\\/:*?"<>|]/g, '-') : '问间-只读副本.html';
    const result = process.env.WENJIAN_TEST_SHARE_PATH ? { canceled: false, filePath: process.env.WENJIAN_TEST_SHARE_PATH } : await dialog.showSaveDialog(mainWindow, { title: '分享只读副本', defaultPath: suggested, filters: [{ name: '只读网页', extensions: ['html'] }] });
    if (result.canceled || !result.filePath) return jsonReply(response, 200, { saved: false });
    await fsp.writeFile(result.filePath, input.html, 'utf8');
    return jsonReply(response, 200, { saved: true });
  } catch (error) {
    console.error(error);
    return jsonReply(response, 500, { error: '只读副本没有生成，请重试。' });
  }
}
async function handleLibraryImport(request, response) {
  try {
    if (request.method !== 'POST') return jsonReply(response, 405, { error: '不支持的操作。' });
    if (restoringBackup) return jsonReply(response, 423, { error: '正在恢复备份，请稍候。' });
    await readStore();
    if (!(await fsp.stat(libraryDir)).isDirectory()) throw new Error('书库目录不可用');
    const chosen = process.env.WENJIAN_TEST_IMPORT_PATH ? { canceled: false, filePaths: [process.env.WENJIAN_TEST_IMPORT_PATH] } : await dialog.showOpenDialog(mainWindow, { title: '导入 PDF 或 EPUB', properties: ['openFile'], filters: [{ name: '电子书', extensions: ['pdf', 'epub'] }] });
    if (chosen.canceled || !chosen.filePaths[0]) return jsonReply(response, 200, { imported: false });
    const source = chosen.filePaths[0];
    const format = path.extname(source).toLowerCase().slice(1);
    if (!['pdf', 'epub'].includes(format)) return jsonReply(response, 400, { error: '请选择 PDF 或 EPUB 文件。' });
    const id = crypto.randomUUID();
    const storedFile = `${id}.${format}`;
    await fsp.copyFile(source, path.join(libraryDir, storedFile));
    const originalName = path.basename(source);
    return jsonReply(response, 200, { imported: true, book: { id, title: path.basename(source, path.extname(source)), author: '', format, storedFile, originalName, addedAt: new Date().toISOString(), progress: {} } });
  } catch (error) {
    console.error(error);
    return jsonReply(response, 500, { error: '书籍没有导入，请重试。' });
  }
}
function safePdfFilename(value) {
  const cleaned = String(value || '书籍').replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${cleaned || '书籍'}-问间批注版.pdf`;
}
async function handleAnnotatedPdfExport(request, response) {
  try {
    if (request.method !== 'POST') return jsonReply(response, 405, { error: '不支持的操作。' });
    const input = await requestBody(request);
    const store = await readStore();
    const book = store.data.libraryBooks.find((entry) => entry.id === input.bookId && entry.format === 'pdf');
    if (!book || path.basename(book.storedFile) !== book.storedFile) return jsonReply(response, 404, { error: '没有找到这本 PDF。' });
    const sourcePath = path.join(libraryDir, book.storedFile);
    const suggested = safePdfFilename(book.title);
    const result = process.env.WENJIAN_TEST_ANNOTATED_PDF_PATH ? { canceled: false, filePath: process.env.WENJIAN_TEST_ANNOTATED_PDF_PATH } : await dialog.showSaveDialog(mainWindow, { title: '导出批注版 PDF', defaultPath: suggested, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return jsonReply(response, 200, { saved: false });
    const output = await createAnnotatedPdf(await fsp.readFile(sourcePath), input.pages);
    await fsp.writeFile(result.filePath, output);
    return jsonReply(response, 200, { saved: true });
  } catch (error) {
    console.error(error);
    return jsonReply(response, 500, { error: '批注版 PDF 没有生成，请重试。' });
  }
}
async function handleLibraryDelete(request, response) {
  let stagedFile = null;
  let originalFile = null;
  try {
    if (request.method !== 'DELETE') return jsonReply(response, 405, { error: '不支持的操作。' });
    if (restoringBackup) return jsonReply(response, 423, { error: '正在恢复备份，请稍候。' });
    const input = await requestBody(request);
    const current = await readStore();
    if (!Number.isInteger(input.version) || input.version !== current.version) return jsonReply(response, 409, { error: '另一窗口已保存新内容。请先重新载入。' });
	    const book = current.data.libraryBooks.find((entry) => entry.id === input.id);
    if (!input.confirmed || input.confirmation !== '删除' || !book || book.title !== input.title) return jsonReply(response, 400, { error: '请完成两步删除确认。' });
    if (path.basename(book.storedFile) !== book.storedFile) return jsonReply(response, 400, { error: '书籍文件记录不正确。' });
    originalFile = path.join(libraryDir, book.storedFile);
    stagedFile = `${originalFile}.deleting-${crypto.randomUUID()}`;
    try { await fsp.rename(originalFile, stagedFile); } catch (error) { if (error.code !== 'ENOENT') throw error; stagedFile = null; }
	    const replacementBook = current.data.libraryBooks.find((entry) => entry.id !== book.id && entry.format === book.format && entry.originalName === book.originalName);
	    const data = {
      ...current.data,
      libraryBooks: current.data.libraryBooks.filter((entry) => entry.id !== book.id),
      libraryHighlights: current.data.libraryHighlights.filter((entry) => entry.libraryBookId !== book.id),
      ocrCache: current.data.ocrCache.filter((entry) => entry.libraryBookId !== book.id),
	      readingNotes: current.data.readingNotes.map((note) => {
        if (note.libraryBookId !== book.id) return note;
        const kept = { ...note };
        delete kept.libraryBookId;
        delete kept.sourceLocation;
        return kept;
	      }),
	      bookThoughts: current.data.bookThoughts.map((entry) => {
	        if (entry.libraryBookId !== book.id) return entry;
	        if (replacementBook) return { ...entry, libraryBookId: replacementBook.id };
	        const kept = { ...entry };
	        delete kept.libraryBookId;
	        delete kept.sourceLocation;
	        return kept;
	      })
    };
    await writeStore({ version: current.version + 1, data });
    if (stagedFile) await fsp.unlink(stagedFile).catch(() => {});
    return jsonReply(response, 200, { version: current.version + 1, data });
  } catch (error) {
    if (stagedFile && originalFile) await fsp.rename(stagedFile, originalFile).catch(() => {});
    console.error(error);
    return jsonReply(response, 500, { error: '书籍没有删除，请重试。' });
  }
}
async function handleLibraryFile(request, response, pathname) {
  try {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    const id = decodeURIComponent(pathname.slice('/api/library/file/'.length));
    const store = await readStore();
    const book = (store.data.libraryBooks || []).find((entry) => entry.id === id);
    if (!book || path.basename(book.storedFile) !== book.storedFile) { response.writeHead(404); response.end(); return; }
    const filePath = path.join(libraryDir, book.storedFile);
    const stat = await fsp.stat(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
      response.writeHead(206, { 'Content-Type': contentType, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  } catch { response.writeHead(404); response.end(); }
}

const cloudConfigPath = () => path.join(app.getPath('userData'), 'oss-config.json');
const cloudStatePath = () => path.join(app.getPath('userData'), 'oss-state.json');
function cloudTarget(config) { return `${config.region}/${config.bucket}/${config.prefix}`; }
async function atomicPrivateJson(filePath, value) {
  const temporary = `${filePath}.new-${crypto.randomUUID()}`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await fsp.rename(temporary, filePath);
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}
async function storedCloudConfig() {
  try { return JSON.parse(await fsp.readFile(cloudConfigPath(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('云备份设置无法读取。'); }
}
function publicCloudConfig(stored) {
  return stored ? { configured: true, region: stored.region, endpoint: stored.endpoint, bucket: stored.bucket, prefix: stored.prefix, accessKeyId: stored.accessKeyId } :
    { configured: false, region: '', endpoint: '', bucket: '', prefix: 'wenjian/', accessKeyId: '' };
}
async function activeCloudConfig() {
  const stored = await storedCloudConfig();
  if (!stored) throw new Error('请先设置阿里云 OSS。');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂时不可用，无法读取云备份密钥。');
  let accessKeySecret;
  try { accessKeySecret = safeStorage.decryptString(Buffer.from(stored.secretCiphertext, 'base64')); }
  catch { throw new Error('云备份密钥无法读取，请在设置中重新输入 AccessKey Secret。'); }
  return validateOssConfig({ ...stored, accessKeySecret });
}
async function readCloudState() {
  try { return JSON.parse(await fsp.readFile(cloudStatePath(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('云备份状态无法读取。'); }
}
async function saveCloudState(config, key) {
  await atomicPrivateJson(cloudStatePath(), { target: cloudTarget(config), lastKey: key, at: new Date().toISOString() });
}
function cloudFailure(error) {
  const message = String(error?.message || '云备份未完成。');
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
function cloudProgress(stage, progress) {
  const transferred = Number(progress?.transferred ?? progress?.loaded ?? 0);
  const total = Number(progress?.total ?? 0);
  cloudJob = { ...cloudJob, stage, progress: total > 0 ? Math.min(100, Math.round(transferred / total * 100)) : undefined };
}
function startCloudJob(kind, work) {
  if (cloudBusy || restoringBackup) throw new Error('另一项备份或恢复操作正在进行。');
  cloudBusy = true;
  const jobId = crypto.randomUUID();
  cloudJob = { jobId, kind, state: 'running', stage: kind === 'upload' ? '正在整理完整备份' : '正在下载云端备份' };
  void Promise.resolve().then(work).then((result) => {
    cloudJob = { jobId, kind, state: 'done', result, message: kind === 'upload' ? '云端备份已完成' : '资料已从云端恢复' };
  }).catch((error) => {
    cloudJob = { jobId, kind, state: 'error', message: cloudFailure(error) };
  }).finally(() => { cloudBusy = false; });
  return jobId;
}
async function uploadCloudSnapshot() {
  const config = await activeCloudConfig();
  const client = createOssArchiveClient(config);
  const snapshots = await client.listSnapshots();
  const state = await readCloudState();
  if (snapshots.length && (state?.target !== cloudTarget(config) || state.lastKey !== snapshots[0].key)) {
    throw new Error('云端已有另一份较新的资料。请先查看云端备份并恢复，避免覆盖另一台设备的工作。');
  }
  const temporary = path.join(app.getPath('userData'), `oss-upload-${crypto.randomUUID()}.wenjian-backup`);
  try {
    await draftQueue;
    const summary = await exportCompleteBackup({ notebookPath: dataPath, libraryDir, draftsPath, destination: temporary, validateNotebook: (value) => Number.isInteger(value?.version) && validNotebookData(value?.data) });
    cloudJob = { ...cloudJob, stage: `正在上传 ${summary.books} 本书与笔记`, progress: 0 };
    const uploaded = await client.uploadSnapshot({ filePath: temporary, onProgress: (progress) => cloudProgress('正在上传完整备份', progress) });
    await saveCloudState(config, uploaded.key);
    return { key: uploaded.key, books: summary.books, bytes: uploaded.size, createdAt: uploaded.createdAt };
  } finally { await fsp.unlink(temporary).catch(() => {}); }
}
async function restoreCloudSnapshot(key) {
  const config = await activeCloudConfig();
  const client = createOssArchiveClient(config);
  const snapshots = await client.listSnapshots();
  if (!snapshots.some((entry) => entry.key === key)) throw new Error('云端没有找到这份备份。');
  const temporary = path.join(app.getPath('userData'), `oss-download-${crypto.randomUUID()}.wenjian-backup`);
  restoringBackup = true;
  try {
    await draftQueue;
    cloudJob = { ...cloudJob, stage: '正在下载并校验云端备份', progress: 0 };
    await client.downloadSnapshot({ key, destination: temporary, onProgress: (progress) => cloudProgress('正在下载并校验云端备份', progress) });
    const backupDir = path.join(app.getPath('userData'), 'restore-safeguards');
    await fsp.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `恢复前-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.wenjian-backup`);
    cloudJob = { ...cloudJob, stage: '正在备份本机现有资料', progress: undefined };
    await exportCompleteBackup({ notebookPath: dataPath, libraryDir, draftsPath, destination: backupPath, validateNotebook: (value) => Number.isInteger(value?.version) && validNotebookData(value?.data) });
    cloudJob = { ...cloudJob, stage: '正在恢复笔记和书籍', progress: undefined };
    await restoreCompleteBackup({ archivePath: temporary, notebookPath: dataPath, libraryDir, draftsPath, validateNotebook: (candidate) => Number.isInteger(candidate?.version) && validNotebookData(candidate?.data), writeNotebook: (candidate) => writeStore(candidate), writeDrafts });
    await saveCloudState(config, key);
    return { restored: true, backupPath };
  } finally {
    restoringBackup = false;
    await fsp.unlink(temporary).catch(() => {});
  }
}
async function handleCloud(request, response, pathname) {
  try {
    if (pathname === '/api/cloud/config') {
      if (request.method === 'GET') return jsonReply(response, 200, publicCloudConfig(await storedCloudConfig()));
      if (request.method !== 'PUT') return jsonReply(response, 405, { error: '不支持的操作。' });
      if (cloudBusy) return jsonReply(response, 423, { error: '云备份正在运行，请稍候修改设置。' });
      const input = await requestBody(request);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写 OSS 设置。');
      const existing = await storedCloudConfig();
      const secret = String(input.accessKeySecret || '').trim();
      let accessKeySecret = secret;
      if (!secret) {
        if (!existing) throw new Error('请填写 AccessKey Secret。');
        accessKeySecret = (await activeCloudConfig()).accessKeySecret;
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂时不可用，无法保存云备份密钥。');
      const config = validateOssConfig({ region: input.region, endpoint: input.endpoint, bucket: input.bucket, prefix: input.prefix, accessKeyId: input.accessKeyId, accessKeySecret });
      const secretCiphertext = safeStorage.encryptString(config.accessKeySecret).toString('base64');
      await atomicPrivateJson(cloudConfigPath(), { region: config.region, endpoint: config.endpoint, bucket: config.bucket, prefix: config.prefix, accessKeyId: config.accessKeyId, secretCiphertext });
      return jsonReply(response, 200, publicCloudConfig(await storedCloudConfig()));
    }
    if (pathname === '/api/cloud/job') {
      if (request.method !== 'GET') return jsonReply(response, 405, { error: '不支持的操作。' });
      return jsonReply(response, 200, cloudJob);
    }
    if (pathname === '/api/cloud/check') {
      if (request.method !== 'POST') return jsonReply(response, 405, { error: '不支持的操作。' });
      const client = createOssArchiveClient(await activeCloudConfig());
      const snapshots = await client.listSnapshots({ limit: 1 });
      return jsonReply(response, 200, { ok: true, snapshots: snapshots.length });
    }
    if (pathname === '/api/cloud/snapshots') {
      if (request.method !== 'GET') return jsonReply(response, 405, { error: '不支持的操作。' });
      const client = createOssArchiveClient(await activeCloudConfig());
      return jsonReply(response, 200, { snapshots: await client.listSnapshots() });
    }
    if (pathname === '/api/cloud/upload') {
      if (request.method !== 'POST') return jsonReply(response, 405, { error: '不支持的操作。' });
      const jobId = startCloudJob('upload', uploadCloudSnapshot);
      return jsonReply(response, 202, { jobId });
    }
    if (pathname === '/api/cloud/restore') {
      if (request.method !== 'POST') return jsonReply(response, 405, { error: '不支持的操作。' });
      const input = await requestBody(request);
      if (input.confirmation !== '恢复' || typeof input.key !== 'string') return jsonReply(response, 400, { error: '请确认要恢复的云端备份。' });
      const jobId = startCloudJob('restore', () => restoreCloudSnapshot(input.key));
      return jsonReply(response, 202, { jobId });
    }
    return jsonReply(response, 404, { error: '没有找到云备份操作。' });
  } catch (error) {
    const message = cloudFailure(error);
    return jsonReply(response, /正在进行|请先|没有找到|请确认|修改连接设置/.test(message) ? 409 : 500, { error: message });
  }
}
async function startServer() {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/notebook') handleApi(request, response);
    else if (url.pathname === '/api/drafts') handleDrafts(request, response);
    else if (url.pathname.startsWith('/api/cloud/')) handleCloud(request, response, url.pathname);
    else if (url.pathname === '/api/share') handleShare(request, response);
    else if (url.pathname === '/api/library/import') handleLibraryImport(request, response);
    else if (url.pathname === '/api/library/export-annotated') handleAnnotatedPdfExport(request, response);
    else if (url.pathname === '/api/library/delete') handleLibraryDelete(request, response);
    else if (url.pathname.startsWith('/api/library/file/')) handleLibraryFile(request, response, url.pathname);
    else handleStatic(request, response, url.pathname);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

async function exportBackup() {
  const result = await dialog.showSaveDialog(mainWindow, { title: '导出完整备份', defaultPath: `问间完整备份-${new Date().toISOString().slice(0, 10)}.wenjian-backup`, filters: [{ name: '问间完整备份', extensions: ['wenjian-backup'] }] });
  if (result.canceled || !result.filePath) return;
  try {
    await draftQueue;
    const summary = await exportCompleteBackup({ notebookPath: dataPath, libraryDir, draftsPath, destination: result.filePath, validateNotebook: (value) => Number.isInteger(value?.version) && validNotebookData(value?.data) });
    await dialog.showMessageBox(mainWindow, { type: 'info', title: '备份完成', message: `笔记和 ${summary.books} 本书已完整备份并通过校验。`, buttons: ['好'] });
  } catch (error) {
    console.error(error);
    await dialog.showMessageBox(mainWindow, { type: 'error', title: '备份未完成', message: error.message || '请检查书籍文件和保存位置。', buttons: ['好'] });
  }
}
async function restoreBackup() {
  const chosen = await dialog.showOpenDialog(mainWindow, { title: '选择问间备份', properties: ['openFile'], filters: [{ name: '问间备份', extensions: ['wenjian-backup', 'json'] }] });
  if (chosen.canceled || !chosen.filePaths[0]) return;
  try {
    const source = chosen.filePaths[0];
    const probe = await fsp.open(source, 'r');
    const magic = Buffer.alloc(BACKUP_MAGIC.length);
    try { await probe.read(magic, 0, magic.length, 0); } finally { await probe.close(); }
    const complete = magic.equals(BACKUP_MAGIC);
    let value;
    let summary;
    if (complete) {
      summary = await inspectCompleteBackup(source, (candidate) => Number.isInteger(candidate?.version) && validNotebookData(candidate?.data));
    } else {
      if ((await fsp.stat(source)).size > 256 * 1024 * 1024) throw new Error('旧版 JSON 备份文件过大。');
      value = JSON.parse(await fsp.readFile(source, 'utf8'));
      value.data = normalizeNotebookData(value.data || {});
      if (!Number.isInteger(value.version) || !validNotebookData(value.data)) throw new Error('不是有效的问间备份。');
    }
    const missingBooks = complete ? 0 : (await Promise.all(value.data.libraryBooks.map(async (book) => {
      if (typeof book?.storedFile !== 'string' || path.basename(book.storedFile) !== book.storedFile) return true;
      return !(await fsp.access(path.join(libraryDir, book.storedFile)).then(() => true, () => false));
    }))).filter(Boolean).length;
    const detail = complete
      ? `备份包含 ${summary.entries.length} 本书，所有文件已经校验。当前笔记会先保留备用副本。`
      : `这是旧版 JSON 备份，只包含笔记，不包含原书文件。${missingBooks ? `当前书库缺少其中 ${missingBooks} 本书，恢复后这些书暂时无法打开。` : '对应原书文件目前仍在这台 Mac 上。'}当前笔记会先保留备用副本。`;
    const confirmation = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '恢复备份', message: '恢复后，当前笔记会被这份备份替换。', detail, buttons: ['取消', '恢复'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return;
    restoringBackup = true;
    if (complete) {
      await draftQueue;
      await restoreCompleteBackup({ archivePath: source, notebookPath: dataPath, libraryDir, draftsPath, validateNotebook: (candidate) => Number.isInteger(candidate?.version) && validNotebookData(candidate?.data), writeNotebook: (candidate) => writeStore(candidate), writeDrafts });
    }
    else await writeStore(value);
    await fsp.unlink(cloudStatePath()).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await mainWindow.webContents.reloadIgnoringCache();
  } catch (error) {
    console.error(error);
    await dialog.showMessageBox(mainWindow, { type: 'error', title: '无法恢复', message: error.message || '这不是有效的问间备份。', buttons: ['好'] });
  } finally { restoringBackup = false; }
}

function setMenu() {
  const platformItems = process.platform === 'darwin'
    ? [{ role: 'hide', label: '隐藏问间' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' }, { type: 'separator' }]
    : [];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: process.platform === 'darwin' ? '问间' : '文件', submenu: [
      { role: 'about', label: '关于问间' }, { type: 'separator' },
      { label: '导出完整备份…', accelerator: 'CmdOrCtrl+Shift+S', click: exportBackup },
      { label: '从备份恢复…', click: restoreBackup },
      { label: '阿里云 OSS 备份…', click: () => {
        if (!mainWindow) return;
        mainWindow.show(); mainWindow.focus();
        mainWindow.webContents.executeJavaScript('window.dispatchEvent(new Event("wenjian-open-cloud"))').catch(() => {});
      } },
      { label: '显示本地数据文件', click: () => shell.showItemInFolder(dataPath) }, { type: 'separator' },
      ...platformItems, { role: 'quit', label: '退出问间' }
    ]},
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '显示', submenu: [{ role: 'reload', label: '重新载入' }, { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '进入全屏幕' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }] }
  ]));
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 820, minHeight: 620, title: '问间', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}), backgroundColor: '#f7f8fb', show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${localPort}/`).catch((error) => { console.error(error); dialog.showErrorBox('问间无法打开', '本地页面载入失败，请重新打开问间。'); });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      try {
        const target = new URL(details.url);
        callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) });
      } catch { callback({ cancel: true }); }
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    const storage = await resolveStorageDirectory();
    storageMode = storage.mode;
    storageDir = storage.directory;
    dataPath = path.join(storageDir, 'notebook.json');
    libraryDir = path.join(storageDir, 'library');
    draftsPath = path.join(app.getPath('userData'), 'drafts.json');
    if (storageMode === 'local') {
      await fsp.mkdir(storageDir, { recursive: true });
      if (!fs.existsSync(dataPath)) {
        const initialized = fs.existsSync(path.join(storageDir, '.wenjian-storage.json')) || fs.existsSync(`${dataPath}.backup`);
        const existingBooks = await fsp.readdir(libraryDir).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
        if (initialized || existingBooks.length) throw new Error('原来的本地笔记文件不见了。问间已停止启动，避免打开空白资料库。');
        await fsp.copyFile(path.join(process.resourcesPath, 'seed.json'), dataPath);
      }
    } else {
      if (!fs.existsSync(dataPath)) throw new Error('坚果云目录中的笔记暂时不可用。问间已停止启动，避免打开空白资料库。');
    }
    const store = await readStore();
    libraryDir = await prepareLocalLibrary({ storageDir, userDataDir: app.getPath('userData'), books: store.data.libraryBooks, storageMode });
    if (storageMode === 'local') await fsp.writeFile(path.join(storageDir, '.wenjian-storage.json'), `${JSON.stringify({ initializedAt: new Date().toISOString() })}\n`, { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    localPort = await startServer();
    console.log(`WENJIAN_LOCAL_PORT=${localPort}`);
    setMenu(); createWindow();
  }).catch((error) => { console.error(error); dialog.showErrorBox('问间无法启动', error.message || '本地数据未能载入。'); app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && localPort) createWindow(); });
}
app.on('before-quit', () => { if (server) server.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
