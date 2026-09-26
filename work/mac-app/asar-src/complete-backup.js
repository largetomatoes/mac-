const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('WENJIAN_BACKUP_V1\n', 'ascii');
const MAX_MANIFEST_SIZE = 10 * 1024 * 1024;
const MAX_NOTEBOOK_SIZE = 256 * 1024 * 1024;
const MAX_DRAFT_SIZE = 32 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function safeStoredFile(name) {
  return typeof name === 'string' && name.length > 0 && name === path.basename(name) && !name.startsWith('.') && !name.includes('\\') && /\.(pdf|epub)$/i.test(name);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest('hex') };
}

async function writeChunks(handle, sourcePath, offset, expected) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(sourcePath)) {
    hash.update(chunk);
    let written = 0;
    while (written < chunk.length) {
      const result = await handle.write(chunk, written, chunk.length - written, offset + size + written);
      if (!result.bytesWritten) throw new Error('备份文件未能完整写入。');
      written += result.bytesWritten;
    }
    size += chunk.length;
  }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('导出过程中原始资料发生变化，请重试。');
  return offset + size;
}

async function writeBuffer(handle, bytes, offset) {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, offset + written);
    if (!result.bytesWritten) throw new Error('备份文件未能完整写入。');
    written += result.bytesWritten;
  }
  return offset + bytes.length;
}

