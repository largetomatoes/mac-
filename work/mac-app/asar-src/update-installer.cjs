const fs=require('node:fs/promises'),path=require('node:path'),cp=require('node:child_process');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const config=path.resolve(process.argv[2]),spec=JSON.parse(await fs.readFile(config,'utf8'));
 if(spec.platform!=='darwin'||path.dirname(config)!==spec.directory||path.extname(spec.target)!=='.app'||path.dirname(spec.zip)!==spec.directory||!Number.isInteger(spec.pid))throw Error('Invalid installer specification');
 const backup=spec.target+'.wenjian-previous-'+spec.nonce,stage=path.join(spec.directory,'stage-'+spec.nonce);let moved=false,newPid=null;
 const finish=async(state,error)=>{await fs.writeFile(path.join(spec.directory,'status.json'),JSON.stringify({state,error,version:spec.version}));};
 try{
  for(let i=0;i<300;i++){let alive=true;try{process.kill(spec.pid,0);}catch{alive=false;}if(!alive)break;if(i===299)throw Error('Application is still running');await wait(200);}
  await fs.mkdir(stage,{recursive:true});cp.execFileSync('/usr/bin/ditto',['-x','-k',spec.zip,stage]);
  const source=path.join(stage,'问间.app'),info=JSON.parse(cp.execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path.join(source,'Contents/Info.plist')],{encoding:'utf8'}));
  if(info.CFBundleIdentifier!==spec.bundleId||Number(info.CFBundleVersion)!==spec.build)throw Error('Application identity or build mismatch');
  cp.execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',source]);
  await fs.rename(spec.target,backup);moved=true;await fs.rename(source,spec.target);
  const executable=path.join(spec.target,'Contents/MacOS',info.CFBundleExecutable),child=cp.spawn(executable,[],{detached:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});child.unref();newPid=child.pid;
  let confirmed=false;for(let i=0;i<300;i++){try{const result=JSON.parse(await fs.readFile(spec.confirmation,'utf8'));if(result.nonce===spec.nonce&&result.build===spec.build){confirmed=true;break;}}catch{}await wait(200);}
  if(!confirmed)throw Error('New application did not confirm a valid startup');
  await fs.rm(backup,{recursive:true,force:true});await fs.rm(stage,{recursive:true,force:true});await finish('succeeded');
 }catch(error){
  if(moved){if(newPid)try{process.kill(newPid,'SIGTERM');}catch{}await wait(500);await fs.rm(spec.target,{recursive:true,force:true});await fs.rename(backup,spec.target);cp.spawn('/usr/bin/open',['-a',spec.target],{detached:true,stdio:'ignore'}).unref();}
  await finish(moved?'rolledBack':'failed',error.message);
 }
})().catch(()=>{});
