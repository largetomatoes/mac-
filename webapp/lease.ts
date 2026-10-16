import {dbGet,dbPut,dbDelete} from './storage';
import {identity} from './nutstore';
// A browser lock is held for the entire sync. It disappears if the tab dies;
// only then may another tab recover this exact locally persisted task token.
let release:(()=>void)|undefined;
export async function beginWebLease(target:string,owner:string){let unlock:(()=>void)|undefined;let readyResolve:(()=>void)|undefined;let readyReject:((error:unknown)=>void)|undefined;const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});void navigator.locks.request('wenjian-web-cloud-sync',{ifAvailable:true},async lock=>{if(!lock){readyReject?.(Error('此浏览器的另一个窗口正在同步，请稍后重试。'));return;}await new Promise<void>(resolve=>{unlock=resolve;readyResolve?.();});}).catch(error=>readyReject?.(error));await ready;release=unlock;
 try{const old=await dbGet<{target:string;owner:string}>('web-sync-task');await dbPut('web-sync-task',{target,owner,at:Date.now()});return {recoverableOwners:old?.target===target?[old.owner]:[],deviceName:(await identity()).deviceName};}catch(error){release?.();release=undefined;throw error;}}
export async function endWebLease(target:string,owner:string,released:boolean){try{const old=await dbGet<{target:string;owner:string}>('web-sync-task');if(released&&old?.target===target&&old.owner===owner)await dbDelete('web-sync-task');}finally{release?.();release=undefined;}}
