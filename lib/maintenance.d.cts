export type MaintenanceTarget={kind:'highlight'|'process'|'reading'|'card'|'reply'|'thought'|'zotero';id:string;bookId?:string};
export function removeRecord(data:import('./notebook').Notebook,target:MaintenanceTarget):import('./notebook').Notebook;
