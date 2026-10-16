const {validateOrganization}=require('./page-organization.cjs');
const contentArrays=['cards','readingNotes','crossThoughts','thoughtReplies','manuscripts','libraryBooks','libraryFolders','zoteroCollections','libraryHighlights','ocrCache','bookThoughts','links','dismissedSuggestions'];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function validSettings(data){
 if(!data||!Array.isArray(data.notes))return false;
 if(validateOrganization(data))return false;
 if(['setupCompleted','zoteroEnabled'].some(k=>data[k]!==undefined&&typeof data[k]!=='boolean'))return false;
 const roots=data.notes.filter(n=>!n.parent);
 if(!roots.length||roots.some(root=>root.kind!=='question'||typeof root.title!=='string'||!root.title.trim()||root.title.length>300))return false;
 const pages=data.questionPages;
 if(pages!==undefined){
  if(!Array.isArray(pages)||pages.length>1000||new Set(pages.map(p=>p.id)).size!==pages.length||new Set(pages.map(p=>p.rootId)).size!==pages.length||pages.length!==roots.length)return false;
  const ids=new Set(pages.map(p=>p.id));
  if(pages.some(p=>!p||typeof p.id!=='string'||!p.id||p.id.length>100||!roots.some(r=>r.id===p.rootId)||!['question','collection'].includes(p.kind)||!Number.isInteger(p.order)||p.order<1||!Array.isArray(p.members)||new Set(p.members).size!==p.members.length||p.members.some(id=>id===p.id||!ids.has(id)||!pages.some(other=>other.id===id))||(p.kind==='question'&&p.members.length)))return false;
 }else if(roots.length!==1)return false;
 if(data.setupCompleted===false&&(data.notes.length!==1||roots[0].body||roots[0].revisions?.length||roots[0].thoughts?.length||data.zoteroEnabled!==false||contentArrays.some(k=>data[k]?.length)))return false;
 return true;
}
function validateCoreTransition(previous,next){
 if(!validSettings(next))return '核心问题或初始化状态无效。';
 if(previous.organizationVersion===2&&next.organizationVersion!==2)return '新版问题结构需要保留，请使用兼容版本。';
 if(!same(previous.recordArchives||[],next.recordArchives||[]))return '归档状态请通过资料维护修改。';
 if(previous.setupCompleted!==false&&next.setupCompleted===false)return '已有资料不能重置为首次使用状态。';
 const wasPending=previous.setupCompleted===false;
 if(wasPending){
  const from=previous.notes.find(n=>!n.parent),to=next.notes.find(n=>n.id===from?.id);
  if(!from||!to||next.notes.length!==1)return '首次设置只保存你的问题。';
  if(next.setupCompleted===false)return same(previous,next)?'':'请先填写问题。';
  if(to.revisions?.length||(to.at!==undefined&&!Number.isFinite(Date.parse(to.at)))||!same({...from,title:to.title,...(to.at!==undefined?{at:to.at}:{})},to)||contentArrays.some(k=>!same(previous[k]||[],next[k]||[]))||next.zoteroEnabled!==false)return '首次设置只保存你的问题。';
  return '';
 }
 for(const from of previous.notes){
  const to=next.notes.find(n=>n.id===from.id);
  if(!to||to.parent!==from.parent||to.kind!==from.kind)return '已有问题的身份和原始归属需要保留；重新安排请使用页面位置。';
  if(!same(from.at,to.at)||!same(from.thoughts||[],(to.thoughts||[]).slice(0,(from.thoughts||[]).length)))return '创建时间与已有后续思考需要保留。';
  const history=from.revisions||[],revisions=to.revisions||[];
  const changed=['title','body','origin','source'].some(k=>from[k]!==to[k]);
  if(!changed){if(!same(history,revisions))return '已有修改记录需要保留。';continue;}
  const revision=revisions.at(-1);
  if(revisions.length!==history.length+1||!same(history,revisions.slice(0,-1))||!revision||['title','body','origin','source'].some(k=>revision[k]!==from[k])||(typeof revision.reason!=='string'||!revision.reason.trim())||!Number.isFinite(Date.parse(revision.at)))return '修改问题时需要保留原文和修改原因。';
 }
 for(const from of previous.cards||[]){
  const to=next.cards.find(c=>c.id===from.id);if(!to)return '卡片需要保留，可在资料维护中归档。';
  if(from.at!==to.at||!same(from.thoughts||[],(to.thoughts||[]).slice(0,(from.thoughts||[]).length))||!same(from.adoptions||[],(to.adoptions||[]).slice(0,(from.adoptions||[]).length))||!same(from.revisions||[],(to.revisions||[]).slice(0,(from.revisions||[]).length)))return '卡片的创建时间、思考、采用来源与历史需要保留。';
  if(['text','origin','source','kind','tags'].some(k=>!same(from[k],to[k]))){const history=from.revisions||[],revisions=to.revisions||[],entry=revisions.at(-1);if(revisions.length!==history.length+1||!same(history,revisions.slice(0,-1))||!entry||entry.text!==from.text||entry.source!==from.source||entry.origin!==from.origin||!Number.isFinite(Date.parse(entry.at)))return '编辑卡片时需要保留此前表述。';}
 }
 return '';
}

