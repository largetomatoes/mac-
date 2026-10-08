'use client';
import {useMemo,useState} from 'react';
import {ArrowDown,ArrowUp,Check,Search,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {collectMaterials,materialKindLabel,type Material,type MaterialCatalog} from '@/lib/manuscript-materials';

type Props={catalog:MaterialCatalog;usedKeys:string[];onClose:()=>void;onAdd:(materials:Material[])=>void};
const scopeKinds={question:'问题',cross:'交叉思考',card:'卡片',book:'书籍'};
export function ManuscriptMaterialPicker({catalog,usedKeys,onClose,onAdd}:Props){
 const [scopeIds,setScopeIds]=useState<string[]>([]),[selected,setSelected]=useState<string[]>([]),[scopeSearch,setScopeSearch]=useState(''),[textSearch,setTextSearch]=useState('');
 const used=useMemo(()=>new Set(usedKeys),[usedKeys]);
 const materials=useMemo(()=>collectMaterials(catalog,scopeIds),[catalog,scopeIds]);
 const selectedMaterials=materials.filter(item=>selected.includes(item.key)&&!used.has(item.key));
 const shown=materials.filter(item=>!textSearch.trim()||[item.text,item.label,item.citation].join('\n').toLocaleLowerCase().includes(textSearch.trim().toLocaleLowerCase()));
 const available=shown.filter(item=>!used.has(item.key));
 function toggleScope(id:string){setScopeIds(ids=>ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]);}
 function reorder(id:string,delta:number){setScopeIds(ids=>{const index=ids.indexOf(id),target=index+delta;if(target<0||target>=ids.length)return ids;const next=[...ids];[next[index],next[target]]=[next[target],next[index]];return next;});}
 return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogContent className="material-picker-dialog">
  <DialogTitle>整理成文</DialogTitle><DialogDescription>选择板块，再勾选要放入文稿的原话。选中的内容按板块顺序加入。</DialogDescription>
  <div className="material-picker-layout">
   <aside className="material-scopes"><div className="material-picker-search"><Search size={15}/><Input aria-label="查找板块或书籍" placeholder="查找板块或书籍" value={scopeSearch} onChange={event=>setScopeSearch(event.target.value)}/></div><div className="material-scope-list">{catalog.scopes.filter(scope=>!scopeSearch.trim()||scope.label.toLocaleLowerCase().includes(scopeSearch.trim().toLocaleLowerCase())).map(scope=><button type="button" className={'material-scope-button'+(scopeIds.includes(scope.id)?' is-selected':'')} key={scope.id} aria-pressed={scopeIds.includes(scope.id)} onClick={()=>toggleScope(scope.id)}><span>{scopeKinds[scope.kind]}{scopeIds.includes(scope.id)?` · ${scopeIds.indexOf(scope.id)+1}`:''}</span><strong>{scope.label}</strong></button>)}</div></aside>
   <section className="material-candidates">
    {scopeIds.length>0&&<div className="material-selection-order" aria-label="已选板块顺序">{scopeIds.map((id,index)=><div key={id}><span>{index+1}. {catalog.scopes.find(scope=>scope.id===id)?.label}</span><button type="button" aria-label={`前移板块 ${index+1}`} disabled={index===0} onClick={()=>reorder(id,-1)}><ArrowUp size={13}/></button><button type="button" aria-label={`后移板块 ${index+1}`} disabled={index===scopeIds.length-1} onClick={()=>reorder(id,1)}><ArrowDown size={13}/></button><button type="button" aria-label={`移除板块 ${index+1}`} onClick={()=>toggleScope(id)}><X size={13}/></button></div>)}</div>}
    {scopeIds.length>0&&<div className="material-picker-search"><Input aria-label="查找材料原文" placeholder="查找材料原文" value={textSearch} onChange={event=>setTextSearch(event.target.value)}/><Button size="sm" variant="ghost" type="button" disabled={!available.length} onClick={()=>setSelected(ids=>[...new Set([...ids,...available.map(item=>item.key)])])}>选中列表</Button><Button size="sm" variant="ghost" type="button" disabled={!selectedMaterials.length} onClick={()=>setSelected([])}>清空选择</Button></div>}
    <div className="material-snippets">{shown.map(item=><label className={'material-snippet'+(selected.includes(item.key)?' is-selected':'')+(used.has(item.key)?' is-used':'')} key={item.key}><input type="checkbox" aria-label={`选入${materialKindLabel[item.kind]}：${item.text.slice(0,40)}`} disabled={used.has(item.key)} checked={selected.includes(item.key)&&!used.has(item.key)} onChange={()=>setSelected(ids=>ids.includes(item.key)?ids.filter(id=>id!==item.key):[...ids,item.key])}/><div><div className="material-snippet-meta"><strong>{materialKindLabel[item.kind]}</strong>{item.at&&<time>{new Date(item.at).toLocaleDateString('zh-CN')}</time>}{used.has(item.key)&&<span>已在文稿中</span>}</div><small>{item.label}</small><p className={item.kind==='quote'?'is-quote':''}>{item.text}</p>{item.citation&&<small>{item.citation}</small>}{item.reason&&<small>修改原因：{item.reason}</small>}</div></label>)}{!scopeIds.length&&<p className="assembly-empty">选择要整理的问题、卡片或书籍。</p>}{scopeIds.length>0&&!shown.length&&<p className="assembly-empty">这里没有符合条件的材料。</p>}</div>
   </section>
  </div>
  <footer className="material-picker-footer"><span className="assembly-selection-summary">已选 {selectedMaterials.length} 段 · {selectedMaterials.reduce((sum,item)=>sum+item.text.length,0).toLocaleString()} 字</span><div><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button type="button" disabled={!selectedMaterials.length} onClick={()=>onAdd(selectedMaterials)}><Check/>加入文稿{selectedMaterials.length?`（${selectedMaterials.length} 段）`:''}</Button></div></footer>
 </DialogContent></Dialog>;
}
