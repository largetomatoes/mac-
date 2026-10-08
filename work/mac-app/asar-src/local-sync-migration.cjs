const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// Leave the old Nutstore folder intact. Sync journals and device identity must live on this device.
async function isolateLegacyNotebook({localDir,legacyDir,expected,readCurrent,saveConfig}) {
  const directory=path.join(localDir,'local-notebook-'+crypto.randomUUID());
  await fs.mkdir(directory,{recursive:false,mode:0o700});
  const notebook=path.join(directory,'notebook.json');
  await fs.writeFile(notebook,JSON.stringify(expected)+'\n',{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(directory,'.wenjian-storage.json'),JSON.stringify({initializedAt:new Date().toISOString(),migratedFrom:legacyDir})+'\n',{flag:'wx',mode:0o600});
  const copied=JSON.parse(await fs.readFile(notebook,'utf8'));
  if(JSON.stringify(copied)!==JSON.stringify(expected)||JSON.stringify(await readCurrent())!==JSON.stringify(expected))throw new Error('原同步目录在准备期间有新内容，未切换目录，请重试。');
  // Promote only after the copy is verified. A failure leaves both copies recoverable.
  await saveConfig({provider:'local',dataDirectory:directory,previousNutstoreDirectory:legacyDir});
  return directory;
}
module.exports={isolateLegacyNotebook};
