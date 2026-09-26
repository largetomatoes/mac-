import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const macAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(macAppRoot, '../..');
const spaRoot = path.join(macAppRoot, 'local-spa');
const spaDist = path.join(spaRoot, 'dist');
const stage = path.join(macAppRoot, 'windows-stage');
const resourceStage = path.join(macAppRoot, 'windows-resources');
const outputRoot = path.join(macAppRoot, 'release', 'windows');
const prepareOnly = process.argv.includes('--prepare-only');

async function requireFile(filePath) {
  if (!(await stat(filePath).catch(() => null))?.isFile()) throw new Error(`缺少构建文件：${filePath}`);
}

async function makeWindowsIcon() {
  const sizes = [16, 32, 128, 256];
  const images = await Promise.all(sizes.map(async (size) => {
    const file = path.join(macAppRoot, 'AppIcon.iconset', `icon_${size}x${size}.png`);
    const data = await readFile(file);
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`图标不是 PNG：${file}`);
    }
    return { size, data };
  }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  }
  const icon = path.join(stage, 'AppIcon.ico');
  await writeFile(icon, Buffer.concat([header, ...images.map(image => image.data)]));
  return icon;
}

function buildSpa() {
  const vite = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--config', path.join(spaRoot, 'vite.config.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

async function prepare() {
  buildSpa();
  for (const name of ['index.html', 'reader/pdf/pdf.worker.min.mjs', 'reader/ocr/worker.min.js', 'reader/ocr/chi_sim.traineddata.gz', 'reader/ocr/eng.traineddata.gz']) {
    await requireFile(path.join(spaDist, name));
  }
  await requireFile(path.join(macAppRoot, 'seed.json'));
  for (const name of ['main.js', 'pdf-export.js', 'complete-backup.js', 'oss-cloud.js', 'library-location.js', 'package.json']) {
    await requireFile(path.join(macAppRoot, 'asar-src', name));
  }

  await rm(stage, { recursive: true, force: true });
  await rm(resourceStage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await mkdir(resourceStage, { recursive: true });
  await cp(path.join(macAppRoot, 'asar-src'), stage, { recursive: true });
  await cp(spaDist, path.join(resourceStage, 'static'), { recursive: true });
  const dependencies = ['pdf-lib', 'pako', 'tslib', '@pdf-lib/standard-fonts', '@pdf-lib/upng'];
  for (const dependency of dependencies) {
    await cp(path.join(macAppRoot, 'node_modules', dependency), path.join(stage, 'node_modules', dependency), { recursive: true });
  }
  const manifestPath = path.join(stage, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.description = '问间本地笔记应用';
  manifest.productName = '问间';
  manifest.author = '问间';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const icon = await makeWindowsIcon();
  return { icon, version: manifest.version };
}

const { icon, version } = await prepare();
if (prepareOnly) {
  console.log(`Windows 打包文件已准备：${stage}`);
} else {
  const electronManifest = JSON.parse(await readFile(path.join(macAppRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
  const paths = await packager({
    dir: stage,
    out: outputRoot,
    name: '问间',
    platform: 'win32',
    arch: 'x64',
    electronVersion: electronManifest.version,
    appVersion: version,
    asar: true,
    prune: false,
    overwrite: true,
    icon,
    extraResource: [path.join(resourceStage, 'static'), path.join(macAppRoot, 'seed.json')],
  });
  if (paths.length !== 1) throw new Error('Windows 打包没有生成唯一的应用目录。');
  const appRoot = paths[0];
  for (const name of ['问间.exe', 'resources/app.asar', 'resources/static/index.html', 'resources/seed.json']) {
    await requireFile(path.join(appRoot, name));
  }
  console.log(`问间 Windows x64 ${version} 已打包：${appRoot}`);
}
