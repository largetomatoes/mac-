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
      thoughtReplies: [], manuscripts: [], libraryBooks: [{ id: 'book', storedFile, format: 'pdf', title: '书' }],
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
