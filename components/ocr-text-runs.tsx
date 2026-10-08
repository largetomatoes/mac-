'use client';
import {useLayoutEffect,useMemo,useRef} from 'react';
import type {OcrLine} from '@/lib/notebook';
import {ocrSelectionRuns} from '@/lib/ocr-selection';

export function OcrTextRuns({lines,width,height}:{lines:OcrLine[];width:number;height:number}){
 const root=useRef<HTMLDivElement>(null);
 const runs=useMemo(()=>ocrSelectionRuns(lines),[lines]);
 useLayoutEffect(()=>{
  const spans=Array.from(root.current?.querySelectorAll<HTMLSpanElement>('span')||[]);
  // Batch measurements: do not force a layout after every individual word.
  for(const span of spans)span.style.transform='none';
  // CSS widths are local to the page. A viewport Range includes the opening
  // dialog's scale animation, which otherwise leaves every run too wide.
  const measured=spans.map(span=>parseFloat(getComputedStyle(span).width));
  for(let index=0;index<spans.length;index++)if(measured[index]>0){
   const run=runs[index];spans[index].style.transform=`scaleX(${(run.x1-run.x0)*width/measured[index]})`;
  }
 },[runs,width,height]);
 return <div ref={root} className="ocr-text-runs">{runs.map((run,index)=><span key={index} data-ocr-line={run.line} style={{left:`${run.x0*100}%`,top:`${run.y0*100}%`,fontSize:`${Math.max(4,(run.y1-run.y0)*height)}px`,height:`${(run.y1-run.y0)*height}px`}}>{run.text+run.suffix}</span>)}</div>;
}
