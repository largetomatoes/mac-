import {type ManuscriptLink} from './notebook';
import {type ManuscriptBlock} from './manuscript-materials';

/** Sentence links use offsets local to each paragraph, so reordering keeps them attached. */
export function flattenManuscriptBlocks(blocks:ManuscriptBlock[]){
 let offset=0;
 const links:ManuscriptLink[]=[];
 for(const block of blocks){
  for(const link of block.links||[])links.push({...link,start:link.start+offset,end:link.end+offset});
  offset+=block.text.length+2;
 }
 return {body:blocks.map(block=>block.text).join('\n\n'),links};
}

/** Do not extend a selected sentence to include later typing. Edits inside it require relinking. */
export function rebaseParagraphLinks(before:string,after:string,links:ManuscriptLink[]):ManuscriptLink[]{
 if(before===after)return links;
 let start=0;
 while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 let oldEnd=before.length,newEnd=after.length;
 while(oldEnd>start&&newEnd>start&&before[oldEnd-1]===after[newEnd-1]){oldEnd--;newEnd--;}
 const delta=newEnd-oldEnd;
 return links.map(link=>{
  if(link.unresolved)return link;
  if(link.end<=start)return link;
  if(link.start>=oldEnd)return {...link,start:link.start+delta,end:link.end+delta};
  return {...link,unresolved:true};
 });
}

export function moveManuscriptBlock(blocks:ManuscriptBlock[],fromId:string,toId:string){
 const from=blocks.findIndex(block=>block.id===fromId),to=blocks.findIndex(block=>block.id===toId);
 if(from<0||to<0||from===to)return blocks;
 const result=[...blocks],item=result.splice(from,1)[0];result.splice(to,0,item);return result;
}

export function validManuscriptBlocks(value:unknown):value is ManuscriptBlock[]{
 if(!Array.isArray(value)||value.length>5000)return false;
 const ids=new Set<string>();
 return value.every(block=>{
  if(!block||typeof block!=='object'||typeof block.id!=='string'||!block.id||ids.has(block.id)||typeof block.text!=='string'||!['paragraph','heading','quote'].includes(block.kind))return false;
  ids.add(block.id);
  if(block.source){const s=block.source;if(typeof s.key!=='string'||typeof s.text!=='string'||typeof s.label!=='string'||typeof s.citation!=='string'||typeof s.at!=='string'||typeof s.targetId!=='string'||!['note','cross','card','reading','bookThought'].includes(s.targetKind)||!['heading','original','quote','understanding','thought','reply'].includes(s.kind))return false;}
  return block.links===undefined||Array.isArray(block.links)&&block.links.every((link:ManuscriptLink)=>link&&typeof link.id==='string'&&typeof link.quote==='string'&&Number.isInteger(link.start)&&Number.isInteger(link.end));
 });
}
