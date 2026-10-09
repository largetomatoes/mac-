export const RELEASES_API='https://api.github.com/repos/largetomatoes/mac-/releases?per_page=30';
export const RELEASES_PAGE='https://github.com/largetomatoes/mac-/releases';
export const PREVIEW_VERSION='2.2.0';
export type AppInfo={version:string;build:string;platform:'android'|'darwin'|'win32';arch:string};
export type Release={tag_name:string;html_url:string;body?:string;published_at?:string;draft?:boolean;prerelease?:boolean;assets?:{name:string;browser_download_url:string;state?:string}[]};
export type UpdateResult={state:'available'|'current'|'ahead'|'missing'|'empty';version?:string;release?:Release;download?:string};
export function versionParts(value:string){const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());return match?match.slice(1).map(Number):null;}
export function compareVersions(a:string,b:string){const aa=versionParts(a),bb=versionParts(b);if(!aa||!bb)throw Error('版本信息格式不正确');for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;return 0;}
export function validReleaseUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.pathname==='/largetomatoes/mac-/releases'||url.pathname.startsWith('/largetomatoes/mac-/releases/tag/')||url.pathname.startsWith('/largetomatoes/mac-/releases/download/'))&&!url.pathname.includes('%2f');}catch{return false;}}
export function selectUpdate(releases:Release[],info:AppInfo):UpdateResult {
 if(!Array.isArray(releases)||!versionParts(info.version))throw Error('更新信息格式不正确');
 const formal=releases.filter(release=>!release.draft&&!release.prerelease&&versionParts(release.tag_name)&&validReleaseUrl(release.html_url)).sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
 const latest=formal[0];if(!latest)return {state:'empty'};
 const version=latest.tag_name.replace(/^v/,''),comparison=compareVersions(version,info.version);
 const suffix=info.platform==='android'?'Android.apk':info.platform==='darwin'?`macOS-${info.arch}.zip`:`Windows-${info.arch}.zip`;
 const asset=latest.assets?.find(item=>item.name===`Wenjian-${version}-${suffix}`&&item.state==='uploaded'&&validReleaseUrl(item.browser_download_url)&&new URL(item.browser_download_url).pathname.startsWith('/largetomatoes/mac-/releases/download/'+encodeURIComponent(latest.tag_name)+'/'));
 return {state:comparison<0?'ahead':comparison===0?'current':asset?'available':'missing',version,release:latest,download:asset?.browser_download_url};
}