async function exportCompleteBackup({ notebookPath, libraryDir, draftsPath, destination, validateNotebook }) {
  const notebookBytes = await fsp.readFile(notebookPath);
  if (notebookBytes.length > MAX_NOTEBOOK_SIZE) throw new Error('笔记文件过大，无法生成备份。');
  const notebook = JSON.parse(notebookBytes.toString('utf8'));
  if (!validateNotebook(notebook)) throw new Error('当前笔记数据格式不正确，备份已取消。');
  if (notebook.data.libraryBooks.some((book) => !book || !safeStoredFile(book.storedFile))) throw new Error('有书籍文件名不正确，备份已取消。');
  const names = [...new Set(notebook.data.libraryBooks.map((book) => book.storedFile))];
  const books = [];
  for (const storedFile of names) {
    const source = path.join(libraryDir, storedFile);
    const stat = await fsp.lstat(source);
    if (!stat.isFile()) throw new Error(`书籍文件不可用：${storedFile}`);
    books.push({ storedFile, ...(await hashFile(source)) });
  }
  let draftsBytes = null;
  if (draftsPath) {
    try { draftsBytes = await fsp.readFile(draftsPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (draftsBytes) {
      if (draftsBytes.length > MAX_DRAFT_SIZE) throw new Error('草稿文件过大，无法生成备份。');
      const parsed = JSON.parse(draftsBytes.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('草稿文件格式不正确，无法生成备份。');
    }
  }
  const manifest = {
    format: 'wenjian-complete-backup', version: 1, createdAt: new Date().toISOString(),
    notebook: { size: notebookBytes.length, sha256: crypto.createHash('sha256').update(notebookBytes).digest('hex') },
    books,
    ...(draftsBytes ? { drafts: { size: draftsBytes.length, sha256: crypto.createHash('sha256').update(draftsBytes).digest('hex') } } : {})
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (manifestBytes.length > MAX_MANIFEST_SIZE) throw new Error('书籍清单过大，无法生成备份。');
  const lengthBytes = Buffer.alloc(8);
  lengthBytes.writeBigUInt64BE(BigInt(manifestBytes.length));
  const temporary = `${destination}.partial-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    let offset = await writeBuffer(handle, MAGIC, 0);
    offset = await writeBuffer(handle, lengthBytes, offset);
    offset = await writeBuffer(handle, manifestBytes, offset);
    offset = await writeBuffer(handle, notebookBytes, offset);
    if (draftsBytes) offset = await writeBuffer(handle, draftsBytes, offset);
    for (const book of books) offset = await writeChunks(handle, path.join(libraryDir, book.storedFile), offset, book);
    await handle.sync();
    await handle.close();
    handle = null;
    await inspectCompleteBackup(temporary, validateNotebook);
    await fsp.rename(temporary, destination);
    return { books: books.length, bytes: offset };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readExactly(handle, length, position) {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(bytes, read, length - read, position + read);
    if (!result.bytesRead) throw new Error('备份文件不完整。');
    read += result.bytesRead;
  }
  return bytes;
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'wenjian-complete-backup' || manifest.version !== 1 ||
      !manifest.notebook || !Number.isSafeInteger(manifest.notebook.size) || manifest.notebook.size < 1 || manifest.notebook.size > MAX_NOTEBOOK_SIZE ||
      !HASH_PATTERN.test(manifest.notebook.sha256) || !Array.isArray(manifest.books) || manifest.books.length > 100000) {
    throw new Error('不是有效的问间完整备份。');
  }
  if (manifest.drafts && (!Number.isSafeInteger(manifest.drafts.size) || manifest.drafts.size < 1 || manifest.drafts.size > MAX_DRAFT_SIZE || !HASH_PATTERN.test(manifest.drafts.sha256))) throw new Error('备份中的草稿清单不正确。');
  const names = new Set();
  for (const book of manifest.books) {
    if (!book || !safeStoredFile(book.storedFile) || names.has(book.storedFile) ||
        !Number.isSafeInteger(book.size) || book.size < 1 || !HASH_PATTERN.test(book.sha256)) {
      throw new Error('备份中的书籍清单不正确。');
    }
    names.add(book.storedFile);
  }
  return names;
}

async function hashArchiveRange(archivePath, start, size, outputPath) {
  const hash = crypto.createHash('sha256');
  let copied = 0;
  const output = outputPath ? await fsp.open(outputPath, 'wx', 0o600) : null;
  try {
    if (size > 0) {
      for await (const chunk of fs.createReadStream(archivePath, { start, end: start + size - 1 })) {
        hash.update(chunk);
        if (output) await writeBuffer(output, chunk, copied);
        copied += chunk.length;
      }
    }
    if (output) await output.sync();
  } finally {
    if (output) await output.close();
  }
  return { size: copied, sha256: hash.digest('hex') };
}

async function inspectCompleteBackup(archivePath, validateNotebook) {
  const handle = await fsp.open(archivePath, 'r');
  let manifest;
  let notebook;
  let drafts;
  let entries;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < MAGIC.length + 8 + 1) throw new Error('备份文件不完整。');
    const magic = await readExactly(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error('不是问间完整备份。');
    const length = Number((await readExactly(handle, 8, MAGIC.length)).readBigUInt64BE());
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_MANIFEST_SIZE) throw new Error('备份清单不正确。');
    const manifestBytes = await readExactly(handle, length, MAGIC.length + 8);
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    const names = validateManifest(manifest);
    let offset = MAGIC.length + 8 + length;
    const notebookEnd = offset + manifest.notebook.size;
    if (!Number.isSafeInteger(notebookEnd) || notebookEnd > stat.size) throw new Error('备份文件不完整。');
    const notebookBytes = await readExactly(handle, manifest.notebook.size, offset);
    if (crypto.createHash('sha256').update(notebookBytes).digest('hex') !== manifest.notebook.sha256) throw new Error('备份中的笔记校验失败。');
    notebook = JSON.parse(notebookBytes.toString('utf8'));
    if (!validateNotebook(notebook)) throw new Error('备份中的笔记数据格式不正确。');
    if (notebook.data.libraryBooks.some((book) => !book || !safeStoredFile(book.storedFile))) throw new Error('备份中的书籍记录不正确。');
    const referenced = new Set(notebook.data.libraryBooks.map((book) => book.storedFile));
    if (referenced.size !== names.size || [...referenced].some((name) => !names.has(name))) throw new Error('备份中的书籍与笔记不匹配。');
    offset = notebookEnd;
    if (manifest.drafts) {
      const draftsEnd = offset + manifest.drafts.size;
      if (!Number.isSafeInteger(draftsEnd) || draftsEnd > stat.size) throw new Error('备份文件不完整。');
      const draftsBytes = await readExactly(handle, manifest.drafts.size, offset);
      if (crypto.createHash('sha256').update(draftsBytes).digest('hex') !== manifest.drafts.sha256) throw new Error('备份中的草稿校验失败。');
      drafts = JSON.parse(draftsBytes.toString('utf8'));
      if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) throw new Error('备份中的草稿格式不正确。');
      offset = draftsEnd;
    }
    entries = [];
    for (const book of manifest.books) {
      const end = offset + book.size;
      if (!Number.isSafeInteger(end) || end > stat.size) throw new Error('备份文件不完整。');
      entries.push({ ...book, offset });
      offset = end;
    }
    if (offset !== stat.size) throw new Error('备份文件包含多余内容。');
  } finally {
    await handle.close();
  }
  for (const book of entries) {
    const actual = await hashArchiveRange(archivePath, book.offset, book.size);
    if (actual.size !== book.size || actual.sha256 !== book.sha256) throw new Error(`备份中的书籍校验失败：${book.storedFile}`);
  }
  return { manifest, notebook, drafts, entries };
}

async function restoreCompleteBackup({ archivePath, notebookPath, libraryDir, draftsPath, validateNotebook, writeNotebook, writeDrafts }) {
  // Revalidate after the confirmation dialog in case the source file changed.
  const backup = await inspectCompleteBackup(archivePath, validateNotebook);
  const stage = path.join(libraryDir, `.wenjian-restore-${crypto.randomUUID()}`);
  await fsp.mkdir(stage, { recursive: false });
  const installed = [];
  let committed = false;
  let previousDrafts = null;
  let previousDraftsExisted = false;
  let draftChanged = false;
  try {
    const replacements = new Map();
    for (const book of backup.entries) {
      const staged = path.join(stage, book.storedFile);
      const actual = await hashArchiveRange(archivePath, book.offset, book.size, staged);
      if (actual.size !== book.size || actual.sha256 !== book.sha256) throw new Error(`备份中的书籍校验失败：${book.storedFile}`);
      let targetName = book.storedFile;
      let destination = path.join(libraryDir, targetName);
      try {
        const existingStat = await fsp.lstat(destination);
        if (existingStat.isFile()) {
          const existing = await hashFile(destination);
          if (existing.size === book.size && existing.sha256 === book.sha256) {
            replacements.set(book.storedFile, targetName);
            continue;
          }
        }
        targetName = `${crypto.randomUUID()}${path.extname(book.storedFile).toLowerCase()}`;
        destination = path.join(libraryDir, targetName);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fsp.copyFile(staged, destination, fs.constants.COPYFILE_EXCL);
      installed.push(destination);
      replacements.set(book.storedFile, targetName);
    }
    const restored = {
      ...backup.notebook,
      data: {
        ...backup.notebook.data,
        libraryBooks: backup.notebook.data.libraryBooks.map((book) => ({ ...book, storedFile: replacements.get(book.storedFile) }))
      }
    };
    if (!validateNotebook(restored)) throw new Error('恢复后的笔记数据格式不正确。');
    if (draftsPath && writeDrafts) {
      try { previousDrafts = await fsp.readFile(draftsPath); previousDraftsExisted = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeDrafts(backup.drafts || {});
      draftChanged = true;
    }
    await writeNotebook(restored);
    committed = true;
    return { books: backup.entries.length, notebookPath };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    if (!committed) {
      for (const destination of installed) await fsp.unlink(destination).catch(() => {});
      if (draftChanged) {
        if (previousDraftsExisted) await fsp.writeFile(draftsPath, previousDrafts).catch(() => {});
        else await fsp.unlink(draftsPath).catch(() => {});
      }
    }
  }
}

module.exports = { MAGIC, safeStoredFile, exportCompleteBackup, inspectCompleteBackup, restoreCompleteBackup };
