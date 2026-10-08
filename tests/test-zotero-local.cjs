/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createZoteroClient } = require('../work/mac-app/asar-src/zotero-local');

function row(key, data, version = 1) { return { key, version, data: { key, ...data } }; }
function attachment(key, parentItem, filename = 'book.pdf') { return row(key, { itemType: 'attachment', parentItem, filename, title: filename, contentType: filename.endsWith('.epub') ? 'application/epub+zip' : 'application/pdf' }); }
function annotation(key, parentItem, text = 'A quotation', extra = {}) { return row(key, { itemType: 'annotation', parentItem, annotationType: 'highlight', annotationText: text, annotationComment: '<p>A comment</p>', annotationPageLabel: 'iii', annotationPosition: '{"pageIndex":2,"rects":[[1,2,3,4]]}', annotationSortIndex: '00003|00001|00000', dateAdded: '2026-01-01T00:00:00Z', dateModified: '2026-01-02T00:00:00Z', ...extra }, 3); }

async function fixture(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'wenjian-zotero-test-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const libraryDir = path.join(directory, 'wenjian-library');
  const pdf = path.join(directory, 'source.pdf');
  const epub = path.join(directory, 'source.epub');
  await fsp.mkdir(libraryDir);
  await fsp.writeFile(pdf, '%PDF-1.7\nsource fixture');
  await fsp.writeFile(epub, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('EPUB fixture')]));
  return { directory, libraryDir, pdf, epub };
}

function mock({ items = [], collections = [], files = {}, serverId = 'local-test-server', intercept } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, 'http://127.0.0.1:23119');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    const response = intercept?.(url, options, calls.length);
    if (response) return response;
    const parsed = new URL(url);
    const headers = { 'Zotero-Server-ID': serverId };
    if (parsed.pathname.endsWith('/items') || parsed.pathname.endsWith('/collections')) {
      const source = parsed.pathname.endsWith('/items') ? items : collections;
      const start = Number(parsed.searchParams.get('start') || 0), limit = Number(parsed.searchParams.get('limit') || 100);
      headers['Total-Results'] = String(source.length);
      return new Response(JSON.stringify(source.slice(start, start + limit)), { headers });
    }
    const key = parsed.pathname.match(/\/items\/([^/]+)\/file\/view\/url$/)?.[1];
    return key && files[key] ? new Response(typeof files[key] === 'string' ? files[key] : pathToFileURL(files[key].path).href, { headers }) : new Response('Missing file', { headers, status: 404 });
  };
  return { fetchImpl, calls };
}

test('combines parent documents, independent attachments, collections and annotations without duplicate books', async t => {
  const f = await fixture(t);
  const source = mock({ items: [
    row('BOOK', { itemType: 'book', title: 'A book', creators: [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }], collections: ['C1'], ISBN: '123', publisher: 'Press' }),
    attachment('PDF1', 'BOOK'), attachment('EPUB1', 'BOOK', 'book.epub'), annotation('NOTE1', 'PDF1'), annotation('NOTE2', 'EPUB1'),
    attachment('STANDALONE'), annotation('NOTE3', 'STANDALONE'), row('REFERENCE', { itemType: 'journalArticle', title: 'A reference', DOI: '10/example' }),
    row('NOTEONLY', { itemType: 'note', note: 'Separate Zotero note' }),
  ], collections: [row('C1', { name: 'Research', parentCollection: false })], files: { PDF1: { path: f.pdf }, EPUB1: { path: f.epub }, STANDALONE: { path: f.pdf } } });
  const result = await createZoteroClient(source).readCatalog(f);
  assert.equal(result.serverId, 'local-test-server');
  assert.equal(result.library, 'users/0');
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.collections, [{ key: 'C1', name: 'Research' }]);
  const book = result.items.find(item => item.itemKey === 'BOOK');
  assert.equal(book.author, 'Ada Lovelace');
  assert.equal(book.attachmentKey, 'PDF1');
  assert.equal(book.format, 'pdf');
  assert.equal(book.itemVersion, 3);
  assert.equal(book.annotations.length, 2);
  assert.equal(book.annotations.find(note => note.attachmentKey === 'PDF1').page, 3);
  assert.equal(book.annotations.find(note => note.attachmentKey === 'EPUB1').page, undefined);
  assert.equal(book.annotations[0].comment, 'A comment');
  assert.equal(result.items.find(item => item.itemKey === 'REFERENCE').format, 'reference');
  assert.equal(result.items.find(item => item.itemKey === 'STANDALONE').storedFile, book.storedFile);
  assert.equal((await fsp.readdir(f.libraryDir)).length, 1);
  assert.ok(source.calls.slice(1).every(call => call.options.headers['Zotero-Server-ID'] === result.serverId));
});

