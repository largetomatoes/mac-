import type {Card,Notebook,Note} from './notebook';
export type CardKind='idea'|'question';
export function cardKind(card:Card):CardKind{return card.kind==='idea'?'idea':card.kind==='question'||card.questionId?'question':'idea';}
export function cardQuestion(card:Card,data:Notebook){return card.questionId?data.notes.find(n=>n.id===card.questionId):undefined;}
export function cardConnectionCount(card:Card,data:Notebook){const ids=new Set([card.id,...card.thoughts.map(t=>t.id)]);return (cardQuestion(card,data)?1:0)+data.links.filter(l=>ids.has(l.from)||ids.has(l.to)).length+data.crossThoughts.filter(c=>c.anchorIds.some(id=>ids.has(id))).length;}
export function cardConnected(card:Card,data:Notebook){return cardConnectionCount(card,data)>0;}
export function setCardKind(data:Notebook,id:string,kind:CardKind):Notebook{const card=data.cards.find(c=>c.id===id);if(!card)throw Error('卡片已不存在。');return {...data,cards:data.cards.map(c=>c.id===id?{...c,kind}:c)};}
export function placeCardQuestion(data:Notebook,cardId:string,parent:string,title:string):{data:Notebook;questionId:string}{
 const card=data.cards.find(c=>c.id===cardId);if(!card)throw Error('卡片已不存在。');const existing=cardQuestion(card,data);if(existing)return {data,questionId:existing.id};
 if(!data.notes.some(n=>n.id===parent&&n.kind==='question')&&!data.crossThoughts.some(n=>n.id===parent))throw Error('请选择所属问题或交叉板块。');
 const text=title.trim();if(!text||text.length>300)throw Error('问题标题需为 1 至 300 字。');
 const questionId='card-question-'+card.id;if(data.notes.some(n=>n.id===questionId))throw Error('对应问题已存在，请先同步。');
 const note:Note={id:questionId,kind:'question',parent,order:Math.max(0,...data.notes.filter(n=>n.parent===parent&&n.kind==='question').map(n=>n.order))+1,title:text,body:card.text,origin:card.origin,source:card.source,revisions:[],thoughts:card.thoughts,sourceCardId:card.id};
 const remap=(id:string)=>id===card.id?questionId:id;
 return {questionId,data:{...data,notes:[...data.notes,note],cards:data.cards.map(c=>c.id===card.id?{...c,kind:'question',questionId,thoughts:[]}:c),links:data.links.map(l=>({...l,from:remap(l.from),to:remap(l.to)})),crossThoughts:data.crossThoughts.map(c=>({...c,anchorIds:c.anchorIds.map(remap)}))}};
}
