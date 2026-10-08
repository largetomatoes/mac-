/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareLocalLibrary } = require('../work/mac-app/asar-src/library-location');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wenjian-library-location-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const storageDir = path.join(root, 'nutstore');
  const userDataDir = path.join(root, 'app-data');
  await fsp.mkdir(path.join(storageDir, 'library'), { recursive: true });
  await fsp.mkdir(userDataDir);
  const books = [{ id: 'one', storedFile: 'a.pdf' }, { id: 'two', storedFile: 'b.epub' }];
  return { storageDir, userDataDir, books, storageMode: 'nutstore' };
}

test('copies referenced originals into local library while retaining legacy files', async (t) => {
  const options = await fixture(t);
  await fsp.writeFile(path.join(options.storageDir, 'library', 'a.pdf'), 'PDF bytes');
  await fsp.writeFile(path.join(options.storageDir, 'library', 'b.epub'), 'EPUB bytes');
  await fsp.writeFile(path.join(options.storageDir, 'library', 'unreferenced.pdf'), 'leave alone');
  const localLibraryDir = await prepareLocalLibrary(options);
  assert.equal(localLibraryDir, path.join(options.userDataDir, 'library'));
  assert.deepEqual((await fsp.readdir(localLibraryDir)).sort(), ['a.pdf', 'b.epub']);
  assert.equal(await fsp.readFile(path.join(localLibraryDir, 'a.pdf'), 'utf8'), 'PDF bytes');
  assert.equal(await fsp.readFile(path.join(options.storageDir, 'library', 'a.pdf'), 'utf8'), 'PDF bytes');
  assert.equal(await fsp.readFile(path.join(options.storageDir, 'library', 'unreferenced.pdf'), 'utf8'), 'leave alone');
});

test('second startup preserves a matching local original', async (t) => {
  const options = await fixture(t);
  await fsp.writeFile(path.join(options.storageDir, 'library', 'a.pdf'), 'PDF bytes');
  await fsp.writeFile(path.join(options.storageDir, 'library', 'b.epub'), 'EPUB bytes');
  const localLibraryDir = await prepareLocalLibrary(options);
  const before = await fsp.stat(path.join(localLibraryDir, 'a.pdf'));
  assert.equal(await prepareLocalLibrary(options), localLibraryDir);
  const after = await fsp.stat(path.join(localLibraryDir, 'a.pdf'));
  assert.equal(after.ino, before.ino);
  assert.deepEqual((await fsp.readdir(localLibraryDir)).sort(), ['a.pdf', 'b.epub']);
});

test('a fully copied local library remains usable after the legacy book directory is removed', async (t) => {
  const options = await fixture(t);
  await fsp.writeFile(path.join(options.storageDir, 'library', 'a.pdf'), 'PDF bytes');
  await fsp.writeFile(path.join(options.storageDir, 'library', 'b.epub'), 'EPUB bytes');
  const localLibraryDir = await prepareLocalLibrary(options);
  await fsp.rm(path.join(options.storageDir, 'library'), { recursive: true });
  assert.equal(await prepareLocalLibrary(options), localLibraryDir);
  assert.equal(await fsp.readFile(path.join(localLibraryDir, 'a.pdf'), 'utf8'), 'PDF bytes');
});

test('missing original fails clearly when no local copy exists', async (t) => {
  const options = await fixture(t);
  await fsp.writeFile(path.join(options.storageDir, 'library', 'a.pdf'), 'PDF bytes');
  await assert.rejects(prepareLocalLibrary(options), /找不到书籍原文件：b\.epub/);
  assert.equal(await fsp.readFile(path.join(options.storageDir, 'library', 'a.pdf'), 'utf8'), 'PDF bytes');
});

test('different local original fails without replacing either copy', async (t) => {
  const options = await fixture(t);
  const localLibraryDir = path.join(options.userDataDir, 'library');
  await fsp.mkdir(localLibraryDir);
  await fsp.writeFile(path.join(options.storageDir, 'library', 'a.pdf'), 'old PDF bytes');
  await fsp.writeFile(path.join(localLibraryDir, 'a.pdf'), 'new PDF bytes');
  await assert.rejects(prepareLocalLibrary({ ...options, books: [options.books[0]] }), /内容不同：a\.pdf/);
  assert.equal(await fsp.readFile(path.join(localLibraryDir, 'a.pdf'), 'utf8'), 'new PDF bytes');
  assert.equal(await fsp.readFile(path.join(options.storageDir, 'library', 'a.pdf'), 'utf8'), 'old PDF bytes');
});

test('local mode uses the existing local library without copying from legacy storage', async (t) => {
  const options = await fixture(t);
  const localLibraryDir = await prepareLocalLibrary({ ...options, storageMode: 'local' });
  assert.equal(localLibraryDir, path.join(options.userDataDir, 'library'));
  assert.deepEqual(await fsp.readdir(localLibraryDir), []);
});

test('rejects unsafe book filenames before writing any local files', async (t) => {
  const options = await fixture(t);
  await assert.rejects(prepareLocalLibrary({ ...options, books: [{ storedFile: '../escape.pdf' }] }), /文件名不正确/);
  await assert.rejects(fsp.access(path.join(options.userDataDir, 'library')), /ENOENT/);
});

test('migrates actual files in a mixed bibliography and retains reference metadata unchanged', async (t) => {
  const options = await fixture(t);
  const reference = { id: 'reference', format: 'reference', storedFile: '', zotero: { itemKey: 'ITEM0001', annotations: [{ text: '原文', comment: '源批注' }] } };
  options.books.push(reference);
  const before = JSON.stringify(options.books);
  await fsp.writeFile(path.join(options.storageDir, 'library', 'a.pdf'), 'PDF bytes');
  await fsp.writeFile(path.join(options.storageDir, 'library', 'b.epub'), 'EPUB bytes');
  const localLibraryDir = await prepareLocalLibrary(options);
  assert.deepEqual((await fsp.readdir(localLibraryDir)).sort(), ['a.pdf', 'b.epub']);
  assert.equal(JSON.stringify(options.books), before);
});

test('a bibliography-only library needs no legacy originals directory', async (t) => {
  const options = await fixture(t);
  await fsp.rm(path.join(options.storageDir, 'library'), { recursive: true });
  const localLibraryDir = await prepareLocalLibrary({ ...options, books: [{ format: 'reference', storedFile: '' }] });
  assert.deepEqual(await fsp.readdir(localLibraryDir), []);
});

test('empty PDF/EPUB names and malformed reference names are not skipped', async (t) => {
  const options = await fixture(t);
  for (const book of [{ format: 'pdf', storedFile: '' }, { format: 'epub', storedFile: '' }, { format: 'reference' }, { format: 'reference', storedFile: '../escape.pdf' }]) {
    await assert.rejects(prepareLocalLibrary({ ...options, books: [book] }), /文件名不正确/);
  }
  await assert.rejects(prepareLocalLibrary({ ...options, books: [{ format: 'reference', storedFile: 'missing.pdf' }] }), /找不到书籍原文件/);
});
