const contentArrays=['cards','readingNotes','crossThoughts','thoughtReplies','manuscripts','libraryBooks','libraryFolders','zoteroCollections','libraryHighlights','ocrCache','bookThoughts','links','dismissedSuggestions'];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function validSettings(data){
 if(!data||!Array.isArray(data.notes))return false;
 if(['setupCompleted','zoteroEnabled'].some(k=>data[k]!==undefined&&typeof data[k]!=='boolean'))return false;
 const roots=data.notes.filter(n=>!n.parent);
 if(roots.length!==1||roots[0].kind!=='question'||typeof roots[0].title!=='string'||!roots[0].title.trim()||roots[0].title.length>300)return false;
 if(data.setupCompleted===false&&(data.notes.length!==1||roots[0].body||roots[0].revisions?.length||roots[0].thoughts?.length||data.zoteroEnabled!==false||contentArrays.some(k=>data[k]?.length)))return false;
 return true;
}
function validateCoreTransition(previous,next){
 if(!validSettings(next))return '核心问题或初始化状态无效。';
 if(previous.setupCompleted!==false&&next.setupCompleted===false)return '已有资料不能重置为首次使用状态。';
 const from=previous.notes.find(n=>!n.parent),to=next.notes.find(n=>!n.parent);
 if(!from||!to||from.id!==to.id)return '核心问题的标识需要保留。';
 const wasPending=previous.setupCompleted===false;
 const changed=from.title!==to.title;
 if(wasPending){
  if(next.setupCompleted===false)return same(previous,next)?'':'请先填写核心问题。';
  if(next.setupCompleted!==true||to.revisions?.length||!same({...from,title:to.title},to)||contentArrays.some(k=>!same(previous[k]||[],next[k]||[]))||next.zoteroEnabled!==false)return '首次设置只保存你的核心问题。';
  return '';
 }
 if(!changed){if(!same(from.revisions||[],to.revisions||[]))return '已有核心问题修改记录需要保留。';return '';}
 const history=from.revisions||[],revisions=to.revisions||[],revision=revisions.at(-1);
 if(!same({...from,title:to.title,revisions:to.revisions,thoughts:to.thoughts},to)||!same(from.thoughts||[],(to.thoughts||[]).slice(0,(from.thoughts||[]).length))||revisions.length!==history.length+1||!same(history,revisions.slice(0,-1))||!revision||revision.title!==from.title||revision.nextTitle!==to.title||revision.body!==from.body||revision.origin!==from.origin||revision.source!==from.source||typeof revision.reason!=='string'||revision.reason.length>10000||typeof revision.at!=='string'||!Number.isFinite(Date.parse(revision.at)))return '修改核心问题时需要保留原文和完整修改记录。';
 return '';
}
function validateReadingTransition(previous,next){
 const targets=new Set([...next.notes.filter(n=>n.kind==='question').map(n=>n.id),...next.crossThoughts.map(n=>n.id)]);
 for(const note of next.readingNotes)if(!Array.isArray(note.questionIds)||note.questionIds.length>100||new Set(note.questionIds).size!==note.questionIds.length||note.questionIds.some(id=>!targets.has(id)))return '请选择有效的问题。';
 for(const old of previous.readingNotes){const note=next.readingNotes.find(n=>n.id===old.id);if(!note||!same({...old,questionIds:[],thoughts:[]},{...note,questionIds:[],thoughts:[]})||!same(old.thoughts||[],(note.thoughts||[]).slice(0,(old.thoughts||[]).length)))return '过程笔记的原文、来源和已有理解需要保留，请追加新的思考。';}
 return '';
}
module.exports={validSettings,validateCoreTransition,validateReadingTransition};
