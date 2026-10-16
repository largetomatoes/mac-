type CaretDocument=Document&{caretRangeFromPoint?:(x:number,y:number)=>Range|null;caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null};
// A modifier drag belongs to one text root. Preventing native drag/extension
// avoids macOS text-drag sessions and Shift's cross-pane anchor behavior.
export function beginLocalTextDrag(event:MouseEvent,root:HTMLElement,onComplete:(range:Range)=>void,onEnd?:()=>void){
 const doc=root.ownerDocument as CaretDocument,selection=doc.getSelection();
 function caret(x:number,y:number){const range=doc.caretRangeFromPoint?.(x,y);if(range&&root.contains(range.startContainer))return {node:range.startContainer,offset:range.startOffset};const point=doc.caretPositionFromPoint?.(x,y);return point&&root.contains(point.offsetNode)?{node:point.offsetNode,offset:point.offset}:null;}
 const anchor=caret(event.clientX,event.clientY);if(!anchor||!selection)return false;
 event.preventDefault();selection.removeAllRanges();selection.setBaseAndExtent(anchor.node,anchor.offset,anchor.node,anchor.offset);
 const pointer='pointerId' in event?event as PointerEvent:null,moveType=pointer?'pointermove':'mousemove',upType=pointer?'pointerup':'mouseup';
 if(pointer)try{root.setPointerCapture(pointer.pointerId);}catch{/* Pointer already released outside the document. */}
 let done=false;const parents:Document[]=[];
 try{const parent=doc.defaultView?.parent.document;if(parent&&parent!==doc)parents.push(parent);}catch{/* Reader frames are same-origin; other frames are ignored. */}
 const update=(mouse:MouseEvent)=>{const point=caret(mouse.clientX,mouse.clientY);if(point)selection.setBaseAndExtent(anchor.node,anchor.offset,point.node,point.offset);};
 const cleanup=()=>{doc.removeEventListener(moveType,move as EventListener,true);doc.removeEventListener(upType,finish as EventListener,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('dragstart',preventDrag,true);doc.removeEventListener('keydown',key,true);for(const parent of parents)parent.removeEventListener(upType,outside as EventListener,true);if(pointer&&root.hasPointerCapture(pointer.pointerId))root.releasePointerCapture(pointer.pointerId);};
 const complete=()=>{if(done)return;done=true;cleanup();const range=selection.rangeCount&&!selection.isCollapsed?selection.getRangeAt(0).cloneRange():null;onEnd?.();if(range&&root.contains(range.commonAncestorContainer))onComplete(range);};
 const move=(mouse:MouseEvent)=>{mouse.preventDefault();update(mouse);};
 const finish=(mouse:MouseEvent)=>{update(mouse);mouse.preventDefault();mouse.stopImmediatePropagation();complete();};
 const outside=(mouse:MouseEvent)=>{mouse.preventDefault();complete();};
 const cancel=()=>{if(done)return;done=true;cleanup();selection.removeAllRanges();onEnd?.();};
 const preventDrag=(drag:Event)=>drag.preventDefault();
 const key=(keyboard:KeyboardEvent)=>{if(keyboard.key==='Escape'){keyboard.preventDefault();keyboard.stopImmediatePropagation();cancel();}};
 doc.addEventListener(moveType,move as EventListener,true);doc.addEventListener(upType,finish as EventListener,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('dragstart',preventDrag,true);doc.addEventListener('keydown',key,true);for(const parent of parents)parent.addEventListener(upType,outside as EventListener,true);
 return true;
}
