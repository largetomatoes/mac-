import type {Notebook} from './notebook';
import type {MaintenanceTarget,TrashEntry} from './maintenance.cjs';
export type ArchiveTarget=MaintenanceTarget|{kind:'question'|'cross'|'book';id:string};
export function archiveRecords(data:Notebook,targets:ArchiveTarget[],options?:{at?:string;batchId?:string}):Notebook;
export function archiveQuestionBranch(data:Notebook,id:string,options?:{at?:string;batchId?:string}):Notebook;
export function restoreArchived(data:Notebook,batchId:string,at?:string):Notebook;
export function archiveGroups(data:Notebook):(TrashEntry & {archive:true})[];
export function visibleNotebook(data:Notebook):Notebook;
export function purgeArchiveBatch(data:Notebook,batchId:string,remove:(data:Notebook,targets:MaintenanceTarget[],options?:{preserveThoughts?:boolean})=>Notebook):Notebook;
