'use client';
import {Cloud,HardDrive,ArchiveRestore} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {SettingsRow} from './settings-row';
import {ReaderShortcutSettings} from './reader-shortcut-settings';
import {UsageGuide} from './usage-guide';
import {AuthorLetterButton} from './author-letter';
import {AppUpdates} from './app-updates';
import './app-settings.css';
type Props={open:boolean;onOpenChange:(open:boolean)=>void;onSync:()=>void;onBackup:()=>void;onMaintenance:()=>void};
export function AppSettings({open,onOpenChange,onSync,onBackup,onMaintenance}:Props){
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="app-settings-dialog settings-redesigned"><header className="settings-heading"><span>问间</span><DialogTitle>设置</DialogTitle><DialogDescription className="sr-only">同步、备份、使用说明与资料维护。</DialogDescription></header><div className="settings-content">
  <section className="settings-section" aria-labelledby="settings-data"><h3 id="settings-data">资料与连接</h3><div className="settings-card"><SettingsRow title="同步与连接" description="管理坚果云、OSS 与连接状态" icon={<Cloud size={19}/>} onClick={onSync}/><SettingsRow title="完整云备份" description="保留笔记、书籍原件与草稿" icon={<HardDrive size={19}/>} onClick={onBackup}/></div></section>
  <section className="settings-section" aria-labelledby="settings-help"><h3 id="settings-help">使用与帮助</h3><div className="settings-card"><ReaderShortcutSettings/><UsageGuide settingsEntry/><AuthorLetterButton settingsEntry/><AppUpdates settingsEntry/></div></section>
  <details className="settings-advanced"><summary>资料维护<span>归档与恢复</span></summary><div className="settings-card"><SettingsRow title="整理笔记与标注" description="核对所选记录，再归档、隐藏或恢复" icon={<ArchiveRestore size={19}/>} onClick={onMaintenance}/></div><p>粗糙或暂时不用的想法，也可能是有价值的思考过程。归档后仍可找回原文与联系。</p></details>
 </div></DialogContent></Dialog>;
}
