export type SharedSelectionKey='Alt'|'Meta';
export type ReaderShortcuts={sharedSelection:SharedSelectionKey};
export const defaultReaderShortcuts:ReaderShortcuts={sharedSelection:'Alt'};
export function normalizeReaderShortcuts(value:unknown):ReaderShortcuts{
 const candidate=value as Partial<ReaderShortcuts>|null;
 return {sharedSelection:candidate?.sharedSelection==='Meta'?'Meta':'Alt'};
}
export function sharedSelectionKeyLabel(key:SharedSelectionKey){const mac=typeof navigator==='undefined'||/Mac|iPhone|iPad/.test(navigator.platform);return key==='Meta'?(mac?'⌘ Command':'Windows 键'):(mac?'⌥ Option':'Alt');}
export function sharedSelectionPressed(event:{altKey?:boolean;metaKey?:boolean;shiftKey?:boolean;ctrlKey?:boolean}|undefined,key:SharedSelectionKey){
 if(!event||event.ctrlKey||event.shiftKey)return false;
 return key==='Meta'?!!event.metaKey&&!event.altKey:!!event.altKey&&!event.metaKey;
}
// PDF panes share a document while EPUB panes use their own same-origin frames.
// Clear transient selections in both before the next drag; saved sources live
// in the comparison draft and are independent of the browser Selection.
export function clearReaderSelections(doc:Document){
 doc.getSelection()?.removeAllRanges();
 for(const frame of Array.from(doc.querySelectorAll('iframe')))try{frame.contentDocument?.getSelection()?.removeAllRanges();}catch{/* Other origins do not belong to the reader. */}
}