function validateReadingTransition(previous,next,allowRemoval=false){
 const targets=new Set([...next.notes.filter(n=>n.kind==='question').map(n=>n.id),...next.crossThoughts.map(n=>n.id)]);
 for(const note of next.readingNotes)if(!Array.isArray(note.questionIds)||note.questionIds.length>100||new Set(note.questionIds).size!==note.questionIds.length||note.questionIds.some(id=>!targets.has(id)))return '请选择有效的问题。';
 for(const note of next.readingNotes)if(note.sources&&(!Array.isArray(note.sources)||!note.sources.length||note.sources.length>100||new Set(note.sources.map(s=>s.id)).size!==note.sources.length||note.sources.some(s=>!s.id||!s.libraryBookId||typeof s.quote!=='string'||!s.quote.trim()||typeof s.bookTitle!=='string'||typeof s.locator!=='string'||typeof s.sourceLocation!=='string')))return '共同过程笔记需要完整的选文和原文位置。';
 for(const old of previous.readingNotes){
  const note=next.readingNotes.find(n=>n.id===old.id);if(!note&&allowRemoval)continue;if(!note)return '过程笔记请使用归档。';
  if(['quote','rawQuote','book','author','chapter','locator','libraryBookId','sourceLocation','anchorY','sources','at'].some(k=>!same(old[k],note[k])))return '原文、来源与创建时间需要保留。';
  const history=old.revisions||[],revisions=note.revisions||[];
  if(old.interpretation!==note.interpretation){const entry=revisions.at(-1);if(revisions.length!==history.length+1||!same(history,revisions.slice(0,-1))||entry?.text!==old.interpretation||typeof entry.reason!=='string'||!Number.isFinite(Date.parse(entry.at)))return '修改笔记时需要保留此前表述。';}
  else if(!same(history,revisions))return '已有修订记录需要保留。';
  if(!same(old.thoughts||[],(note.thoughts||[]).slice(0,(old.thoughts||[]).length)))return '已有后续思考需要保留。';
 }
 for(const entry of next.bookThoughts||[]){

  if(entry.sources&&(!Array.isArray(entry.sources)||entry.sources.length<2||entry.sources.length>100||new Set(entry.sources.map(source=>source?.id)).size!==entry.sources.length||entry.sources.some(source=>!source||typeof source.id!=='string'||!source.id||typeof source.bookTitle!=='string'||typeof source.locator!=='string'||['quote','noteText','chapter','sourceLocation','libraryBookId'].some(field=>source[field]!==undefined&&typeof source[field]!=='string'))))return '共同思考的来源记录不完整，请保留至少两个来源。';
  if(!Array.isArray(entry.questionIds)||entry.questionIds.some(id=>!targets.has(id)))return '请选择有效的问题。';
  const old=(previous.bookThoughts||[]).find(item=>item.id===entry.id);
  if(!old)continue;
  if(old.at!==entry.at||!same(old.thoughts||[],(entry.thoughts||[]).slice(0,(old.thoughts||[]).length)))return '思考的创建时间与已有追加内容需要保留。';
  const history=old.revisions||[],revisions=entry.revisions||[],changed=old.text!==entry.text||!same(old.sources,entry.sources);
  if(!changed&&same(history,revisions))continue;
  const revision=revisions.at(-1);
  if(revisions.length!==history.length+1||!same(history,revisions.slice(0,-1))||!revision||revision.text!==old.text||!same(revision.sources,old.sources||[])||!same(revision.questionIds,old.questionIds)||typeof revision.reason!=='string'||!Number.isFinite(Date.parse(revision.at)))return '修改共同思考时需要保留原文和修改原因。';
 }
 return '';
}
module.exports={validSettings,validateCoreTransition,validateReadingTransition};
