const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

let mainWindow = null;
let server = null;
let localPort = null;
let dataPath = null;
let libraryDir = null;
let storageMode = 'local';
let storageDir = null;

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
app.setAboutPanelOptions({ applicationName: '问间', applicationVersion: '1.8.7', version: '18', copyright: '私人本地笔记应用' });

async function resolveStorageDirectory() {
  const localDir = app.getPath('userData');
  if (process.env.WENJIAN_TEST_DATA_DIR) return { directory: localDir, mode: 'local' };
  const configPath = path.join(localDir, 'sync-config.json');
  const defaultNutstoreDir = path.join(app.getPath('home'), 'Documents', '问间同步');
  try {
    const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
    if (config && config.provider === 'nutstore' && typeof config.dataDirectory === 'string' && path.isAbsolute(config.dataDirectory)) {
      await fsp.mkdir(config.dataDirectory, { recursive: true });
      return { directory: config.dataDirectory, mode: 'nutstore' };
    }
  } catch {}
  try {
    await fsp.access(path.join(defaultNutstoreDir, '.wenjian-sync.json'));
    await fsp.mkdir(defaultNutstoreDir, { recursive: true });
    await fsp.writeFile(configPath, `${JSON.stringify({ provider: 'nutstore', dataDirectory: defaultNutstoreDir }, null, 2)}\n`, 'utf8');
    return { directory: defaultNutstoreDir, mode: 'nutstore' };
  } catch {}
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
  return { ...data, thoughtReplies: data.thoughtReplies || [], manuscripts: data.manuscripts || [], libraryBooks: data.libraryBooks || [], libraryHighlights: data.libraryHighlights || [], ocrCache: data.ocrCache || [], bookThoughts: (data.bookThoughts || []).map((entry) => ({ ...entry, scope: entry.scope || 'book', locator: entry.locator || '', questionIds: entry.questionIds || [], thoughts: entry.thoughts || [] })), links: data.links || [], dismissedSuggestions: data.dismissedSuggestions || [] };
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
  try { await fsp.copyFile(dataPath, backup); } catch {}
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(temporary, dataPath);
}
async function requestBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 25 * 1024 * 1024) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
    return jsonReply(response, 500, { error: '本地保存没有完成，请重试。' });
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
    const chosen = process.env.WENJIAN_TEST_IMPORT_PATH ? { canceled: false, filePaths: [process.env.WENJIAN_TEST_IMPORT_PATH] } : await dialog.showOpenDialog(mainWindow, { title: '导入 PDF 或 EPUB', properties: ['openFile'], filters: [{ name: '电子书', extensions: ['pdf', 'epub'] }] });
    if (chosen.canceled || !chosen.filePaths[0]) return jsonReply(response, 200, { imported: false });
    const source = chosen.filePaths[0];
    const format = path.extname(source).toLowerCase().slice(1);
    if (!['pdf', 'epub'].includes(format)) return jsonReply(response, 400, { error: '请选择 PDF 或 EPUB 文件。' });
    const id = crypto.randomUUID();
    const storedFile = `${id}.${format}`;
    await fsp.mkdir(libraryDir, { recursive: true });
    await fsp.copyFile(source, path.join(libraryDir, storedFile));
    const originalName = path.basename(source);
    return jsonReply(response, 200, { imported: true, book: { id, title: path.basename(source, path.extname(source)), author: '', format, storedFile, originalName, addedAt: new Date().toISOString(), progress: {} } });
  } catch (error) {
    console.error(error);
    return jsonReply(response, 500, { error: '书籍没有导入，请重试。' });
  }
}
async function handleLibraryDelete(request, response) {
  let stagedFile = null;
  let originalFile = null;
  try {
    if (request.method !== 'DELETE') return jsonReply(response, 405, { error: '不支持的操作。' });
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
async function startServer() {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/notebook') handleApi(request, response);
    else if (url.pathname === '/api/share') handleShare(request, response);
    else if (url.pathname === '/api/library/import') handleLibraryImport(request, response);
    else if (url.pathname === '/api/library/delete') handleLibraryDelete(request, response);
    else if (url.pathname.startsWith('/api/library/file/')) handleLibraryFile(request, response, url.pathname);
    else handleStatic(request, response, url.pathname);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

async function exportBackup() {
  const result = await dialog.showSaveDialog(mainWindow, { title: '导出本地备份', defaultPath: `问间备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: '问间备份', extensions: ['json'] }] });
  if (!result.canceled && result.filePath) { await fsp.copyFile(dataPath, result.filePath); await dialog.showMessageBox(mainWindow, { type: 'info', title: '备份完成', message: '本地笔记已导出。', buttons: ['好'] }); }
}
async function restoreBackup() {
  const chosen = await dialog.showOpenDialog(mainWindow, { title: '选择问间备份', properties: ['openFile'], filters: [{ name: '问间备份', extensions: ['json'] }] });
  if (chosen.canceled || !chosen.filePaths[0]) return;
  try {
    const value = JSON.parse(await fsp.readFile(chosen.filePaths[0], 'utf8'));
    value.data = normalizeNotebookData(value.data || {});
    if (!Number.isInteger(value.version) || !validNotebookData(value.data)) throw new Error('invalid');
    const confirmation = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '恢复备份', message: '恢复后，当前本地笔记会被这份备份替换。', detail: '问间会先自动保留一份当前数据的备用副本。', buttons: ['取消', '恢复'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return;
    await writeStore(value);
    await mainWindow.webContents.reloadIgnoringCache();
  } catch { await dialog.showMessageBox(mainWindow, { type: 'error', title: '无法恢复', message: '这不是有效的问间备份。', buttons: ['好'] }); }
}

function setMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '问间', submenu: [
      { role: 'about', label: '关于问间' }, { type: 'separator' },
      { label: '导出本地备份…', accelerator: 'CmdOrCtrl+Shift+S', click: exportBackup },
      { label: '从备份恢复…', click: restoreBackup },
      { label: '显示本地数据文件', click: () => shell.showItemInFolder(dataPath) }, { type: 'separator' },
      { role: 'hide', label: '隐藏问间' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' }, { type: 'separator' }, { role: 'quit', label: '退出问间' }
    ]},
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '显示', submenu: [{ role: 'reload', label: '重新载入' }, { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '进入全屏幕' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }] }
  ]));
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 820, minHeight: 620, title: '问间', titleBarStyle: 'hiddenInset', backgroundColor: '#f7f8fb', show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
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
    await fsp.mkdir(storageDir, { recursive: true });
    await fsp.mkdir(libraryDir, { recursive: true });
    if (!fs.existsSync(dataPath)) await fsp.copyFile(path.join(process.resourcesPath, 'seed.json'), dataPath);
    localPort = await startServer();
    console.log(`WENJIAN_LOCAL_PORT=${localPort}`);
    setMenu(); createWindow();
  }).catch((error) => { console.error(error); dialog.showErrorBox('问间无法启动', '本地数据未能载入。'); app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && localPort) createWindow(); });
}
app.on('before-quit', () => { if (server) server.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
