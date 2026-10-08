/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportCompleteBackup, inspectCompleteBackup, restoreCompleteBackup } = require('../work/mac-app/asar-src/complete-backup');

function notebook(storedFile = 'book.pdf') {
  return {
    version: 8,
    data: {
      notes: [{ id: 'root', title: '核心问题', kind: 'question' }], cards: [], readingNotes: [], crossThoughts: [],
      thoughtReplies: [], manuscripts: [], libraryBooks: [{ id: 'book', storedFile, format: 'pdf', title: '书', inReadingLibrary: true, zotero: { serverId: 'local', library: 'users/0', itemKey: 'BOOK001', itemVersion: 1, itemType: 'book', title: '书', annotations: [], collections: ['CHILD001'] } }],
      zoteroCollections: [{ serverId: 'local', key: 'ROOT0001', name: '哲学' }, { serverId: 'local', key: 'CHILD001', parentKey: 'ROOT0001', name: '语言' }],
      libraryHighlights: [], ocrCache: [], bookThoughts: [], links: [], dismissedSuggestions: []
    }
  };
}
const valid = (value) => Number.isInteger(value?.version) && Array.isArray(value?.data?.notes) && Array.isArray(value?.data?.libraryBooks);

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wenjian-backup-test-'));
  const libraryDir = path.join(root, 'library');
  await fs.mkdir(libraryDir);
  const notebookPath = path.join(root, 'notebook.json');
  const draftsPath = path.join(root, 'drafts.json');
  const archivePath = path.join(root, 'complete.wenjian-backup');
  await fs.writeFile(notebookPath, JSON.stringify(notebook()));
  await fs.writeFile(draftsPath, JSON.stringify({ reader: { thought: '未完成的想法' } }));
  await fs.writeFile(path.join(libraryDir, 'book.pdf'), 'original book bytes');
  return { root, libraryDir, notebookPath, draftsPath, archivePath };
}

test('complete backup includes and verifies notebook, drafts, and book files', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const summary = await exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid });
  assert.equal(summary.books, 1);
  const parsed = await inspectCompleteBackup(fixture.archivePath, valid);
  assert.equal(parsed.notebook.data.notes[0].title, '核心问题');
  assert.equal(parsed.drafts.reader.thought, '未完成的想法');
  assert.deepEqual(parsed.notebook.data.zoteroCollections, notebook().data.zoteroCollections);
  assert.equal(parsed.notebook.data.libraryBooks[0].inReadingLibrary, true);
  assert.equal(parsed.entries[0].storedFile, 'book.pdf');
  const bytes = await fs.readFile(fixture.archivePath);
  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(fixture.archivePath, bytes);
  await assert.rejects(inspectCompleteBackup(fixture.archivePath, valid), /校验失败/);
});

test('restore keeps existing book bytes and remaps the restored book on collision', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid });
  await fs.writeFile(path.join(fixture.libraryDir, 'book.pdf'), 'newer local copy');
  await fs.writeFile(fixture.notebookPath, JSON.stringify({ ...notebook(), version: 9 }));
  await fs.writeFile(fixture.draftsPath, JSON.stringify({ reader: { thought: 'newer draft' } }));
  await restoreCompleteBackup({
    ...fixture,
    validateNotebook: valid,
    writeNotebook: (value) => fs.writeFile(fixture.notebookPath, JSON.stringify(value)),
    writeDrafts: (value) => fs.writeFile(fixture.draftsPath, JSON.stringify(value))
  });
  const restored = JSON.parse(await fs.readFile(fixture.notebookPath, 'utf8'));
  const storedFile = restored.data.libraryBooks[0].storedFile;
  assert.deepEqual(restored.data.zoteroCollections, notebook().data.zoteroCollections);
  assert.equal(restored.data.libraryBooks[0].inReadingLibrary, true);
  assert.deepEqual(restored.data.libraryBooks[0].zotero, notebook().data.libraryBooks[0].zotero);
  assert.notEqual(storedFile, 'book.pdf');
  assert.equal(await fs.readFile(path.join(fixture.libraryDir, 'book.pdf'), 'utf8'), 'newer local copy');
  assert.equal(await fs.readFile(path.join(fixture.libraryDir, storedFile), 'utf8'), 'original book bytes');
  assert.equal(JSON.parse(await fs.readFile(fixture.draftsPath, 'utf8')).reader.thought, '未完成的想法');
});

