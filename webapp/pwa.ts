export type WebAppState={offline:boolean;ready:boolean;update:ServiceWorker|null;error:string};
let state:WebAppState={offline:!navigator.onLine,ready:false,update:null,error:''};
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
export const subscribeWebState=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const getWebState=()=>state;
export function installPwa(){
 document.documentElement.dataset.wenjianWeb='true';
 for(const type of ['online','offline'])window.addEventListener(type,()=>{state={...state,offline:!navigator.onLine};emit();});
 if(!('serviceWorker' in navigator)){state={...state,error:'当前浏览器不支持离线应用，请使用更新版本的 Safari。'};emit();return;}
 let registering=false;
 const register=async()=>{if(registering)return;registering=true;try{const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});state={...state,ready:!!registration.active,update:registration.waiting};emit();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){state={...state,ready:true,update:navigator.serviceWorker.controller?worker:null};emit();}});});}catch{state={...state,error:'离线资源暂未准备完成，请联网后重新打开。'};emit();}finally{registering=false;}};
 window.addEventListener('load',()=>void register(),{once:true});
 if(document.readyState==='complete')void register();
}
export function applyWebUpdate(){if(!state.update)return;let requested=false;const reload=()=>{if(requested)return;requested=true;location.reload();};navigator.serviceWorker.addEventListener('controllerchange',reload,{once:true});state.update.postMessage({type:'ACTIVATE_UPDATE'});}
