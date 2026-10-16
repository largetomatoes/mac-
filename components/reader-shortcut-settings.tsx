'use client';
import {useEffect,useState} from 'react';
import {Keyboard} from 'lucide-react';
import {useReaderShortcuts} from '@/hooks/use-reader-shortcuts';
import {sharedSelectionKeyLabel,type SharedSelectionKey} from '@/lib/reader-shortcuts';
import {SettingsRow} from './settings-row';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
export function ReaderShortcutSettings(){
 const prefs=useReaderShortcuts(),[open,setOpen]=useState(false),[chosen,setChosen]=useState<SharedSelectionKey>('Alt'),[saving,setSaving]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(open){setChosen(prefs.value.sharedSelection);setError('');}},[open,prefs.value]);
 async function commit(){setSaving(true);setError('');try{await prefs.save({sharedSelection:chosen});setOpen(false);}catch(cause){setError((cause as Error).message);}finally{setSaving(false);}}
 return <><SettingsRow title="共同选文按键" description={`${sharedSelectionKeyLabel(prefs.value.sharedSelection)} · 分别拖选两本书中的句子`} icon={<Keyboard size={19}/>} onClick={()=>setOpen(true)}/><Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}><DialogContent className="reader-shortcuts-dialog"><DialogTitle>共同选文按键</DialogTitle><DialogDescription>对照阅读时，按住所选按键，在左、右栏分别拖选一句话。每次选文独立保留；松开按键后可照常做单本笔记。</DialogDescription><fieldset><legend>选择按键</legend>{(['Alt','Meta'] as const).map(key=><label key={key}><input type="radio" name="shared-selection-key" value={key} checked={chosen===key} disabled={saving} onChange={()=>setChosen(key)}/><kbd>{sharedSelectionKeyLabel(key)}</kbd><span>{key==='Alt'?'默认':'可选'}</span></label>)}</fieldset><p className="reader-shortcuts-tip">Shift 容易触发系统扩选，因此这里使用 Option 或 Command。也可以普通选文后，从“选文更多操作”选择“加入共同过程笔记”。</p>{(error||prefs.error)&&<p role="alert">{error||prefs.error}</p>}<footer><Button variant="ghost" disabled={saving} onClick={()=>setOpen(false)}>取消</Button><Button disabled={saving||!prefs.ready} onClick={()=>void commit()}>{saving?'保存中…':'保存按键'}</Button></footer></DialogContent></Dialog></>;
}