test('export fails without a referenced original book and does not leave a partial backup', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.unlink(path.join(fixture.libraryDir, 'book.pdf'));
  await assert.rejects(exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid }), /ENOENT/);
  await assert.rejects(fs.access(fixture.archivePath), /ENOENT/);
});

test('failed restore keeps old notebook, book, and draft contents', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid });
  await fs.writeFile(path.join(fixture.libraryDir, 'book.pdf'), 'newer local copy');
  await fs.writeFile(fixture.notebookPath, JSON.stringify({ ...notebook(), version: 9 }));
  await fs.writeFile(fixture.draftsPath, JSON.stringify({ reader: { thought: 'newer draft' } }));
  await assert.rejects(restoreCompleteBackup({
    ...fixture,
    validateNotebook: valid,
    writeNotebook: async () => { throw new Error('simulated save failure'); },
    writeDrafts: (value) => fs.writeFile(fixture.draftsPath, JSON.stringify(value))
  }), /simulated save failure/);
  assert.equal(JSON.parse(await fs.readFile(fixture.notebookPath, 'utf8')).version, 9);
  assert.equal(await fs.readFile(path.join(fixture.libraryDir, 'book.pdf'), 'utf8'), 'newer local copy');
  assert.deepEqual(await fs.readdir(fixture.libraryDir), ['book.pdf']);
  assert.equal(JSON.parse(await fs.readFile(fixture.draftsPath, 'utf8')).reader.thought, 'newer draft');
});

test('restoring a backup with no drafts clears newer unsaved text', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.unlink(fixture.draftsPath);
  await exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid });
  await fs.writeFile(fixture.draftsPath, JSON.stringify({ home: { capture: 'belongs to newer data' } }));
  await restoreCompleteBackup({
    ...fixture,
    validateNotebook: valid,
    writeNotebook: (value) => fs.writeFile(fixture.notebookPath, JSON.stringify(value)),
    writeDrafts: (value) => fs.writeFile(fixture.draftsPath, JSON.stringify(value))
  });
  assert.deepEqual(JSON.parse(await fs.readFile(fixture.draftsPath, 'utf8')), {});
});

