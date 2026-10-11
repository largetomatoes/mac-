'use strict';

function detachThoughtBook(entry,bookId,replacementId,remainingIds){
 if(!entry.sources?.length){
  if(entry.libraryBookId!==bookId)return entry;
  if(replacementId)return {...entry,libraryBookId:replacementId};
  const kept={...entry};delete kept.libraryBookId;delete kept.sourceLocation;return kept;
 }
 // Preserve quotes, chapter labels and stable missing IDs. A removed original
 // must not detach a shared thought from its other book or erase its history.
 const sources=entry.sources.map(source=>source.libraryBookId===bookId&&replacementId?{...source,libraryBookId:replacementId}:source);
 const first=sources.find(source=>remainingIds?remainingIds.includes(source.libraryBookId):source.libraryBookId!==bookId||replacementId);
 const kept={...entry,sources};
 if(first)return {...kept,libraryBookId:first.libraryBookId,bookTitle:first.bookTitle,chapter:first.chapter,locator:first.locator,sourceLocation:first.sourceLocation,quote:first.quote};
 delete kept.libraryBookId;delete kept.sourceLocation;return kept;
}
module.exports={detachThoughtBook};
