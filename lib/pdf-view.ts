export type PdfView={bookId:string;page:number;rotation:number;scale:number};
// Keep the same document coordinate across resizing and page turns in one book.
export function pdfScrollAfterResize(previous:PdfView|null,next:PdfView,scroll:{top:number;left:number;paddingTop:number;paddingLeft:number}){
 if(!previous||previous.bookId!==next.bookId||previous.rotation!==next.rotation)return {top:0,left:0};
 const ratio=next.scale/previous.scale;if(!Number.isFinite(ratio)||ratio<=0)return {top:scroll.top,left:scroll.left};
 return {top:Math.max(0,(scroll.top-scroll.paddingTop)*ratio+scroll.paddingTop),left:Math.max(0,(scroll.left-scroll.paddingLeft)*ratio+scroll.paddingLeft)};
}
