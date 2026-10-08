import type {Notebook,OcrCacheEntry} from './notebook';
export function validOcrEntry(value:unknown):value is OcrCacheEntry;
export function mergeOcrPage(data:Notebook,entry:OcrCacheEntry):Notebook;
