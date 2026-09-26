/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function safeStoredFile(name) {
  return typeof name === 'string' && name.length > 0 && !name.startsWith('.') &&
    !/[\x00-\x1f<>:"/\\|?*]/.test(name) && /\.(pdf|epub)$/i.test(name);
}

async function regularFileOrNull(filePath) {
  try {
    const stat = await fsp.lstat(filePath);
    if (!stat.isFile()) throw new Error(`书籍文件不是普通文件：${filePath}`);
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareLocalLibrary({ storageDir, userDataDir, books, storageMode }) {
  if (!userDataDir || !path.isAbsolute(userDataDir)) throw new Error('本地资料目录不正确。');
  const localLibraryDir = path.join(userDataDir, 'library');
  if (storageMode === 'local') {
    await fsp.mkdir(localLibraryDir, { recursive: true });
    return localLibraryDir;
  }
  if (storageMode !== 'nutstore' || !storageDir || !path.isAbsolute(storageDir)) throw new Error('旧书库目录配置不正确。');
  if (!Array.isArray(books)) throw new Error('书籍记录格式不正确。');
  const names = [];
  const seen = new Set();
  for (const book of books) {
    const name = book?.storedFile;
    if (!safeStoredFile(name)) throw new Error(`书籍文件名不正确：${String(name)}`);
    if (!seen.has(name)) { seen.add(name); names.push(name); }
  }
  const legacyLibraryDir = path.join(storageDir, 'library');
  const sourceDirectory = await fsp.stat(legacyLibraryDir).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  await fsp.mkdir(localLibraryDir, { recursive: true });
  if (!sourceDirectory?.isDirectory()) {
    for (const name of names) {
      if (!await regularFileOrNull(path.join(localLibraryDir, name))) {
        throw new Error('原来的坚果云书库目录不可用，且本地尚缺少书籍。请恢复目录后再启动问间。');
      }
    }
    return localLibraryDir;
  }

  for (const name of names) {
    const source = path.join(legacyLibraryDir, name);
    const destination = path.join(localLibraryDir, name);
    const sourceStat = await regularFileOrNull(source);
    const destinationStat = await regularFileOrNull(destination);
    if (!sourceStat) {
      if (!destinationStat) throw new Error(`找不到书籍原文件：${name}。请检查原来的坚果云书库。`);
      continue;
    }
    const sourceHash = await sha256(source);
    if (destinationStat) {
      if (sourceStat.size !== destinationStat.size || sourceHash !== await sha256(destination)) {
        throw new Error(`本地书籍与原书库内容不同：${name}。已保留两个文件，请先检查。`);
      }
      continue;
    }

    const temporary = path.join(localLibraryDir, `.${name}.partial-${crypto.randomUUID()}`);
    try {
      await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
      const copied = await regularFileOrNull(temporary);
      if (copied.size !== sourceStat.size || await sha256(temporary) !== sourceHash || await sha256(source) !== sourceHash) {
        throw new Error(`复制书籍时原文件发生变化：${name}。请重试。`);
      }
      // A hard link publishes the verified copy atomically and never replaces an existing book.
      try { await fsp.link(temporary, destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await regularFileOrNull(destination);
        if (!existing || existing.size !== copied.size || await sha256(destination) !== sourceHash) {
          throw new Error(`本地书籍与原书库内容不同：${name}。已保留两个文件，请先检查。`);
        }
      }
    } finally {
      await fsp.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return localLibraryDir;
}

module.exports = { prepareLocalLibrary };
