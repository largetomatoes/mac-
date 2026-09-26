import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(appRoot, '../..');
const spaRoot = path.join(appRoot, 'local-spa');
const spaDist = path.join(spaRoot, 'dist');
const stage = path.join(appRoot, 'mac-stage');
const resourceStage = path.join(appRoot, 'mac-resources');
const releaseRoot = path.join(appRoot, 'release');
const prepareOnly = process.argv.includes('--prepare-only');

async function requireFile(filePath) {
  if (!(await stat(filePath).catch(() => null))?.isFile()) throw new Error(`缺少构建文件：${filePath}`);
}

function plistValue(contents, name) {
  const match = new RegExp(`<key>${name}</key>\\s*<string>([^<]+)</string>`).exec(contents);
  if (!match) throw new Error(`Info.plist 缺少 ${name}。`);
  return match[1];
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
  for (const name of ['seed.json', 'AppIcon.icns', 'native-Info.plist']) await requireFile(path.join(appRoot, name));
  for (const name of ['main.js', 'pdf-export.js', 'complete-backup.js', 'oss-cloud.js', 'library-location.js', 'package.json']) {
    await requireFile(path.join(appRoot, 'asar-src', name));
  }

  await rm(stage, { recursive: true, force: true });
  await rm(resourceStage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await mkdir(resourceStage, { recursive: true });
  await cp(path.join(appRoot, 'asar-src'), stage, { recursive: true });
  await cp(spaDist, path.join(resourceStage, 'static'), { recursive: true });
  const dependencies = ['pdf-lib', 'pako', 'tslib', '@pdf-lib/standard-fonts', '@pdf-lib/upng'];
  for (const dependency of dependencies) {
    await cp(path.join(appRoot, 'node_modules', dependency), path.join(stage, 'node_modules', dependency), { recursive: true });
  }

  const manifestPath = path.join(stage, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.description = '问间本地笔记应用';
  manifest.productName = '问间';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const plist = await readFile(path.join(appRoot, 'native-Info.plist'), 'utf8');
  const plistVersion = plistValue(plist, 'CFBundleShortVersionString');
  if (manifest.version !== plistVersion) throw new Error(`应用版本不一致：${manifest.version} / ${plistVersion}`);
  return {
    version: manifest.version,
    buildVersion: plistValue(plist, 'CFBundleVersion'),
    appBundleId: plistValue(plist, 'CFBundleIdentifier'),
  };
}

const { version, buildVersion, appBundleId } = await prepare();
if (prepareOnly) {
  console.log(`Mac arm64 打包文件已准备：${stage}（${version} build ${buildVersion}）`);
} else {
  if (process.platform !== 'darwin') throw new Error('Mac 应用打包需要在 macOS 上运行。');
  const electronManifest = JSON.parse(await readFile(path.join(appRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
  const paths = await packager({
    dir: stage,
    out: path.join(releaseRoot, 'mac'),
    name: '问间',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion: electronManifest.version,
    appVersion: version,
    buildVersion,
    appBundleId,
    asar: true,
    prune: false,
    overwrite: true,
    icon: path.join(appRoot, 'AppIcon.icns'),
    extraResource: [path.join(resourceStage, 'static'), path.join(appRoot, 'seed.json')],
  });
  if (paths.length !== 1) throw new Error('Mac 打包没有生成唯一的应用目录。');
  const application = path.join(paths[0], '问间.app');
  for (const name of ['Contents/Info.plist', 'Contents/Resources/app.asar', 'Contents/Resources/static/index.html', 'Contents/Resources/seed.json']) {
    await requireFile(path.join(application, name));
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', application], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
  const archive = path.join(releaseRoot, `Wenjian-${version}-macOS-arm64.zip`);
  await rm(archive, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', application, archive], { stdio: 'inherit' });
  await requireFile(archive);
  console.log(`问间 Mac arm64 ${version} build ${buildVersion} 已打包：${archive}`);
}
