// Stage the Web host independently: native app, Android assets and legacy Site identity are untouched.
import {spawnSync} from 'node:child_process';
import {cp,mkdir,readFile,writeFile,rm,readdir,symlink} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),stage=path.join(root,'webapp/.host-workspace');
function run(args,cwd=root){const result=spawnSync(process.execPath,args,{cwd,stdio:'inherit',env:process.env});if(result.error)throw result.error;if(result.status!==0)throw Error('Web build failed ('+result.status+')');}
run(['scripts/build-pwa.mjs']);
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const name of ['build','scripts','vite.config.ts','tsconfig.json'])await cp(path.join(root,name),path.join(stage,name),{recursive:true});
await cp(path.join(root,'webapp/host/app'),path.join(stage,'app'),{recursive:true});
await mkdir(path.join(stage,'.openai'),{recursive:true});
await cp(path.join(root,'webapp/host/hosting.json'),path.join(stage,'.openai/hosting.json'));
await mkdir(path.join(stage,'webapp'),{recursive:true});await cp(path.join(root,'webapp/relay.mjs'),path.join(stage,'webapp/relay.mjs'));
await cp(path.join(root,'webapp/public'),path.join(stage,'public'),{recursive:true});
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));pkg.scripts={build:'node scripts/run-framework.mjs build'};
await writeFile(path.join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
await mkdir(path.join(stage,'node_modules'),{recursive:true});
for(const entry of await readdir(path.join(root,'node_modules'))){if(['.cache','.vite','.vite-temp'].includes(entry))continue;await symlink(path.join(root,'node_modules',entry),path.join(stage,'node_modules',entry));}
run(['scripts/run-framework.mjs','build'],stage);
const output=path.join(root,'webapp/host-dist');await rm(output,{recursive:true,force:true});await cp(path.join(stage,'dist'),output,{recursive:true});
console.log('Independent Web host output: '+output);
