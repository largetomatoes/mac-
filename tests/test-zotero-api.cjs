/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

// Exercise the shipped Electron handlers with isolated storage and a fake shell.
// No Electron process, user library, Zotero installation or network is accessed.
const sourcePath = path.resolve(__dirname, '../work/mac-app/asar-src/main.js');
const main = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function handler(name) {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing application handler ${name}`);
  return declaration.getText(ast);
}
const handlers = `${handler('handleZotero')}\n${handler('handleLibraryDelete')}`;
const copy = value => JSON.parse(JSON.stringify(value));

function source(overrides = {}) {
  return { serverId: 'local:test/library', library: 'users/0', itemKey: 'BOOK0001', attachmentKey: 'PDF00001', itemVersion: 1, itemType: 'book', title: 'Fixture book', collections: [], annotations: [
    { key: 'NOTE0001', attachmentKey: 'PDF00001', text: 'Original passage', comment: 'A Zotero comment', page: 4, pageLabel: 'iii', at: '2026-01-01T00:00:00Z' },
    { key: 'NOTE0002', attachmentKey: 'PDF00002', text: 'Another attachment', comment: '', page: 8, pageLabel: 'vii', at: '2026-01-01T00:00:00Z' },
  ], ...overrides };
}
function book(overrides = {}) {
  return { id: 'book-1', title: 'Fixture book', format: 'pdf', storedFile: 'fixture.pdf', originalName: 'fixture.pdf', progress: {}, zotero: source(), ...overrides };
}
function notebook(books) {
  return { notes: [{ id: 'root', title: 'Root question' }], cards: [], readingNotes: [], crossThoughts: [], thoughtReplies: [], manuscripts: [], libraryBooks: books, libraryHighlights: [], ocrCache: [], bookThoughts: [], links: [], dismissedSuggestions: [] };
}

async function harness(t, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wenjian-zotero-api-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const libraryDir = path.join(directory, 'library');
  await fsp.mkdir(libraryDir);
  let store = { version: 7, data: notebook(options.books || [book()]) };
  const opened = [], fileOperations = [], writes = [], catalogs = [], probes = [];
  let cancelledProbeBodies = 0;
  const context = vm.createContext({
    localPort: 45555, restoringBackup: false, zoteroCatalogJob: null, libraryDir,
    path, crypto, URLSearchParams, AbortSignal, console: { error() {} },
    fetch: async (url, config) => {
      probes.push({ url, ...config });
      if (options.probeError) throw options.probeError;
      const status = options.probeStatus || 200;
      return { status, ok: status >= 200 && status < 300, headers: new Headers({ 'Zotero-Server-ID': options.probeServerId ?? 'local:test/library' }), body: { cancel: async () => { cancelledProbeBodies++; } } };
    },
    fsp: {
      lstat: fsp.lstat,
      rename: async (...args) => { fileOperations.push(['rename', ...args]); return fsp.rename(...args); },
      unlink: async (...args) => { fileOperations.push(['unlink', ...args]); return fsp.unlink(...args); },
    },
    readStore: async () => copy(store),
    writeStore: async next => { if (options.writeError) throw options.writeError; store = copy(next); writes.push(copy(next)); },
    requestBody: async request => { if (options.bodyError) throw options.bodyError; return request.body; },
    jsonReply: (response, status, body) => { response.status = status; response.body = copy(body); },
    shell: { openExternal: async target => { opened.push(target); if (options.openError) throw options.openError; } },
    readZoteroCatalog: async args => { catalogs.push(args); return options.catalog ? options.catalog(args) : { items: [], collections: [], serverId: 'local:test/library' }; },
  });
  vm.runInContext(handlers, context, { filename: sourcePath });
  const headers = { host: '127.0.0.1:45555', origin: 'http://127.0.0.1:45555', 'sec-fetch-site': 'same-origin' };
  return {
    directory, libraryDir, context, opened, fileOperations, writes, catalogs, probes,
    get cancelledProbeBodies() { return cancelledProbeBodies; },
    get store() { return store; },
    set store(value) { store = copy(value); },
    async request(pathname, body, overrides = {}) {
      const response = {};
      const request = { method: pathname.endsWith('/catalog') ? 'GET' : 'POST', body, ...overrides, headers: { ...headers, ...overrides.headers } };
      await context.handleZotero(request, response, pathname);
      return response;
    },
    async remove(target = store.data.libraryBooks[0], overrides = {}) {
      const response = {};
      await context.handleLibraryDelete({ method: 'DELETE', body: { id: target.id, title: target.title, version: store.version, confirmed: true, confirmation: '删除', ...overrides } }, response);
      return response;
    },
  };
}

test('Zotero handlers reject foreign origins, hosts and cross-site requests before accessing the library', async t => {
  const h = await harness(t);
  for (const headers of [{ origin: 'https://other.example' }, { host: 'other.example:45555' }, { host: '127.0.0.1:45556' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }]) {
    assert.equal((await h.request('/api/zotero/open', { bookId: 'book-1' }, { headers })).status, 403);
    assert.equal((await h.request('/api/zotero/catalog', undefined, { headers })).status, 403);
  }
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.catalogs, []);
  assert.deepEqual(h.probes, []);
});

test('opens only stored Zotero sources and ignores arbitrary request URLs and attachment keys', async t => {
  const h = await harness(t);
  const result = await h.request('/api/zotero/open', { bookId: 'book-1', url: 'https://other.example', attachmentKey: 'ATTACK01', page: 100, itemKey: 'ATTACK02' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { opened: true });
  assert.deepEqual(h.opened, ['zotero://open/library/items/PDF00001']);
  assert.equal(h.probes[0].url, 'http://127.0.0.1:23119/api/users/0/items/BOOK0001?format=json');
  assert.equal(h.probes[0].redirect, 'manual');
  assert.equal(h.probes[0].headers['Zotero-Server-ID'], 'local:test/library');
  assert.equal(h.cancelledProbeBodies, 1);
  assert.equal((await h.request('/api/zotero/open', { url: 'file:///tmp/anything' })).status, 404);
  assert.equal(h.opened.length, 1);
});

test('annotation navigation uses its stored attachment and physical page, including secondary attachments', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/api/zotero/open', { bookId: 'book-1', annotationKey: 'NOTE0002' })).status, 200);
  assert.deepEqual(h.opened, ['zotero://open/library/items/PDF00002?page=8&annotation=NOTE0002']);
  assert.equal((await h.request('/api/zotero/open', { bookId: 'book-1', annotationKey: 'UNKNOWN1' })).status, 404);
  assert.equal((await h.request('/api/zotero/open', { bookId: 'book-1', annotationKey: '../../bad' })).status, 404);
  assert.equal(h.opened.length, 1);
});

test('attachmentless references open their source item, while invalid stored identities cannot launch a URL', async t => {
  const h = await harness(t, { books: [
    book({ id: 'reference', format: 'reference', storedFile: '', originalName: '', zotero: source({ attachmentKey: undefined }) }),
    book({ id: 'local-only', zotero: undefined }),
    book({ id: 'bad-library', zotero: source({ library: 'groups/1' }) }),
    book({ id: 'bad-key', zotero: source({ itemKey: '../../anything' }) }),
  ] });
  assert.equal((await h.request('/api/zotero/open', { bookId: 'reference' })).status, 200);
  assert.deepEqual(h.opened, ['zotero://select/library/items/BOOK0001']);
  for (const bookId of ['local-only', 'bad-library', 'bad-key', 'missing']) assert.equal((await h.request('/api/zotero/open', { bookId })).status, 404);
  assert.equal(h.opened.length, 1);
});

test('catalog requests share an in-flight read and retain existing-book context', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = await harness(t, { catalog: async () => { await gate; return { serverId: 'fixture', items: [{ title: 'New source' }] }; } });
  const first = h.request('/api/zotero/catalog');
  const second = h.request('/api/zotero/catalog');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.catalogs.length, 1);
  assert.equal(h.catalogs[0].libraryDir, h.libraryDir);
  assert.equal(h.catalogs[0].existingBooks[0].id, 'book-1');
  release();
  const results = await Promise.all([first, second]);
  assert.ok(results.every(result => result.status === 200));
  assert.deepEqual(results[0].body, results[1].body);
  await h.request('/api/zotero/catalog');
  assert.equal(h.catalogs.length, 2);
});

test('source-library identity is checked before opening and offline or unavailable sources do not launch', async t => {
  for (const [options, expectedStatus] of [
    [{ probeStatus: 412 }, 409],
    [{ probeServerId: 'another-database' }, 409],
    [{ probeServerId: '' }, 409],
    [{ probeStatus: 404 }, 404],
    [{ probeStatus: 302 }, 404],
    [{ probeError: new Error('Connection refused') }, 503],
  ]) {
    const h = await harness(t, options);
    assert.equal((await h.request('/api/zotero/open', { bookId: 'book-1' })).status, expectedStatus);
    assert.deepEqual(h.opened, []);
    assert.equal(h.probes.length, 1);
    assert.equal(h.probes[0].redirect, 'manual');
    assert.equal(h.cancelledProbeBodies, options.probeError ? 0 : 1);
  }
});

test('API failures return a retryable error and failed catalog jobs are cleared', async t => {
  let attempt = 0;
  const h = await harness(t, { catalog: async () => { if (++attempt === 1) throw Object.assign(new Error('Zotero is closed'), { code: 'UNAVAILABLE' }); return { items: [] }; } });
  const unavailable = await h.request('/api/zotero/catalog');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'UNAVAILABLE');
  assert.equal((await h.request('/api/zotero/catalog')).status, 200);
  const broken = await harness(t, { openError: new Error('Cannot launch application') });
  const failedOpen = await broken.request('/api/zotero/open', { bookId: 'book-1' });
  assert.equal(failedOpen.status, 502);
  assert.equal(failedOpen.body.code, 'CONNECTION_ERROR');
  assert.equal(failedOpen.body.error, 'Cannot launch application');
  assert.equal((await h.request('/api/zotero/catalog', undefined, { method: 'PUT' })).status, 405);
  h.context.restoringBackup = true;
  assert.equal((await h.request('/api/zotero/catalog')).status, 423);
});

test('removing a reference never renames its library directory and records a durable Zotero dismissal', async t => {
  const reference = book({ format: 'reference', storedFile: '', originalName: '' });
  const h = await harness(t, { books: [reference] });
  const note = { id: 'thought', libraryBookId: reference.id, sourceLocation: 'zotero:NOTE0001', text: 'My thought', questionIds: ['q1'] };
  h.store = { ...h.store, data: { ...h.store.data, bookThoughts: [note], readingNotes: [{ id: 'reading', libraryBookId: reference.id, quote: 'Original', interpretation: 'My interpretation', sourceLocation: 'zotero:NOTE0001' }] } };
  const result = await h.remove();
  assert.equal(result.status, 200);
  assert.equal(h.store.version, 8);
  assert.equal(h.store.data.libraryBooks.length, 0);
  assert.deepEqual(h.fileOperations, []);
  assert.ok((await fsp.stat(h.libraryDir)).isDirectory());
  assert.deepEqual(h.store.data.dismissedSuggestions, ['zotero:local%3Atest%2Flibrary:BOOK0001']);
  assert.equal(h.store.data.bookThoughts[0].text, note.text);
  assert.equal(h.store.data.bookThoughts[0].libraryBookId, undefined);
  assert.equal(h.store.data.readingNotes[0].interpretation, 'My interpretation');
});

test('removing one attachment owner keeps a shared original readable and preserves the other book', async t => {
  const original = book();
  const retained = book({ id: 'book-2', title: 'Another source', zotero: source({ itemKey: 'BOOK0002' }) });
  const h = await harness(t, { books: [original, retained] });
  const bytes = Buffer.from('%PDF-1.7\nShared immutable original');
  await fsp.writeFile(path.join(h.libraryDir, original.storedFile), bytes);
  h.store = { ...h.store, data: { ...h.store.data, bookThoughts: [{ id: 'thought', libraryBookId: original.id, text: 'Keep this thought' }], libraryHighlights: [{ id: 'mine', libraryBookId: original.id }, { id: 'theirs', libraryBookId: retained.id }] } };
  assert.equal((await h.remove(original)).status, 200);
  assert.deepEqual(await fsp.readFile(path.join(h.libraryDir, original.storedFile)), bytes);
  assert.deepEqual(h.fileOperations, []);
  assert.equal(h.store.data.libraryBooks[0].id, retained.id);
  assert.equal(h.store.data.bookThoughts[0].libraryBookId, retained.id);
  assert.deepEqual(h.store.data.libraryHighlights, [{ id: 'theirs', libraryBookId: retained.id }]);
});

test('deleting an attachmentless reference never moves its thoughts to an unrelated reference', async t => {
  const h = await harness(t, { books: [
    book({ id: 'reference-a', title: 'First reference', format: 'reference', storedFile: '', originalName: '' }),
    book({ id: 'reference-b', title: 'Unrelated reference', format: 'reference', storedFile: '', originalName: '', zotero: source({ itemKey: 'BOOK0002' }) }),
  ] });
  h.store = { ...h.store, data: { ...h.store.data, bookThoughts: [{ id: 'thought', libraryBookId: 'reference-a', text: 'A thought about the first reference' }] } };
  assert.equal((await h.remove()).status, 200);
  assert.equal(h.store.data.bookThoughts[0].libraryBookId, undefined);
  assert.equal(h.store.data.bookThoughts[0].text, 'A thought about the first reference');
  assert.equal(h.store.data.libraryBooks[0].id, 'reference-b');
});

test('failed notebook save restores the staged original and leaves source and dismissal unchanged', async t => {
  const h = await harness(t, { writeError: new Error('Simulated disk full') });
  const original = path.join(h.libraryDir, 'fixture.pdf');
  await fsp.writeFile(original, '%PDF-1.7\nKeep on failed deletion');
  const before = copy(h.store);
  assert.equal((await h.remove()).status, 500);
  assert.equal(await fsp.readFile(original, 'utf8'), '%PDF-1.7\nKeep on failed deletion');
  assert.deepEqual(await fsp.readdir(h.libraryDir), ['fixture.pdf']);
  assert.deepEqual(h.store, before);
  assert.deepEqual(h.writes, []);
});

test('stale or unconfirmed deletes do not touch originals or suppress future source imports', async t => {
  const h = await harness(t);
  assert.equal((await h.remove(undefined, { version: 6 })).status, 409);
  assert.equal((await h.remove(undefined, { confirmed: false })).status, 400);
  assert.equal((await h.remove(undefined, { confirmation: 'wrong' })).status, 400);
  assert.deepEqual(h.fileOperations, []);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.store.data.dismissedSuggestions, []);
});

test('malformed file records cannot rename directories or symbolic links', async t => {
  for (const storedFile of ['.', '..', '../book.pdf', 'folder', 'folder.pdf', 'alias.pdf']) {
    const h = await harness(t, { books: [book({storedFile})] });
    if(storedFile === 'folder.pdf') await fsp.mkdir(path.join(h.libraryDir,storedFile));
    if(storedFile === 'alias.pdf') await fsp.symlink(h.libraryDir,path.join(h.libraryDir,storedFile));
    assert.equal((await h.remove()).status,400,storedFile);
    assert.deepEqual(h.fileOperations,[]);
    assert.deepEqual(h.writes,[]);
    assert.ok((await fsp.stat(h.libraryDir)).isDirectory());
  }
});

test('new or explicitly disconnected notebooks never read Zotero until enabled', async t => {
  const h = await harness(t);
  for (const flags of [{ setupCompleted: false, zoteroEnabled: false }, { setupCompleted: true, zoteroEnabled: false }]) {
    h.store = { ...h.store, data: { ...h.store.data, ...flags } };
    const result = await h.request('/api/zotero/catalog');
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'NOT_ENABLED');
    assert.equal(h.catalogs.length, 0);
  }
  h.store = { ...h.store, data: { ...h.store.data, setupCompleted: true, zoteroEnabled: true } };
  assert.equal((await h.request('/api/zotero/catalog')).status, 200);
  assert.equal(h.catalogs.length, 1);
});
