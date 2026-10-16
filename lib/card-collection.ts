import type {Card,Notebook,Note} from './notebook';
import {migrateOrganization,registerPageAdditions,recordPages} from './page-organization.cjs';
export type CardKind='idea'|'question';
export function cardKind(card:Card):CardKind{return card.kind==='idea'?'idea':card.kind==='question'||card.questionId?'question':'idea';}
export function cardQuestions(card:Card,data:Notebook){const ids=new Set([card.questionId,...(card.adoptions||[]).filter(a=>a.kind==='question').map(a=>a.questionId)].filter(Boolean));return data.notes.filter(n=>ids.has(n.id)||n.sourceCardId===card.id);}
export function cardQuestion(card:Card,data:Notebook){return cardQuestions(card,data)[0];}
export function cardConnectionCount(card:Card,data:Notebook){const ids=new Set([card.id,...card.thoughts.map(t=>t.id)]);return new Set([...cardQuestions(card,data).map(n=>'question:'+n.id),...(card.adoptions||[]).map(a=>'question:'+a.questionId),...data.links.filter(l=>ids.has(l.from)||ids.has(l.to)).map(l=>'question:'+(ids.has(l.from)?l.to:l.from)),...data.crossThoughts.filter(c=>c.anchorIds.some(id=>ids.has(id))).map(c=>'cross:'+c.id)]).size;}
export function cardConnected(card:Card,data:Notebook){return cardConnectionCount(card,data)>0;}
export function cardPlaced(card:Card){return !!card.questionId||!!card.adoptions?.length;}
export function cleanTags(tags:string[]){return [...new Set(tags.map(t=>t.trim()).filter(Boolean))].slice(0,100);}
export function editCard(data:Notebook,id:string,patch:Pick<Card,'text'|'origin'|'source'> & {kind:CardKind;tags:string[]},at=new Date().toISOString()):Notebook{
 const card=data.cards.find(c=>c.id===id);if(!card)throw Error('卡片已不存在。');const next={...patch,text:patch.text.trim(),tags:cleanTags(patch.tags)};if(!next.text)throw Error('请保留卡片的文字。');
 if(['text','origin','source','kind','tags'].every(key=>JSON.stringify((card as any)[key]??(key==='tags'?[]:undefined))===JSON.stringify((next as any)[key])))return data;
 const revision={id:crypto.randomUUID(),text:card.text,origin:card.origin,source:card.source,kind:cardKind(card),tags:card.tags||[],at};
 return {...data,cards:data.cards.map(c=>c.id===id?{...c,...next,modifiedAt:at,revisions:[...(c.revisions||[]),revision]}:c)};
}
export function setCardKind(data:Notebook,id:string,kind:CardKind):Notebook{const card=data.cards.find(c=>c.id===id);if(!card)throw Error('卡片已不存在。');return editCard(data,id,{text:card.text,origin:card.origin,source:card.source,tags:card.tags||[],kind});}
export function placeCardQuestion(data:Notebook,cardId:string,parent:string,title:string,pageId?:string):{data:Notebook;questionId:string}{
 const ready=migrateOrganization(data),card=ready.cards.find(c=>c.id===cardId);if(!card)throw Error('卡片已不存在。');const text=title.trim();if(!text||text.length>300)throw Error('请填写1至300字的问题标题。');
 const target=recordPages(ready,parent).find(p=>p.id===pageId)||(!pageId?recordPages(ready,parent).find(p=>!p.archivedAt):undefined);if(!target||target.archivedAt)throw Error('请选择有效的问题页和所属位置。');
 const questionId=crypto.randomUUID(),at=new Date().toISOString();
 const note:Note={id:questionId,kind:'question',parent,order:Math.max(0,...(target.placements||[]).filter(p=>p.parentId===parent).map(p=>p.order))+1,title:text,body:card.text,origin:card.origin,source:card.source,at,revisions:[],thoughts:[],sourceCardId:card.id};
 const next={...ready,notes:[...ready.notes,note],cards:ready.cards.map(c=>c.id===card.id?{...c,adoptions:[...(c.adoptions||[]),{id:crypto.randomUUID(),kind:'question' as const,questionId,pageId:target.id,text:card.text,at}]}:c)};
 return {questionId,data:registerPageAdditions(ready,next,target.id)};
}
export function linkCardMaterial(data:Notebook,cardId:string,questionId:string,pageId:string):Notebook{
 const card=data.cards.find(c=>c.id===cardId);if(!card||!recordPages(data,questionId).some(p=>p.id===pageId&&!p.archivedAt))throw Error('卡片或目标问题已变化。');
 if(card.adoptions?.some(a=>a.kind==='material'&&a.questionId===questionId&&a.pageId===pageId))return data;
 const at=new Date().toISOString();return {...data,cards:data.cards.map(c=>c.id===cardId?{...c,adoptions:[...(c.adoptions||[]),{id:crypto.randomUUID(),kind:'material' as const,questionId,pageId,text:card.text,at}]}:c),links:data.links.some(l=>l.from===cardId&&l.to===questionId)?data.links:[...data.links,{id:crypto.randomUUID(),from:cardId,to:questionId,type:'启发'}]};
}
