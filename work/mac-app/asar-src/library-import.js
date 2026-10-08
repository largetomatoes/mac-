const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// Both library entrances refer to the same local book when the original bytes match.
async function importLibraryFile({ source, libraryDir, books = [] }) {
  const format = path.extname(source).toLowerCase().slice(1);
  if (!['pdf', 'epub'].includes(format)) throw new Error('请选择 PDF 或 EPUB 文件。');
  const stat = await fsp.stat(source);
  if (!stat.isFile()) throw new Error('请选择有效的书籍文件。');
  const hash = await hashFile(source);
  for (const book of books) {
    if (book.format !== format || !book.storedFile || path.basename(book.storedFile) !== book.storedFile || /[\\\x00]/.test(book.storedFile)) continue;
    const filename = path.join(libraryDir, book.storedFile);
    const existing = await fsp.lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing?.isFile() && existing.size === stat.size && await hashFile(filename) === hash) return { ...book, inReadingLibrary: true };
  }
  const id = crypto.randomUUID(), storedFile = `${id}.${format}`;
  const destination = path.join(libraryDir, storedFile);
  await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  try {
    if (await hashFile(destination) !== hash) throw new Error('原文件正在修改，请稍后重新导入。');
  } catch (error) { await fsp.unlink(destination).catch(() => {}); throw error; }
  return { id, title: path.basename(source, path.extname(source)), author: '', format, storedFile, originalName: path.basename(source), addedAt: new Date().toISOString(), progress: {}, inReadingLibrary: true };
}

module.exports = { importLibraryFile };
