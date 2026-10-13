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
