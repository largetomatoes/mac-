import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/app-updates.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL});
const {compareVersions,selectUpdate,versionParts}=module.exports;
assert.equal(compareVersions('3.00','2.4.2'),1);
assert.equal(compareVersions('v3.00','3.0.0'),0);
assert.equal(versionParts('1.02.3'),null,'invalid canonical SemVer remains rejected');
const root='https://github.com/largetomatoes/mac-/releases';
for(const [platform,arch,suffix] of [['android','universal','Android.apk'],['darwin','arm64','macOS-arm64.zip'],['win32','x64','Windows-x64.zip']]){
 const asset=`Wenjian-3.00-${suffix}`,url=`${root}/download/v3.00/${asset}`;
 const release={tag_name:'v3.00',html_url:root+'/tag/v3.00',assets:[{name:asset,browser_download_url:url,state:'uploaded'}]};
 assert.equal(selectUpdate([release],{version:'2.4.2',platform,arch}).download,url);
 assert.equal(selectUpdate([release],{version:'3.00',platform,arch}).state,'current');
 assert.equal(selectUpdate([{...release,assets:[]}],{version:'2.4.2',platform,arch}).state,'missing');
}
console.log('PASS: 3.00 and canonical version comparison, all three platform asset links and missing-package handling');

assert.equal(compareVersions('3.1','3.01'),1);
const sequence=['3.1','3.14','3.141','3.1415','3.14159','3.141592','3.1415926'];
for(let i=1;i<sequence.length;i++){assert.equal(compareVersions(sequence[i],sequence[i-1]),1);assert.equal(module.exports.nextPiVersion(sequence[i-1]),sequence[i]);}
assert.equal(versionParts('3.142'),null);
console.log('PASS: pi-prefix release progression and legacy 3.01 ordering');

for(const [platform,arch,suffix] of [['android','universal','Android.apk'],['darwin','arm64','macOS-arm64.zip'],['win32','x64','Windows-x64.zip']]){
 const asset=`Wenjian-3.14-build319-${suffix}`,url=`${root}/download/v3.14/${asset}`;
 const release={tag_name:'v3.14',html_url:root+'/tag/v3.14',body:'<!-- wenjian-build:319 -->',assets:[{name:asset,browser_download_url:url,state:'uploaded'}]};
 assert.equal(selectUpdate([release],{version:'3.14',build:'317',platform,arch}).state,'available');
 assert.equal(selectUpdate([release],{version:'3.14',build:'317',platform,arch}).download,url);
 assert.equal(selectUpdate([release],{version:'3.14',build:'319',platform,arch}).state,'current');
 assert.equal(selectUpdate([release],{version:'3.14',build:'320',platform,arch}).state,'ahead');
 assert.equal(selectUpdate([{...release,assets:[]}],{version:'3.14',build:'317',platform,arch}).state,'missing');
}
console.log('PASS: same-version build upgrades for Mac, Windows and Android; current/ahead builds and missing artifacts handled');

assert.equal(module.exports.RELEASES_API,'https://api.github.com/repos/largetomatoes/wenjian-software/releases?per_page=30');
assert.equal(module.exports.RELEASES_PAGE,'https://github.com/largetomatoes/wenjian-software/releases');
for(const repo of ['wenjian-software','mac-']){
 const base=`https://github.com/largetomatoes/${repo}/releases`;
 assert(module.exports.validReleaseUrl(base));
 for(const [platform,arch,suffix]of [['darwin','arm64','macOS-arm64.zip'],['win32','x64','Windows-x64.zip'],['android','universal','Android.apk']]){
  const name=`Wenjian-3.14-build320-${suffix}`,url=base+'/download/v3.14/'+name;
  const release={tag_name:'v3.14',html_url:base+'/tag/v3.14',body:'<!-- wenjian-build:320 -->',assets:[{name,browser_download_url:url,state:'uploaded'}]};
  assert.equal(selectUpdate([release],{version:'3.14',build:'319',platform,arch}).download,url);
  assert.equal(selectUpdate([release],{version:'3.14',build:'320',platform,arch}).state,'current');
 }
}
for(const bad of ['https://github.com/largetomatoes/wenjian-software-other/releases','https://github.com/other/wenjian-software/releases','http://github.com/largetomatoes/wenjian-software/releases','https://user:secret@github.com/largetomatoes/wenjian-software/releases','https://github.com:444/largetomatoes/wenjian-software/releases','https://github.com/largetomatoes/wenjian-software/releases/download/v3.14/a%2Fb.zip','https://github.com/largetomatoes/wenjian-software/releases?url=evil'])assert.equal(module.exports.validReleaseUrl(bad),false,bad);
console.log('PASS: renamed and historical repository releases accepted on three platforms, lookalike sources rejected');
