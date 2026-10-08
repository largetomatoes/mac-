import {normalizeZoteroCollections} from './notebook';
import type {LibraryBook,Notebook,ZoteroAnnotation,ZoteroCollection,ZoteroSource} from './notebook';

export type LibraryMode = 'reading'|'zotero';
export type ZoteroCollectionNode = ZoteroCollection & {id:string;children:ZoteroCollectionNode[];bookIds:string[];directBookIds:string[];count:number;directCount:number};

export function isReadingBook(book:LibraryBook):boolean {
 return book.inReadingLibrary??(!book.zotero||!book.id.startsWith('zotero-'));
}

export function libraryBooksForMode(data:Notebook,mode:LibraryMode):LibraryBook[] {
 return data.libraryBooks.filter(book=>mode==='reading'?isReadingBook(book):!!book.zotero);
}

export function collectionIdentity(serverId:string,key:string):string {
 return `zotero-collection:${encodeURIComponent(serverId)}:${encodeURIComponent(key)}`;
}

/** Keep the source snapshot intact; repair broken parent links only for display. */
export function zoteroCollectionTree(data:Notebook):ZoteroCollectionNode[] {
 const nodes=new Map<string,ZoteroCollectionNode>();
 for(const collection of normalizeZoteroCollections(data.zoteroCollections)){
  const id=collectionIdentity(collection.serverId,collection.key);
  nodes.set(id,{...collection,id,children:[],bookIds:[],directBookIds:[],count:0,directCount:0});
 }
 const parents=new Map<string,string>();
 for(const node of nodes.values()){
  if(!node.parentKey)continue;
  const parentId=collectionIdentity(node.serverId,node.parentKey);
  if(parentId!==node.id&&nodes.has(parentId))parents.set(node.id,parentId);
 }
 // An iterative walk handles deep or cyclic source hierarchies without recursion.
 const finished=new Set<string>();
 for(const id of nodes.keys()){
  const path:string[]=[],positions=new Map<string,number>();
  let current:string|undefined=id;
  while(current!==undefined&&!finished.has(current)){
   const cycleStart=positions.get(current);
   if(cycleStart!==undefined){
    parents.delete(path.slice(cycleStart).sort()[0]);
    break;
   }
   positions.set(current,path.length);path.push(current);current=parents.get(current);
  }
  path.forEach(entry=>finished.add(entry));
 }
 const roots:ZoteroCollectionNode[]=[];
 for(const node of nodes.values()){
  const parentId=parents.get(node.id);
  if(parentId)nodes.get(parentId)!.children.push(node);
  else roots.push(node);
 }
 const order=new Map(data.libraryBooks.map((book,index)=>[book.id,index]));
 const bookSets=new Map([...nodes.keys()].map(id=>[id,new Set<string>()]));
 for(const book of libraryBooksForMode(data,'zotero')){
  for(const key of book.zotero!.collections){
   const node=nodes.get(collectionIdentity(book.zotero!.serverId,key));
   if(node)bookSets.get(node.id)!.add(book.id);
  }
 }
 const pending=new Map<string,number>(),queue:ZoteroCollectionNode[]=[];
 const sortNodes=(a:ZoteroCollectionNode,b:ZoteroCollectionNode)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
 roots.sort(sortNodes);
 for(const node of nodes.values()){
  node.children.sort(sortNodes);
  node.directBookIds=[...bookSets.get(node.id)!];node.directCount=node.directBookIds.length;
  pending.set(node.id,node.children.length);
  if(!node.children.length)queue.push(node);
 }
 for(let i=0;i<queue.length;i++){
  const node=queue[i],books=bookSets.get(node.id)!;
  node.bookIds=[...books].sort((a,b)=>order.get(a)!-order.get(b)!);node.count=node.bookIds.length;
  const parentId=parents.get(node.id);
  if(!parentId)continue;
  for(const bookId of books)bookSets.get(parentId)!.add(bookId);
  const remaining=pending.get(parentId)!-1;pending.set(parentId,remaining);
  if(!remaining)queue.push(nodes.get(parentId)!);
 }
 return roots;
}

export function libraryBooksForZoteroCollection(data:Notebook,id:string|null):LibraryBook[] {
 const books=libraryBooksForMode(data,'zotero');
 if(id===null)return books;
 if(id===''){
  const known=new Set(normalizeZoteroCollections(data.zoteroCollections).map(collection=>collectionIdentity(collection.serverId,collection.key)));
  return books.filter(book=>!book.zotero!.collections.some(key=>known.has(collectionIdentity(book.zotero!.serverId,key))));
 }
 const queue=zoteroCollectionTree(data);
 for(let i=0;i<queue.length;i++){
  const node=queue[i];
  if(node.id===id){const ids=new Set(node.bookIds);return books.filter(book=>ids.has(book.id));}
  queue.push(...node.children);
 }
 return [];
}

export type ZoteroCatalogItem = {
 itemKey:string;
 itemVersion:number;
 itemType:string;
 title:string;
 author:string;
 format:LibraryBook['format'];
 storedFile:string;
 originalName:string;
 addedAt:string;
 attachmentKey?:string;
 date?:string;
 publisher?:string;
 doi?:string;
 isbn?:string;
 collections:string[];
 annotations:ZoteroAnnotation[];
 sourceAvailable?:boolean;
};
export type ZoteroCatalog = {
 serverId:string;
 library?:'users/0';
 items:ZoteroCatalogItem[];
 collections?:{key:string;name:string;parentKey?:string}[];
 warnings?:string[];
 connected?:boolean;
};

/** Also used as the dismissedSuggestions key when removing an imported item. */
export function zoteroIdentity(serverId:string,itemKey:string):string {
 return `zotero:${encodeURIComponent(serverId)}:${encodeURIComponent(itemKey)}`;
}

