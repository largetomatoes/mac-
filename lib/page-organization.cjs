const FORMAT = 2;
const clone = value => JSON.parse(JSON.stringify(value));
const id = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
function pages(data) {
  return data.questionPages || data.notes.filter(n => n.kind === 'question' && !n.parent).map((n,i) => ({id:'page-'+n.id,rootId:n.id,kind:'question',order:i+1,members:[]}));
}
function placements(data, page, trail = new Set()) {
  if (page.placements) return page.placements;
  if (trail.has(page.id)) throw Error('问题页来源形成循环，尚未改动资料。');
  const nextTrail = new Set([...trail,page.id]);
  const notes = new Map(data.notes.map(n => [n.id,n]));
  const owners=new Map();for(const entry of [...data.notes,...(data.cards||[]),...(data.crossThoughts||[])])for(const thought of entry.thoughts||[])owners.set(thought.id,entry.id);for(const card of data.cards||[])if(card.questionId)owners.set(card.id,card.questionId);
  const own = recordId => {const seen=new Set();while(recordId&&!seen.has(recordId)){if(recordId===page.rootId)return true;seen.add(recordId);recordId=notes.get(recordId)?.parent||owners.get(recordId);}return false;};
  const crosses=(data.crossThoughts||[]).filter(c=>c.pageId?c.pageId===page.id:c.anchorIds.some(own));
  const crossIds=new Set(crosses.map(c=>c.id));
  const belongs=recordId=>{const seen=new Set();while(recordId&&!seen.has(recordId)){if(own(recordId)||crossIds.has(recordId))return true;seen.add(recordId);recordId=notes.get(recordId)?.parent||owners.get(recordId);}return false;};
  const result=data.notes.filter(n=>belongs(n.id)).map(n=>({id:page.id+'@'+n.id,recordId:n.id,parentId:n.id===page.rootId?null:n.parent,order:n.parent===page.rootId?(page.members?.length||0)+n.order:n.order}));
  result.push(...crosses.map(c=>({id:page.id+'@'+c.id,recordId:c.id,parentId:page.rootId,order:c.order})));
  for(const [index,memberId] of (page.members||[]).entries()) {
    const member=pages(data).find(p=>p.id===memberId);if(!member)continue;
    for(const source of placements(data,member,nextTrail))if(!result.some(p=>p.recordId===source.recordId))result.push({...source,id:page.id+'@'+source.recordId,parentId:source.recordId===member.rootId?page.rootId:source.parentId,order:source.recordId===member.rootId?index+1:source.order,sourcePageId:member.id,sourcePlacementId:source.id});
  }
  return result;
}
function migrateOrganization(data) {
  if(data.organizationVersion>FORMAT)throw Error('资料来自更新版本，请升级问间后再编辑。');
  if(!data.notes?.length || data.setupCompleted===false)return data;
  const sourcePages=pages(data);
  if(data.organizationVersion===FORMAT&&sourcePages.every(p=>Array.isArray(p.placements)))return data;
  return {...data,organizationVersion:FORMAT,questionPages:sourcePages.map(p=>({...p,placements:placements(data,p)}))};
}
function validateOrganization(data) {
  if(data.organizationVersion!==undefined&&data.organizationVersion!==FORMAT)return '资料格式暂不兼容。';
  const records=new Set([...data.notes,...(data.crossThoughts||[])].map(n=>n.id));
  for(const page of pages(data)) {
    if(!page.placements){if(data.organizationVersion===FORMAT)return '问题页位置尚未完整保存。';continue;}
    const rows=page.placements,byId=new Map(rows.map(p=>[p.recordId,p]));
    if(rows.length>20000||byId.size!==rows.length||new Set(rows.map(p=>p.id)).size!==rows.length)return '同一页的一个问题只能有一个正式位置。';
    if(!byId.has(page.rootId)||byId.get(page.rootId).parentId!==null)return '问题页的核心位置需要保留。';
    for(const p of rows){
      if(typeof p.id!=='string'||!p.id||!records.has(p.recordId)||!Number.isFinite(p.order)||(p.recordId!==page.rootId&&(!p.parentId||!byId.has(p.parentId))))return '问题位置或上级无效。';
      const seen=new Set([p.recordId]);let parent=p.parentId;
      while(parent){if(seen.has(parent))return '不能将问题放到自己的分支下面。';seen.add(parent);parent=byId.get(parent)?.parentId;}
    }
  }
  return '';
}
function pageRecordIds(data,pageId){const page=pages(data).find(p=>p.id===pageId);return page?new Set(placements(data,page).map(p=>p.recordId)):new Set();}
function recordPages(data,recordId){return pages(data).filter(page=>placements(data,page).some(p=>p.recordId===recordId));}
function organizationView(data,pageId){
  const page=pages(data).find(p=>p.id===pageId);if(!page)return {...data,notes:[],crossThoughts:[],links:[]};
  const rows=placements(data,page),byId=new Map(rows.map(p=>[p.recordId,p])),ids=new Set(byId.keys());
  const owners=new Map();for(const item of [...data.notes,...data.cards,...data.crossThoughts])for(const thought of item.thoughts||[])owners.set(thought.id,item.id);
  const owner=key=>owners.get(key)||key;
  for(const card of data.cards)if(data.links.some(l=>(owner(l.from)===card.id&&ids.has(owner(l.to)))||(owner(l.to)===card.id&&ids.has(owner(l.from)))))ids.add(card.id);
  const externalLabels={};for(const c of data.crossThoughts.filter(c=>byId.has(c.id)))for(const anchor of c.anchorIds){const recordId=owner(anchor);if(!byId.has(recordId)){const n=data.notes.find(n=>n.id===recordId)||data.crossThoughts.find(n=>n.id===recordId);const source=recordPages(data,recordId).find(p=>!p.archivedAt);externalLabels[anchor]=(source?(data.notes.find(n=>n.id===source.rootId)?.title||'来源页')+' · ':'')+(n?.title||n?.text||'原连接')+'（页外）';}}
  return {...data,viewPageId:pageId,externalLabels,notes:data.notes.filter(n=>byId.has(n.id)).map(n=>({...n,parent:byId.get(n.id).parentId,order:byId.get(n.id).order})),crossThoughts:data.crossThoughts.filter(c=>byId.has(c.id)).map(c=>({...c,pageId:page.id})),links:data.links.filter(l=>ids.has(owner(l.from))&&ids.has(owner(l.to)))};
}
function saveArrangement(data,pageId,rows,label,at=now()) {
  const ready=migrateOrganization(data),page=pages(ready).find(p=>p.id===pageId);if(!page)throw Error('找不到目标问题页。');
  if(JSON.stringify(page.placements)===JSON.stringify(rows))return ready;
  const before=clone(page.placements),after=clone(rows);
  const entry={id:id(),at,label,before,after};
  const next={...ready,questionPages:pages(ready).map(p=>p.id===pageId?{...p,placements:after,arrangements:[...(p.arrangements||[]),entry]}:p)};
  const error=validateOrganization(next);if(error)throw Error(error);return next;
}
function branchIds(rows,rootId){const ids=new Set([rootId]);let changed=true;while(changed){changed=false;for(const row of rows)if(ids.has(row.parentId)&&!ids.has(row.recordId)){ids.add(row.recordId);changed=true;}}return ids;}
function includeBranch(data,targetPageId,sourcePageId,recordId,parentId,withChildren=true,at=now()) {
  const ready=migrateOrganization(data),target=pages(ready).find(p=>p.id===targetPageId),source=pages(ready).find(p=>p.id===sourcePageId);
  if(!target||!source||!target.placements.some(p=>p.recordId===parentId))throw Error('请选择有效的问题页和放入位置。');
  const chosen=withChildren?branchIds(source.placements,recordId):new Set([recordId]);
  // Answers remain attached to their question even when only that question is chosen.
  for(const n of ready.notes)if(n.kind==='answer'&&chosen.has(n.parent))chosen.add(n.id);
  const rows=source.placements.filter(p=>chosen.has(p.recordId));if(!rows.some(p=>p.recordId===recordId))throw Error('来源问题已变化。');
  if(target.placements.some(p=>chosen.has(p.recordId)))throw Error('其中的问题已在本页。请调整现有位置，或建立联系。');
  const order=Math.max(0,...target.placements.filter(p=>p.parentId===parentId).map(p=>p.order))+1;
  const added=rows.map(p=>({...p,id:id(),parentId:p.recordId===recordId?parentId:p.parentId,order:p.recordId===recordId?order:p.order,sourcePageId,sourcePlacementId:p.id,adoptedAt:at}));
  return saveArrangement(ready,targetPageId,[...target.placements,...added],'纳入已有问题',at);
}
function movePlacement(data,pageId,recordId,parentId,beforeId,at=now()){
  const ready=migrateOrganization(data),page=pages(ready).find(p=>p.id===pageId),row=page?.placements.find(p=>p.recordId===recordId);
  if(!row||recordId===page.rootId)throw Error('请选择子问题的位置。');
  if(!page.placements.some(p=>p.recordId===parentId)||branchIds(page.placements,recordId).has(parentId))throw Error('不能移到自身或自身分支下。');
  const siblings=page.placements.filter(p=>p.parentId===parentId&&p.recordId!==recordId).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  const index=beforeId?siblings.findIndex(p=>p.recordId===beforeId):-1;siblings.splice(index<0?siblings.length:index,0,{...row,parentId});
  const moved=new Map(siblings.map((p,i)=>[p.recordId,{...p,order:i+1}]));
  return saveArrangement(ready,pageId,page.placements.map(p=>moved.get(p.recordId)||p),'调整问题位置',at);
}
function removePlacement(data,pageId,recordId,at=now()){
  const ready=migrateOrganization(data),page=pages(ready).find(p=>p.id===pageId);if(!page||recordId===page.rootId)throw Error('核心问题请使用问题页归档。');
  const removed=branchIds(page.placements,recordId);return saveArrangement(ready,pageId,page.placements.filter(p=>!removed.has(p.recordId)),'移出当前页',at);
}
function registerPageAdditions(previous,next,pageId){
  const ready=migrateOrganization(next),page=pages(ready).find(p=>p.id===pageId);if(!page)return ready;
  const oldIds=new Set([...previous.notes,...previous.crossThoughts].map(n=>n.id)),placed=new Set(pages(ready).flatMap(p=>p.placements.map(x=>x.recordId)));
  const newNotes=ready.notes.filter(n=>!oldIds.has(n.id)&&!placed.has(n.id));
  const newCrosses=ready.crossThoughts.filter(c=>!oldIds.has(c.id)&&!placed.has(c.id));
  if(!newNotes.length&&!newCrosses.length)return ready;
  const rows=[...page.placements],at=now();
  for(const n of newNotes){if(!rows.some(p=>p.recordId===n.parent))throw Error('上级问题不在当前页，请重新选择。');rows.push({id:id(),recordId:n.id,parentId:n.parent,order:n.order,adoptedAt:at});}
  for(const c of newCrosses)rows.push({id:id(),recordId:c.id,parentId:page.rootId,order:c.order,adoptedAt:at});
  return saveArrangement(ready,pageId,rows,'添加问题或交叉思考',at);
}
function undoArrangement(data,pageId,entryId,at=now()){
  const ready=migrateOrganization(data),page=pages(ready).find(p=>p.id===pageId),entry=page?.arrangements?.find(e=>e.id===entryId);
  if(!entry)throw Error('找不到这次整理。');
  if(JSON.stringify(page.placements)!==JSON.stringify(entry.after))throw Error('之后已有其他整理，请在当前结构中调整，避免覆盖后来变化。');
  return saveArrangement(ready,pageId,entry.before,'撤销：'+entry.label,at);
}
module.exports={FORMAT,pages,placements,migrateOrganization,validateOrganization,pageRecordIds,recordPages,organizationView,saveArrangement,branchIds,includeBranch,movePlacement,removePlacement,registerPageAdditions,undoArrangement};
