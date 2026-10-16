import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(path.join(root,'asar-src/package.json'),'utf8'));
const appRoot=path.resolve(process.argv[2]||path.join(root,'release/windows',`Wenjian-${pkg.releaseVersion}-win64`));
const output=path.join(root,'release',`Wenjian-${pkg.releaseVersion}-build${pkg.buildVersion}-Windows-x64-Setup.exe`);
execFileSync(process.env.MAKENSIS||'makensis',['-V3',`-DAPP_DIR=${appRoot}`,`-DOUT_FILE=${output}`,`-DAPP_VERSION=${pkg.releaseVersion}`,`-DAPP_BUILD=${pkg.buildVersion}`,path.join(root,'scripts/windows-installer.nsi')],{stdio:'inherit'});
console.log('Windows 安装程序：'+output);
