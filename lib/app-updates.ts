export const RELEASES_API='https://api.github.com/repos/largetomatoes/mac-/releases?per_page=30';
export const RELEASES_PAGE='https://github.com/largetomatoes/mac-/releases';
export const PREVIEW_VERSION='3.14';
export type AppInfo={version:string;build:string;platform:'android'|'darwin'|'win32';arch:string};
export type Release={tag_name:string;html_url:string;body?:string;published_at?:string;draft?:boolean;prerelease?:boolean;assets?:{name:string;browser_download_url:string;state?:string}[]};
export type UpdateResult={state:'available'|'current'|'ahead'|'missing'|'empty';version?:string;build?:number;release?:Release;download?:string};
export const PI_RELEASE_DIGITS='14159265358979323846264338327950288419716939937510';
export function versionParts(value:string){
 const text=value.trim().replace(/^v/,'');
 const pi=/^3[.]([0-9]+)$/.exec(text);
 if(pi&&PI_RELEASE_DIGITS.startsWith(pi[1]))return [3,1000000+pi[1].length,0];
 const display=/^(0|[1-9]\d*)[.](\d{2})$/.exec(text);if(display)return [Number(display[1]),Number(display[2]),0];
 const match=/^(0|[1-9]\d*)[.](0|[1-9]\d*)[.](0|[1-9]\d*)$/.exec(text);return match?match.slice(1).map(Number):null;
}
export function nextPiVersion(value:string){const digits=value.replace(/^v?3[.]/,'');if(!PI_RELEASE_DIGITS.startsWith(digits)||digits.length>=PI_RELEASE_DIGITS.length)throw Error('当前版本不属于圆周率发布序列');return '3.'+PI_RELEASE_DIGITS.slice(0,digits.length+1);}
export function compareVersions(a:string,b:string){const aa=versionParts(a),bb=versionParts(b);if(!aa||!bb)throw Error('版本信息格式不正确');for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;return 0;}
export function validReleaseUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.pathname==='/largetomatoes/mac-/releases'||url.pathname.startsWith('/largetomatoes/mac-/releases/tag/')||url.pathname.startsWith('/largetomatoes/mac-/releases/download/'))&&!url.pathname.includes('%2f');}catch{return false;}}
export function selectUpdate(releases:Release[],info:AppInfo):UpdateResult {
 if(!Array.isArray(releases)||!versionParts(info.version))throw Error('更新信息格式不正确');
 const formal=releases.filter(release=>!release.draft&&!release.prerelease&&versionParts(release.tag_name)&&validReleaseUrl(release.html_url)).sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
 const latest=formal[0];if(!latest)return {state:'empty'};
 const version=latest.tag_name.replace(/^v/,''),build=releaseBuild(latest),baseComparison=compareVersions(version,info.version),comparison=baseComparison|| (build?Math.sign(build-(Number(info.build)||0)):0);
 const suffix=info.platform==='android'?'Android.apk':info.platform==='darwin'?`macOS-${info.arch}.zip`:`Windows-${info.arch}.zip`;
 const name=build?`Wenjian-${version}-build${build}-${suffix}`:`Wenjian-${version}-${suffix}`;
 const asset=latest.assets?.find(item=>item.name===name&&item.state==='uploaded'&&validReleaseUrl(item.browser_download_url)&&new URL(item.browser_download_url).pathname.startsWith('/largetomatoes/mac-/releases/download/'+encodeURIComponent(latest.tag_name)+'/'));
 return {state:comparison<0?'ahead':comparison===0?'current':asset?'available':'missing',version,build:build||undefined,release:latest,download:asset?.browser_download_url};
}
// Discovery metadata is public; the native updater separately verifies the
// signed manifest, build number, package identity and file hash before install.
export function releaseBuild(release:Release){const value=/<!--\s*wenjian-build:(\d+)\s*-->/.exec(release.body||'')?.[1],build=Number(value);return Number.isSafeInteger(build)&&build>0?build:0;}