function stable(value:unknown):unknown {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,stable(entry)]));
 return value;
}
function equal(a:unknown,b:unknown):boolean {return JSON.stringify(stable(a))===JSON.stringify(stable(b));}

// Small deterministic IDs work offline and keep the notebook's 100-character ID limit.
function bookId(identity:string):string {
 let first=2166136261,second=2246822507;
 for(let i=0;i<identity.length;i++){
  first=Math.imul(first^identity.charCodeAt(i),16777619);
  second=Math.imul(second^identity.charCodeAt(i),3266489909);
 }
 return `zotero-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}

function mergeAnnotations(previous:ZoteroAnnotation[],incoming:ZoteroAnnotation[]):ZoteroAnnotation[] {
 const entries=new Map(incoming.map(entry=>[`${entry.attachmentKey}:${entry.key}`,{...entry}]));
  // Source deletions do not erase previously collected material from the notebook.
 for(const entry of previous){const key=`${entry.attachmentKey}:${entry.key}`;if(!entries.has(key))entries.set(key,entry);}
 // Incoming annotations already follow Zotero's document position, including same-page order.
 return [...entries.values()];
}

/** Source metadata stays separate from the user's readings, interpretations and questions. */
export function mergeZoteroCatalog(data:Notebook,catalog:ZoteroCatalog):{data:Notebook;changed:boolean;added:number;updated:number} {
 if(!catalog.serverId?.trim()||catalog.connected===false)return {data,changed:false,added:0,updated:0};
 const books=[...data.libraryBooks];
 const identities=new Map<string,number>();
 books.forEach((book,index)=>{if(book.zotero)identities.set(zoteroIdentity(book.zotero.serverId,book.zotero.itemKey),index);});
 const ignored=new Set(data.dismissedSuggestions);
 const usedIds=new Set(books.map(book=>book.id));
 const seen=new Set<string>();
 let added=0,updated=0;
 for(const item of catalog.items){
  if(!item.itemKey?.trim())continue;
  const identity=zoteroIdentity(catalog.serverId,item.itemKey);
  if(ignored.has(identity)||(item.attachmentKey&&ignored.has(zoteroIdentity(catalog.serverId,item.attachmentKey)))||seen.has(identity))continue;
  seen.add(identity);
  let index=identities.get(identity);
  // The connector compares file hashes before reusing a storedFile. Never merge by title.
  if(index===undefined&&item.storedFile)index=books.findIndex(book=>!book.zotero&&book.storedFile===item.storedFile);
  if(index===-1)index=undefined;
  // Retrieving metadata in Zotero turns a standalone attachment into a child of
  // a new bibliography item. It is still the same physical book in this library.
  if(index===undefined&&item.storedFile&&item.attachmentKey){
   const standaloneIndex=books.findIndex(book=>book.storedFile===item.storedFile&&book.zotero?.serverId===catalog.serverId&&book.zotero.itemKey===item.attachmentKey&&book.zotero.attachmentKey===item.attachmentKey);
   if(standaloneIndex>=0)index=standaloneIndex;
  }
  const previous=index===undefined?undefined:books[index];
  const oldSource=previous?.zotero;
  const retainedAttachment=previous&&previous.format!=='reference'&&previous.storedFile?oldSource?.attachmentKey:undefined;
  const source:ZoteroSource={
   serverId:catalog.serverId,library:catalog.library||'users/0',itemKey:item.itemKey,
   attachmentKey:retainedAttachment||item.attachmentKey,itemVersion:item.itemVersion,itemType:item.itemType,
   title:item.title,date:item.date,publisher:item.publisher,doi:item.doi,isbn:item.isbn,
   collections:[...new Set(item.collections)].sort(),
   annotations:mergeAnnotations(oldSource?.annotations||[],item.annotations),sourceAvailable:item.sourceAvailable!==false,
  };
  if(previous){
   // Existing originals and their progress stay paired. A reference can acquire its first file.
   const acquireFile=previous.format==='reference'&&item.format!=='reference'&&!!item.storedFile;
   const next:LibraryBook={...previous,inReadingLibrary:isReadingBook(previous),zotero:source,...(acquireFile?{format:item.format,storedFile:item.storedFile,originalName:item.originalName}:{})};
   if(!equal(previous,next)){books[index!]=next;updated++;}
   identities.set(identity,index!);
  }else{
   let id=bookId(identity),suffix=2;
   while(usedIds.has(id))id=`${bookId(identity)}-${suffix++}`;
   usedIds.add(id);
   const hasFile=item.format!=='reference'&&!!item.storedFile;
   books.push({id,title:item.title||item.originalName||'未命名文献',author:item.author||'',format:hasFile?item.format:'reference',storedFile:hasFile?item.storedFile:'',originalName:item.originalName||item.title||item.itemKey,addedAt:item.addedAt,progress:{},zotero:source,inReadingLibrary:false});
   identities.set(identity,books.length-1);
   added++;
  }
 }
 // Absence means an incomplete/older connector response; an empty array is a
 // complete snapshot and removes this source's obsolete collection definitions.
 const collections=catalog.collections===undefined?data.zoteroCollections:normalizeZoteroCollections([
  ...(data.zoteroCollections||[]).filter(collection=>collection.serverId!==catalog.serverId),
  ...catalog.collections.map(collection=>({...collection,serverId:catalog.serverId})),
 ]);
 const collectionsChanged=catalog.collections!==undefined&&!equal(normalizeZoteroCollections(data.zoteroCollections),collections||[]);
 const changed=added+updated>0||collectionsChanged;
 return {data:changed?{...data,libraryBooks:books,...(collectionsChanged?{zoteroCollections:collections}:{})}:data,changed,added,updated};
}
