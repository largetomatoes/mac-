export type TextMatch={start:number;end:number;before:string;match:string;after:string};
export type BookSearchHit=TextMatch&{location:string;label:string;query:string;occurrence:number};

// Ignore layout whitespace and ASCII case without changing original excerpts.
// Offsets stay in UTF-16 so they can be used directly in DOM Ranges and EPUB CFIs.
export function searchIndex(raw:string){
 let text='';const offsets:number[]=[];
 for(let i=0;i<raw.length;i++)if(!/\s/.test(raw[i])){text+=raw[i].replace(/[A-Z]/g,c=>c.toLowerCase());offsets.push(i);}
 return {text,offsets};
}
export function findBookText(raw:string,query:string,limit=200):TextMatch[]{
 const {text,offsets}=searchIndex(raw),needle=searchIndex(query).text;
 if(!needle)return [];
 const matches:TextMatch[]=[];let at=0;
 while(matches.length<limit){const found=text.indexOf(needle,at);if(found<0)break;
  const start=offsets[found],end=offsets[found+needle.length-1]+1;
  matches.push({start,end,before:(start>36?'…':'')+raw.slice(Math.max(0,start-36),start),match:raw.slice(start,end),after:raw.slice(end,end+56)+(end+56<raw.length?'…':'')});
  at=found+needle.length;
 }
 return matches;
}
export function readingTextNodes(root:Node){
 const doc=root.ownerDocument!,walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes:Text[]=[];let node:Node|null;
 while((node=walker.nextNode()))if(!node.parentElement?.closest('script,style,noscript'))nodes.push(node as Text);
 return nodes;
}
export function rangeForMatch(nodes:Text[],start:number,end:number){
 let offset=0;const range=nodes[0]?.ownerDocument.createRange();if(!range)return null;
 let started=false;
 for(const node of nodes){const next=offset+node.length;
  if(!started&&start<next){range.setStart(node,start-offset);started=true;}
  if(started&&end<=next){range.setEnd(node,end-offset);return range;}
  offset=next;
 }
 return null;
}
