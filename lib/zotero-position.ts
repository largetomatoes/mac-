import type {ZoteroAnnotation} from './notebook';
type Viewport={width:number;height:number;convertToViewportPoint:(x:number,y:number)=>number[]};
export function zoteroCfi(annotation:ZoteroAnnotation):string|null{
 try{const p=JSON.parse(annotation.position||'{}');return p.type==='FragmentSelector'&&typeof p.value==='string'&&p.value.startsWith('epubcfi(')&&p.value.endsWith(')')&&p.value.length<=4000?p.value:null;}catch{return null;}
}
export function zoteroPdfRects(annotation:ZoteroAnnotation,page:number,viewport:Viewport):Array<{left:number;top:number;width:number;height:number}>{
 try{const p=JSON.parse(annotation.position||'{}');if(p.pageIndex!==page-1)return [];
  const rects=Array.isArray(p.rects)?p.rects:[];return rects.slice(0,1000).flatMap((rect:unknown)=>{if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isFinite))return [];const q=[...viewport.convertToViewportPoint(rect[0],rect[1]),...viewport.convertToViewportPoint(rect[2],rect[3])];const left=Math.min(q[0],q[2]),top=Math.min(q[1],q[3]),right=Math.max(q[0],q[2]),bottom=Math.max(q[1],q[3]);if(right<=0||bottom<=0||left>=viewport.width||top>=viewport.height)return [];const x=Math.max(0,left),y=Math.max(0,top),width=Math.min(viewport.width,right)-x,height=Math.min(viewport.height,bottom)-y;return width>0&&height>0?[{left:x,top:y,width,height}]:[];});
 }catch{return [];}
}

type ScreenRect={left:number;top:number;width:number;height:number};
export function clipEpubSourceRects(rects:ScreenRect[],frame:{left:number;top:number},stage:ScreenRect):ScreenRect[]{
 return rects.filter(r=>r.width>0&&r.height>0).flatMap(rect=>{const left=Math.max(stage.left,frame.left+rect.left),top=Math.max(stage.top,frame.top+rect.top),right=Math.min(stage.left+stage.width,frame.left+rect.left+rect.width),bottom=Math.min(stage.top+stage.height,frame.top+rect.top+rect.height);return right>left&&bottom>top?[{left:left-stage.left,top:top-stage.top,width:right-left,height:bottom-top}]:[];});
}
