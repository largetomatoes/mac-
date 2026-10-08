import base from '../work/mac-app/local-spa/vite.config.mjs';
import path from 'node:path';
import {cp,mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const root=path.resolve('mobile');
export default {...base,root,
 resolve:{...base.resolve,alias:[{find:/^pdfjs-dist$/,replacement:path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs')},...Object.entries(base.resolve.alias).map(([find,replacement])=>({find,replacement}))]},
 plugins:[...base.plugins,{name:'mobile-reader-assets',async buildStart(){
  const publicDir=path.join(root,'public');await mkdir(publicDir,{recursive:true});
  await cp(path.resolve('work/mac-app/local-spa/public/reader'),path.join(publicDir,'reader'),{recursive:true});
  await cp(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),path.join(publicDir,'reader/pdf/pdf.worker.min.mjs'));
  for(const language of ['chi_sim','eng']){const compressed=path.join(publicDir,'reader/ocr',language+'.traineddata.gz');await writeFile(compressed.slice(0,-3),gunzipSync(await readFile(compressed)));await unlink(compressed);}
  await cp(path.join(root,'static/unsupported-webview.html'),path.join(publicDir,'unsupported-webview.html'));
 }}],build:{...base.build,target:'chrome111',outDir:path.join(root,'dist')}};
