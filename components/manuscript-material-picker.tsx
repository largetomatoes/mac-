'use client';
import {useMemo,useState} from 'react';
import {ArrowDown,ArrowUp,Check,Search,X,ChevronRight,ArrowLeft} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {collectMaterials,materialKindLabel,type Material,type MaterialCatalog} from '@/lib/manuscript-materials';
type Props={catalog:MaterialCatalog;usedKeys:string[];onClose:()=>void;onAdd:(materials:Material[])=>void};
const scopeKinds={question:'问题',cross:'交叉思考',card:'卡片',book:'书籍',chapter:'章节'};
export function ManuscriptMaterialPicker({catalog,usedKeys,onClose,onAdd}:Props){
 const [scopeIds,setScopeIds]=useState<string[]>([]),[active,setActive]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[scopeSearch,setScopeSearch]=useState(''),[textSearch,setTextSearch]=useState('');
 const used=useMemo(()=>new Set(usedKeys),[usedKeys]);
 const materials=useMemo(()=>collectMaterials(catalog,scopeIds),[catalog,scopeIds]);
 const selectedMaterials=materials.filter(item=>selected.includes(item.key)&&!used.has(item.key));
 const activeScope=catalog.scopes.find(scope=>scope.id===active);
 const shown=materials.filter(item=>(!active||item.scopeIds.includes(active))&&(!textSearch.trim()||[item.text,item.label,item.citation].join(' ').toLocaleLowerCase().includes(textSearch.trim().toLocaleLowerCase())));
 const available=shown.filter(item=>!used.has(item.key));
 const children=catalog.scopes.filter(scope=>scope.parentId===active);
 function addScope(id:string){setScopeIds(ids=>ids.includes(id)?ids:[...ids,id]);setActive(id);setTextSearch('');}
 function removeScope(id:string){const next=scopeIds.filter(value=>value!==id);setScopeIds(next);let ancestor=active;const seen=new Set<string>();while(ancestor&&!seen.has(ancestor)){seen.add(ancestor);if(ancestor===id){setActive(next[0]||null);return;}ancestor=catalog.scopes.find(scope=>scope.id===ancestor)?.parentId||null;}if(!next.length)setActive(null);}
 function reorder(id:string,delta:number){setScopeIds(ids=>{const i=ids.indexOf(id),target=i+delta;if(target<0||target>=ids.length)return ids;const next=[...ids];[next[i],next[target]]=[next[target],next[i]];return next;});}
 return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogContent className="material-picker-dialog">
 <DialogTitle>整理成文</DialogTitle><DialogDescription>选择来源，点击上方名称分别浏览原话。</DialogDescription>
 <div className="material-picker-layout"><aside className="material-scopes"><div className="material-picker-search"><Search size={15}/><Input aria-label="查找板块或书籍" value={scopeSearch} onChange={e=>setScopeSearch(e.target.value)} placeholder="找问题或书籍"/></div>
 <div className="material-scope-list">{catalog.scopes.filter(scope=>scopeSearch.trim()?scope.label.toLocaleLowerCase().includes(scopeSearch.trim().toLocaleLowerCase()):!scope.parentId).map(scope=><button type="button" className={'material-scope-button'+(scopeIds.includes(scope.id)?' is-selected':'')} key={scope.id} aria-pressed={scopeIds.includes(scope.id)} onClick={()=>addScope(scope.id)}><span>{scopeKinds[scope.kind]}</span><strong>{scope.label}</strong></button>)}</div></aside>
 <section className="material-candidates"><div className="material-selection-order" aria-label="已选板块顺序">{scopeIds.map((id,index)=><div key={id} className={active===id?'is-active':''}><button type="button" className="material-source-tab" aria-pressed={active===id} onClick={()=>{setActive(id);setTextSearch('');}}>{index+1}. {catalog.scopes.find(scope=>scope.id===id)?.label}</button><button type="button" aria-label={'前移板块 '+(index+1)} disabled={index===0} onClick={()=>reorder(id,-1)}><ArrowUp size={13}/></button><button type="button" aria-label={'后移板块 '+(index+1)} disabled={index===scopeIds.length-1} onClick={()=>reorder(id,1)}><ArrowDown size={13}/></button><button type="button" aria-label={'移除板块 '+(index+1)} onClick={()=>removeScope(id)}><X size={13}/></button></div>)}</div>
 {activeScope&&<div className="material-breadcrumb">{activeScope.parentId&&<Button type="button" variant="ghost" size="sm" onClick={()=>setActive(activeScope.parentId!)}><ArrowLeft/>返回上层</Button>}<strong>{activeScope.label}</strong></div>}
 {!!children.length&&<div className="material-child-scopes" aria-label="下属问题与章节">{children.map(scope=><button type="button" key={scope.id} onClick={()=>{setActive(scope.id);setTextSearch('');}}>{scope.label}<ChevronRight size={14}/></button>)}</div>}
 {scopeIds.length>0&&<div className="material-picker-search"><Input aria-label="查找材料原文" placeholder="在当前来源中查找" value={textSearch} onChange={e=>setTextSearch(e.target.value)}/><Button size="sm" variant="ghost" type="button" disabled={!available.length} onClick={()=>setSelected(ids=>[...new Set([...ids,...available.map(item=>item.key)])])}>选中当前列表</Button><Button size="sm" variant="ghost" type="button" onClick={()=>setSelected(ids=>ids.filter(id=>!shown.some(item=>item.key===id)))}>清空当前选择</Button></div>}
 <div className="material-snippets" key={active}>{shown.map(item=><label className={'material-snippet'+(selected.includes(item.key)?' is-selected':'')+(used.has(item.key)?' is-used':'')} key={item.key}><input type="checkbox" aria-label={'选入'+materialKindLabel[item.kind]+'：'+item.text.slice(0,40)} disabled={used.has(item.key)} checked={selected.includes(item.key)&&!used.has(item.key)} onChange={()=>setSelected(ids=>ids.includes(item.key)?ids.filter(id=>id!==item.key):[...ids,item.key])}/><div><div className="material-snippet-meta"><strong>{materialKindLabel[item.kind]}</strong>{item.at&&<time>{new Date(item.at).toLocaleDateString('zh-CN')}</time>}{used.has(item.key)&&<span>已在文稿中</span>}</div><small>{item.label}</small><p className={item.kind==='quote'?'is-quote':''}>{item.text}</p>{item.citation&&<small>{item.citation}</small>}{item.reason&&<small>修改原因：{item.reason}</small>}</div></label>)}{!scopeIds.length&&<p className="assembly-empty">选择一个问题或书籍开始。</p>}{scopeIds.length>0&&!shown.length&&<p className="assembly-empty">当前来源没有匹配的材料。</p>}</div></section></div>
 <footer className="material-picker-footer"><span>共选 {selectedMaterials.length} 段 · {selectedMaterials.reduce((sum,item)=>sum+item.text.length,0).toLocaleString()} 字</span><div><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button type="button" disabled={!selectedMaterials.length} onClick={()=>onAdd(selectedMaterials)}><Check/>加入文稿（{selectedMaterials.length} 段）</Button></div></footer>
 </DialogContent></Dialog>;
}
