// Deploy the independent Web host (static PWA + restricted same-origin WebDAV relay)
// to the user's own Cloudflare Workers account. Requires an authenticated
// `wrangler login` and a registered workers.dev subdomain on the account.
//
// Usage:
//   npm run deploy:web-app
//   WENJIAN_WORKER_NAME=reader npm run deploy:web-app
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const workerName=process.env.WENJIAN_WORKER_NAME||'reader';
if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName)){
  throw new Error('Invalid WENJIAN_WORKER_NAME: use 2-63 lowercase letters, digits or hyphens.');
}
function run(args,cwd=root){
  const result=spawnSync(process.execPath,args,{cwd,stdio:'inherit',env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error('Command failed ('+result.status+'): '+args.join(' '));
}

run(['scripts/build-web-host.mjs']);
const cfgPath=path.join(root,'webapp/host-dist/server/wrangler.json');
const cfg=JSON.parse(await readFile(cfgPath,'utf8'));
// The generated config keeps the old managed-site placeholder name; give this
// Worker a stable identity under the user's own account before deploying.
cfg.name=workerName;
await writeFile(cfgPath,JSON.stringify(cfg,null,2)+'\n');

const wrangler=path.join(root,'node_modules/wrangler/bin/wrangler.js');
run([wrangler,'deploy'],path.join(root,'webapp/host-dist/server'));