test('repeated updates reuse copies without rewriting while new annotation text is returned', async t => {
  const f = await fixture(t);
  const items = [attachment('PDF1'), annotation('NOTE1', 'PDF1')];
  const client = createZoteroClient(mock({ items, files: { PDF1: { path: f.pdf } } }));
  const first = await client.readCatalog(f);
  const name = first.items[0].storedFile;
  const before = await fsp.stat(path.join(f.libraryDir, name));
  items[1].data.annotationComment = '<p>Changed comment</p>';
  items[1].version = 7;
  const second = await client.readCatalog({ ...f, existingBooks: [{ storedFile: name, zotero: { serverId: first.serverId, itemKey: 'PDF1', attachmentKey: 'PDF1' } }] });
  const after = await fsp.stat(path.join(f.libraryDir, name));
  assert.equal(second.items[0].storedFile, name);
  assert.equal(second.items[0].itemVersion, 7);
  assert.equal(second.items[0].annotations[0].comment, 'Changed comment');
  assert.equal(before.ino, after.ino);
  assert.equal(before.mtimeMs, after.mtimeMs);
});

test('deduplicates existing local books by actual file bytes and ignores unsafe stored filenames', async t => {
  const f = await fixture(t);
  await fsp.copyFile(f.pdf, path.join(f.libraryDir, 'already-imported.pdf'));
  const result = await createZoteroClient(mock({ items: [attachment('PDF1')], files: { PDF1: { path: f.pdf } } })).readCatalog({ ...f, existingBooks: [{ storedFile: '../source.pdf' }, { storedFile: 'already-imported.pdf' }] });
  assert.equal(result.items[0].storedFile, 'already-imported.pdf');
  assert.deepEqual(await fsp.readdir(f.libraryDir), ['already-imported.pdf']);
});

test('retains unavailable references and annotations, then copies a newly available original', async t => {
  const f = await fixture(t);
  const files = {};
  const client = createZoteroClient(mock({ items: [attachment('PDF1'), annotation('NOTE1', 'PDF1')], files }));
  const first = await client.readCatalog(f);
  assert.equal(first.items[0].format, 'reference');
  assert.equal(first.items[0].storedFile, '');
  assert.equal(first.items[0].attachmentKey, 'PDF1');
  assert.equal(first.items[0].annotations.length, 1);
  assert.equal(first.items[0].sourceAvailable, true);
  assert.equal(first.warnings.length, 1);
  files.PDF1 = { path: f.pdf };
  assert.equal((await client.readCatalog(f)).items[0].format, 'pdf');
});

test('keeps missing local paths as references without remote fetching', async t => {
  const f = await fixture(t);
  const source = mock({ items: [attachment('MISSING'), attachment('REMOTE')], files: { MISSING: { path: path.join(f.directory, 'gone.pdf') }, REMOTE: 'https://example.com/book.pdf' } });
  const result = await createZoteroClient(source).readCatalog(f);
  assert.ok(result.items.every(item => item.format === 'reference'));
  assert.ok(source.calls.every(call => call.url.startsWith('http://127.0.0.1:23119/')));
  assert.deepEqual(await fsp.readdir(f.libraryDir), []);
});

test('reads all pages and pins the server identity across items, collections and attachments', async t => {
  const f = await fixture(t);
  const source = mock({ items: ['A', 'B', 'C'].map(key => row(key, { itemType: 'book', title: key })), collections: [row('C1', { name: 'One' }), row('C2', { name: 'Two' })] });
  const result = await createZoteroClient({ ...source, pageSize: 1 }).readCatalog(f);
  assert.equal(result.items.length, 3);
  assert.equal(result.collections.length, 2);
  assert.equal(source.calls.length, 5);
  assert.ok(source.calls.slice(1).every(call => call.options.headers['Zotero-Server-ID'] === 'local-test-server'));
});

test('does not follow pagination links to non-local addresses', async t => {
  const f = await fixture(t);
  const source = mock({ items: [row('A', { itemType: 'book' }), row('B', { itemType: 'book' })], intercept: (url, options, call) => call === 1 ? new Response(JSON.stringify([row('A', { itemType: 'book' })]), { headers: { 'Zotero-Server-ID': 'local-test-server', Link: '<https://evil.example/steal>; rel="next"' } }) : null });
  assert.equal((await createZoteroClient({ ...source, pageSize: 1 }).readCatalog(f)).items.length, 2);
  assert.ok(source.calls.every(call => new URL(call.url).origin === 'http://127.0.0.1:23119'));
});