for (const withCollisions of [false, true]) {
  test(`complete backup roundtrip preserves classified PDF/EPUB books and their notes${withCollisions ? ' with filename collisions' : ''}`, async (t) => {
    const fixture = await setup();
    t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
    const at = '2026-09-28T08:00:00.000Z';
    const original = notebook();
    original.data.libraryFolders = [
      { id: 'philosophy', name: '哲学与语言' },
      { id: 'history', name: '社会思想史' },
      { id: 'empty', name: '待研究' }
    ];
    original.data.libraryBooks = [
      {
        id: 'pdf-book', title: '哲学研究', author: '维特根斯坦', format: 'pdf',
        storedFile: 'book.pdf', originalName: '哲学研究（扫描版）.pdf', addedAt: at,
        folderId: 'philosophy', progress: { page: 42, totalPages: 300, rotation: 90 },
        pdfChapters: [{ id: 'chapter-1', title: '语言游戏', startPage: 37 }]
      },
      {
        id: 'epub-book', title: '现代资本主义', author: '桑巴特', format: 'epub',
        storedFile: 'history.epub', originalName: '现代资本主义.epub', addedAt: at,
        folderId: 'history', progress: { cfi: 'epubcfi(/6/8!/4/2/1:16)', percentage: 0.42 }
      }
    ];
    original.data.readingNotes = original.data.libraryBooks.map((book) => ({
      id: `reading-${book.id}`, libraryBookId: book.id, questionIds: ['root'],
      book: book.title, author: book.author, chapter: book.format === 'pdf' ? '语言游戏' : '第二章',
      locator: book.format === 'pdf' ? '第 42 页' : '第二章',
      sourceLocation: book.format === 'pdf' ? '42' : book.progress.cfi,
      quote: '保留所选原文。', interpretation: '我对原文的独立理解。', at,
      thoughts: [{ id: `later-${book.id}`, text: '之后补充的思考。', origin: '自己', reason: '', at }]
    }));
    original.data.bookThoughts = original.data.libraryBooks.map((book) => ({
      id: `annotation-${book.id}`, libraryBookId: book.id, bookTitle: book.title,
      text: '选中文字旁边的过程注解。', scope: 'location', quote: '保留所选原文。',
      locator: book.format === 'pdf' ? '第 42 页' : '第二章',
      sourceLocation: book.format === 'pdf' ? '42' : book.progress.cfi,
      questionIds: ['root'], at, thoughts: []
    }));
    original.data.libraryHighlights = original.data.bookThoughts.map((annotation) => ({
      id: `highlight-${annotation.libraryBookId}`, libraryBookId: annotation.libraryBookId,
      quote: annotation.quote, locator: annotation.locator, sourceLocation: annotation.sourceLocation, at
    }));
    original.data.ocrCache = [{
      libraryBookId: 'pdf-book', page: 42, text: '扫描页的原文', at,
      lines: [{ text: '扫描页的原文', x0: 12, y0: 24, x1: 320, y1: 48 }]
    }];
    const zotero = {
      serverId: 'local-library-1', library: 'users/0', itemKey: 'ITEM0001', itemVersion: 12,
      itemType: 'book', title: '哲学研究', attachmentKey: 'ATT00001', collections: ['COLL0001'],
      annotations: [{ key: 'ANN00001', type: 'highlight', text: '源端摘录原话。', comment: 'Zotero 原批注。', pageLabel: '42', page: 42, position: '{"pageIndex":41}', at, modifiedAt: at, color: '#ffd400', attachmentKey: 'ATT00001' }],
      sourceAvailable: true
    };
    original.data.libraryBooks[0].zotero = zotero;
    original.data.libraryBooks.push({
      id: 'reference-only', title: '只有文献与摘录', author: '作者', format: 'reference',
      storedFile: '', originalName: '只有文献与摘录', addedAt: at, progress: {}, folderId: 'philosophy',
      zotero: { ...zotero, itemKey: 'ITEM0002', title: '只有文献与摘录' }
    });
    const drafts = {
      'reader-pdf-book': { interpretation: '尚未提交的读书思考', chapter: '语言游戏' },
      'reader-epub-book': { text: '尚未提交的过程注解', sourceLocation: 'epubcfi(/6/8!/4/2/1:16)' },
      manuscript: { body: '未完成文稿，与书籍草稿一同保留。' }
    };
    // Include NUL, non-UTF-8 bytes, and more than one stream chunk so a text-only
    // copy or truncated book cannot accidentally satisfy the roundtrip test.
    const binary = Buffer.from(Array.from({ length: 150000 }, (_, index) => index % 256));
    const bookBytes = new Map([
      ['book.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), binary, Buffer.from('\n%%EOF')])],
      ['history.epub', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), binary, Buffer.from('application/epub+zip')])]
    ]);
    await fs.writeFile(fixture.notebookPath, JSON.stringify(original));
    await fs.writeFile(fixture.draftsPath, JSON.stringify(drafts));
    for (const [name, bytes] of bookBytes) await fs.writeFile(path.join(fixture.libraryDir, name), bytes);

    const summary = await exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid });
    assert.equal(summary.books, 2);
    const inspected = await inspectCompleteBackup(fixture.archivePath, valid);
    assert.deepEqual(inspected.notebook, original);
    assert.deepEqual(inspected.drafts, drafts);
    const archiveBytes = await fs.readFile(fixture.archivePath);
    for (const entry of inspected.entries) {
      assert.deepEqual(archiveBytes.subarray(entry.offset, entry.offset + entry.size), bookBytes.get(entry.storedFile));
    }

    const destination = path.join(fixture.root, 'restored');
    const libraryDir = path.join(destination, 'library');
    await fs.mkdir(libraryDir, { recursive: true });
    const notebookPath = path.join(destination, 'notebook.json');
    const draftsPath = path.join(destination, 'drafts.json');
    const existingBytes = Buffer.from('An unrelated existing local book must remain unchanged.');
    if (withCollisions) {
      for (const name of bookBytes.keys()) await fs.writeFile(path.join(libraryDir, name), existingBytes);
    }
    const result = await restoreCompleteBackup({
      archivePath: fixture.archivePath, notebookPath, libraryDir, draftsPath, validateNotebook: valid,
      writeNotebook: (value) => fs.writeFile(notebookPath, JSON.stringify(value)),
      writeDrafts: (value) => fs.writeFile(draftsPath, JSON.stringify(value))
    });
    assert.equal(result.books, 2);
    const restored = JSON.parse(await fs.readFile(notebookPath, 'utf8'));
    assert.deepEqual(restored.data.libraryFolders, original.data.libraryFolders);
    for (const restoredBook of restored.data.libraryBooks) {
      const originalBook = original.data.libraryBooks.find((book) => book.id === restoredBook.id);
      if (originalBook.format === 'reference') {
        assert.deepEqual(restoredBook, originalBook, 'bibliography-only records keep their empty filename and all source annotations');
        continue;
      }
      assert.deepEqual(await fs.readFile(path.join(libraryDir, restoredBook.storedFile)), bookBytes.get(originalBook.storedFile));
      assert.equal(restoredBook.folderId, originalBook.folderId);
      if (withCollisions) {
        assert.notEqual(restoredBook.storedFile, originalBook.storedFile);
        assert.deepEqual(await fs.readFile(path.join(libraryDir, originalBook.storedFile)), existingBytes);
      } else {
        assert.equal(restoredBook.storedFile, originalBook.storedFile);
      }
      // Only the on-disk filename may change. IDs, folder membership, source
      // anchors, chapters, progress, and all note references must remain intact.
      restoredBook.storedFile = originalBook.storedFile;
    }
    assert.deepEqual(restored, original);
    assert.deepEqual(JSON.parse(await fs.readFile(draftsPath, 'utf8')), drafts);
  });
}

