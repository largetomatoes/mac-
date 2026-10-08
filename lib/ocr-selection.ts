import type {OcrLine} from './notebook';
import {cleanReadingText} from './reader-text';

export type OcrSelectionRun={text:string;suffix:string;x0:number;x1:number;y0:number;y1:number;line:number};

// Share the small spaces between adjacent words. Unlike the ink boxes returned
// by OCR, these boxes cover the entire selectable line, with one common height.
// Large gutters and backwards jumps remain separate (columns, tables, etc.).
export function ocrSelectionRuns(lines:OcrLine[]):OcrSelectionRun[]{
 return lines.flatMap((line,lineIndex)=>{
  const source=cleanReadingText(line.text);
  let words=(line.words?.length?line.words:[line]).map(word=>({...word,text:cleanReadingText(word.text)})).filter(word=>word.text&&word.x1>word.x0);
  if(!words.length)return [];
  const positions:number[]=[];let cursor=0;
  for(const word of words){const at=source.indexOf(word.text,cursor);positions.push(at);if(at>=0)cursor=at+word.text.length;}
  // A cached line may have incomplete word boxes. Keep its full original text.
  if(positions.some(at=>at<0)||words.map(word=>word.text).join('').replace(/\s/g,'')!==source.replace(/\s/g,'')){
   words=[{...line,text:source}];positions.splice(0,positions.length,0);
  }
  const widths=words.map(word=>(word.x1-word.x0)/Math.max(1,Array.from(word.text).length)).sort((a,b)=>a-b);
  const maxGap=Math.min(.025,widths[Math.floor(widths.length/2)]*2.5);
  const boundaries=words.slice(0,-1).map((word,index)=>{
   const next=words[index+1],gap=next.x0-word.x1;
   return next.x0>word.x0&&next.x1>word.x1&&gap<=maxGap?(word.x1+next.x0)/2:null;
  });
  const y0=Math.min(line.y0,...words.map(word=>word.y0)),y1=Math.max(line.y1,...words.map(word=>word.y1));
  return words.map((word,index)=>({
   text:word.text,
   suffix:index===words.length-1?'\n':source.slice(positions[index]+word.text.length,positions[index+1]),
   x0:index>0?(boundaries[index-1]??word.x0):word.x0,
   x1:boundaries[index]??word.x1,y0,y1,line:lineIndex,
  }));
 });
}