test('rejects a database switch during catalog retrieval and an unexpected initial database', async t => {
  const f = await fixture(t);
  const source = mock({ intercept: (url, options, call) => call === 2 ? new Response('[]', { headers: { 'Zotero-Server-ID': 'changed-server' } }) : null });
  await assert.rejects(createZoteroClient(source).readCatalog(f), { code: 'SERVER_CHANGED' });
  await assert.rejects(createZoteroClient(mock()).readCatalog({ ...f, expectedServerId: 'different-server' }), { code: 'SERVER_CHANGED' });
});

test('reports permission, timeout, missing identity and redirect errors without external requests', async t => {
  const f = await fixture(t);
  for (const [status, expected] of [[403, 'PERMISSION'], [302, 'REDIRECT'], [412, 'SERVER_CHANGED']]) {
    const source = mock({ intercept: () => new Response('', { status, headers: { Location: 'https://example.com/' } }) });
    await assert.rejects(createZoteroClient(source).readCatalog(f), { code: expected });
    assert.equal(source.calls.length, 1);
  }
  await assert.rejects(createZoteroClient({ fetchImpl: async () => new Response('[]') }).readCatalog(f), { code: 'MISSING_SERVER_ID' });
  await assert.rejects(createZoteroClient({ fetchImpl: () => new Promise(() => {}), timeoutMs: 15 }).readCatalog(f), { code: 'TIMEOUT' });
});

test('caller cancellation aborts the in-flight local request', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const client = createZoteroClient({ fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  const pending = client.readCatalog({ ...f, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
});

test('preserves the existing primary attachment and retains secondary attachment annotation locations', async t => {
  const f = await fixture(t);
  const source = mock({ items: [row('BOOK', { itemType: 'book' }), attachment('PDF1', 'BOOK'), attachment('EPUB1', 'BOOK', 'book.epub'), annotation('N1', 'PDF1'), annotation('N2', 'EPUB1')], files: { PDF1: { path: f.pdf }, EPUB1: { path: f.epub } } });
  const result = await createZoteroClient(source).readCatalog({ ...f, existingBooks: [{ zotero: { serverId: 'local-test-server', itemKey: 'BOOK', attachmentKey: 'EPUB1' } }] });
  assert.equal(result.items[0].attachmentKey, 'EPUB1');
  assert.equal(result.items[0].format, 'epub');
  assert.equal(result.items[0].annotations.length, 2);
  assert.equal(result.items[0].annotations.find(note => note.key === 'N1').attachmentKey, 'PDF1');
});

test('orders annotations, retains textual provenance and removes active markup', async t => {
  const f = await fixture(t);
  const source = mock({ items: [attachment('PDF1'), annotation('LATER', 'PDF1', 'Later', { annotationSortIndex: '00010|00001', annotationPosition: '{"pageIndex":9}' }), annotation('FIRST', 'PDF1', 'x < 3 & y <tag> &lt;', { annotationSortIndex: '00001|00001', annotationPosition: '{"pageIndex":0}', annotationComment: '<p>My <em>thought</em></p><script>bad()</script><p>&#x4e2d;&#25991;</p>' })] });
  const result = await createZoteroClient(source).readCatalog(f);
  assert.deepEqual(result.items[0].annotations.map(note => note.key), ['FIRST', 'LATER']);
  assert.equal(result.items[0].annotations[0].text, 'x < 3 & y <tag> &lt;');
  assert.equal(result.items[0].annotations[0].comment, 'My thought\n中文');
  assert.equal(result.items[0].annotations[0].page, 1);
});

test('does not overwrite an unexpected file occupying the deterministic destination', async t => {
  const f = await fixture(t);
  const hash = crypto.createHash('sha256').update(await fsp.readFile(f.pdf)).digest('hex');
  const destination = path.join(f.libraryDir, `zotero-${hash}.pdf`);
  await fsp.writeFile(destination, '%PDF-other preserved');
  const client = createZoteroClient(mock({ items: [attachment('PDF1')], files: { PDF1: { path: f.pdf } } }));
  await assert.rejects(client.readCatalog(f), { code: 'FILE_COLLISION' });
  assert.equal(await fsp.readFile(destination, 'utf8'), '%PDF-other preserved');
});

test('source content changes create a new immutable copy and preserve the prior original', async t => {
  const f = await fixture(t);
  const client = createZoteroClient(mock({ items: [attachment('PDF1')], files: { PDF1: { path: f.pdf } } }));
  const first = await client.readCatalog(f);
  await fsp.writeFile(f.pdf, '%PDF-1.7\nchanged fixture');
  const second = await client.readCatalog(f);
  assert.notEqual(first.items[0].storedFile, second.items[0].storedFile);
  assert.equal(await fsp.readFile(path.join(f.libraryDir, first.items[0].storedFile), 'utf8'), '%PDF-1.7\nsource fixture');
  assert.equal((await fsp.readdir(f.libraryDir)).length, 2);
});