test('bibliography-only backup restores without requiring an original file', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const original = notebook('');
  original.data.libraryBooks[0].format = 'reference';
  await fs.writeFile(fixture.notebookPath, JSON.stringify(original));
  const summary = await exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid });
  assert.equal(summary.books, 0);
  await restoreCompleteBackup({ ...fixture, validateNotebook: valid, writeNotebook: (value) => fs.writeFile(fixture.notebookPath, JSON.stringify(value)) });
  assert.deepEqual(JSON.parse(await fs.readFile(fixture.notebookPath, 'utf8')), original);
});

test('only an explicit reference with an empty storedFile skips original validation', async (t) => {
  const fixture = await setup();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  for (const book of [
    { format: 'pdf', storedFile: '' },
    { format: 'epub', storedFile: '' },
    { format: 'reference' },
    { format: 'reference', storedFile: '../outside.pdf' },
    { format: 'reference', storedFile: 'missing.pdf' }
  ]) {
    const original = notebook();
    original.data.libraryBooks = [{ id: 'book', title: '书', ...book }];
    await fs.writeFile(fixture.notebookPath, JSON.stringify(original));
    await assert.rejects(exportCompleteBackup({ ...fixture, destination: fixture.archivePath, validateNotebook: valid }), /文件名不正确|ENOENT/);
  }
  await assert.rejects(fs.access(fixture.archivePath), /ENOENT/);
});
