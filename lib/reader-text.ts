// Normalize machine-extracted text only; never rewrite a saved quotation.
export const OCR_VERSION = 2;
export function cleanReadingText(value:string):string {
 return value.replace(/\r\n?/g,'\n').replace(/[\t\u00a0 ]+/g,' ')
  .replace(/([\p{Script=Han}]) (?=[\p{Script=Han}])/gu,'$1')
  .replace(/([\p{Script=Han}]) (?=[，。！？；：、）》】,!?;:])/gu,'$1')
  .replace(/([\p{Script=Han}][，。！？；：、,!?;:]) (?=[\p{Script=Han}])/gu,'$1')
  .split('\n').map(line=>line.trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
// Use only for a newly extracted PDF/OCR quote, never for saved user text.
// Double newlines carry real paragraph boundaries; the UI handles visual wrapping.
export function reflowReadingExcerpt(value:string):string {
 const text=cleanReadingText(value),lines=text.split('\n'),parts:string[]=[];
 const listItem=(line:string)=>/^(?:[-*•●▪]\s|\d{1,3}[.)、](?:\s|(?=[\p{Script=Han}]))|[一二三四五六七八九十]+[、.])/u.test(line);
 const heading=(line:string)=>/^(?:第.{0,20}[章节篇部](?:\s|$)|#{1,6}\s)/u.test(line);
 for(const line of lines){
  if(!line){if(parts.length&&parts.at(-1)!=='')parts.push('');continue;}
  const previous=parts.at(-1);
  if(!previous||listItem(line)||heading(line)||heading(previous)){parts.push(line);continue;}
  const left=previous.at(-1)||'',right=line[0]||'';
  if(left==='\u00ad'&&/^\p{L}/u.test(line)){parts[parts.length-1]=previous.slice(0,-1)+line;continue;}
  const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const separator=cjk.test(left)&&cjk.test(right)||/[，。！？；：、）》】」』〕”’),.!?;:]/u.test(right)||/[（《【「『〔“‘(]/u.test(left)||/[，。！？；：、）》】」』〕”’]/u.test(left)&&cjk.test(right)||/[-‐‑–—/]/u.test(left)?'':' ';
  parts[parts.length-1]=previous+separator+line;
 }
 return parts.join('\n').trim();
}
export function searchableText(value:string){return value.replace(/\s/g,'');}
export function textIndex(value:string){let text='';const offsets:number[]=[];for(let i=0;i<value.length;i++)if(!/\s/.test(value[i])){text+=value[i];offsets.push(i);}return {text,offsets};}
export function usablePdfText(items:Array<{str?:string}>){const value=items.map(item=>item.str||'').join('').trim(),bad=(value.match(/[\uFFFD\u0000-\u0008\uE000-\uF8FF]/g)||[]).length;return value.replace(/\s/g,'').length>=20&&bad/Math.max(1,value.length)<.02;}
export function ocrScaleFor(width:number,height:number){return Math.min(300/72,Math.sqrt(12_000_000/(width*height)),5000/Math.max(width,height));}
export function groupNoteAnchors<T>(entries:Array<{item:T;y:number}>,height:number,gap=32){const groups:Array<{items:T[];y:number}>=[];for(const entry of [...entries].sort((a,b)=>a.y-b.y)){const y=Math.max(16,Math.min(Math.max(16,height-16),entry.y));const last=groups.at(-1);if(last&&y-last.y<gap)last.items.push(entry.item);else groups.push({items:[entry.item],y});}return groups;}

export function ocrPixelGray(r:number,g:number,b:number){return Math.min(r,g,b)>100?Math.max(r,g,b):Math.round(.299*r+.587*g+.114*b);}
export function unrotateOcrBox(box:{x0:number;y0:number;x1:number;y1:number},rotation=0){
 switch(rotation){case 90:return {x0:box.y0,y0:1-box.x1,x1:box.y1,y1:1-box.x0};case 180:return {x0:1-box.x1,y0:1-box.y1,x1:1-box.x0,y1:1-box.y0};case 270:return {x0:1-box.y1,y0:box.x0,x1:1-box.y0,y1:box.x1};default:return box;}
}
