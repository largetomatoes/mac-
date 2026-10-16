'use client';
import {useRef,useState} from 'react';
import {BookOpen} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {SettingsRow} from './settings-row';
const topics=[
 {title:'从问题开始',lead:'一个问题页，容纳一个中心问题，以及你逐渐写下的子问题、回答和联系。',steps:['在主页下方点击“＋”增加问题页。可以从小问题开始，之后再建立更大的汇总页。','点击图中的问题，在展开的窗口写下当前判断，或添加子问题、回答与“后来想到的”记录。','问题判断发生变化时，修改并写下原因；旧表述与原时间会保留在修改记录中。']},
 {title:'重新整理问题页',lead:'在新页调整组织，保留原页当时的思考结构。',steps:['在问题页签的“…”里选择“基于此页重新整理”；也可以从“全部问题页”选择已有页面进行汇总。','在“整理本页结构”中取用整页或分支，选择目标上级，移动并调整顺序，编号由本页位置计算。整张旧页也能放到一个小问题下面。','保存前可预览和撤销操作。原页上级和顺序保持原样；同一问题的正文、笔记相通。','原页后来增加的分支不会自动插入整理页，需要你主动纳入。']},
 {title:'卡片集与卡片架',lead:'想法还没归位，也可以先完整记下来。',steps:['点击右上角“卡片集”，在“记下一张卡片”中选择“想法”或“问题”，保留原话与来源。','卡片正文可以修改，旧表述仍能回看。自定义标签、搜索、类型和入图状态用于筛选；放大按钮切换为卡片架。','打开一张卡片，在“选择去向”中把它作为已有问题的材料，或基于它建立新问题。原卡片始终保留，也可以去往不同的问题页。','“链接建议”列出文字线索，由你选择连接或忽略；建议不会自动改变问题图。']},
 {title:'阅读与过程笔记',lead:'从原文出发，写下这一刻的理解，并能回到原文。',steps:['书库里选择“读书”或“Zotero”。读书可导入 PDF、EPUB；Zotero 读取本机文献、分类与批注，已有原件可直接阅读。','选中文字，使用旁边的过程笔记入口写注解。原摘录、来源、记录时间保留，自己的注解可修订。','过程笔记可以关联问题。相邻批注聚合显示，悬停预览，点击后分别查看；书内笔记可返回原文。','扫描 PDF 自动识别当前页；识别不准时可重新识别，并核对摘录。']},
 {title:'章节与读书笔记',lead:'书内的注解和自己的读书思考，按书籍、章节一起找回。',steps:['EPUB 自动记录章节。PDF 章节自行填写；后续顺序阅读沿用所记住的章节，新章节可再次更改。','“本书笔记”可以记录全书或章节思考。读书笔记既可基于选文，也可以不选原文直接记录。','书库搜索能查找书名、作者、过程笔记、读书思考和 Zotero 批注；结果可以按章节筛选。','PDF 左右方向键翻页，翻页保持缩放与页面位置；输入文字时不会触发翻页。']},
 {title:'两本书共同思考',lead:'两处原文、一条自己的注解，保留各自的出处与章节。',steps:['在阅读工具栏进入“对照阅读”，选择另一份读书或 Zotero 文献。PDF 和 EPUB 可组合阅读。','默认按住 ⌥ Option，在一栏拖选一句，再到另一栏拖选一句；每本可取多段。设置 → 共同选文按键可改为 ⌘ Command。选文后松开按键，不会丢失已收集的句子。','核对收集的选段，写共同过程笔记，按需关联问题。保存后从两本书的对应章节都能找到同一条记录。','共同笔记会展开原文，各段可单独填写章节。不引用原文时，可从共同笔记面板选择“不选原文，记录共同思考”。普通选文后也可从“选文更多操作”加入共同过程笔记。']},
 {title:'整理、归档与恢复',lead:'有些位置没有“删除”，是为了留下思考的形成过程。你可以按整理目的选择不同操作。',steps:['只想调整问题的上下级或顺序：基于原页重新整理。在整理页中“仅移出本页及其分支”，会保留原问题和其他页面的位置。','不想在日常视图看到某个原问题：在其“更多操作”中归档。归档会在引用它的所有页面隐藏原问题及相应分支，原文与联系保留。','整理卡片、过程笔记、读书思考、高亮等：设置 → 资料维护 → 整理笔记与标注。筛选、勾选需要的记录，检查范围后归档；可选择不相邻的记录。','恢复内容：进入资料维护的“归档与旧版恢复”，查看归档原文后点击恢复。原记录会重新出现，不覆盖后来新增的内容。','只想断开一条手动联系：打开记录下方“联系”，点击解除联系。只隐藏 Zotero 来源时，仅影响问间中的显示。','卡片想法变化时可以直接编辑并留下旧表述；书籍归档会保留原件和笔记。永久清除仅在部分深层维护入口提供，不能当作普通整理方式。'],tip:'归档记录、移出本页、解除联系的影响范围不同。操作前先核对范围；重要整理前先做完整备份。'},
 {title:'备份与恢复',lead:'完整备份包括笔记、批注、草稿与书籍原件。',steps:['使用应用菜单中的完整备份功能保存本机副本。普通 JSON 备份可能不包含原书，应按备份说明核对。','设置中的“完整云备份”可管理已配置云服务的备份与恢复。','恢复前核对备份的时间、来源和书籍范围；先保存当前资料的完整备份，再进行恢复。','不同版本的资料格式可能不同。同步状态与可用操作请以“同步与连接”中的实际提示为准。']},
 {title:'回看与常用操作',lead:'时间记录帮助你找回想法产生时的阶段。',steps:['左上角“修改记录”汇总内容修订、结构调整与关联变化，点击记录可返回所属内容。','普通阅读笔记的修改原因可选，问题判断修订需要填写原因。创建时间与修改时间分别保留。','⌘ , 打开设置。书籍和文件夹列表支持触控板滚动，也可以拖动右侧滚动条。','阅读的更多操作可旋转 PDF、重新识别文字、导出批注版、编辑书目信息和标记读完。']},
];
export function UsageGuide({settingsEntry=false}:{settingsEntry?:boolean}){
 const [open,setOpen]=useState(false),[topic,setTopic]=useState(0);const body=useRef<HTMLElement>(null),current=topics[topic];
 return <>{settingsEntry?<SettingsRow title="使用说明" description="记录、阅读、重组与归档恢复" icon={<BookOpen size={19}/>} onClick={()=>setOpen(true)}/>:<Button variant="outline" onClick={()=>setOpen(true)}>使用说明</Button>}<Dialog open={open} onOpenChange={setOpen}><DialogContent className="usage-guide guide-redesigned"><header className="guide-heading"><DialogTitle>问间使用说明</DialogTitle><DialogDescription>从自己的问题出发，留下原话、来源和思考的过程。</DialogDescription></header><div className="guide-layout"><nav className="guide-topics" aria-label="使用说明目录">{topics.map((item,index)=><button type="button" key={item.title} aria-current={topic===index?'true':undefined} onClick={()=>{setTopic(index);body.current?.scrollTo(0,0);}}>{item.title}</button>)}</nav><article ref={body} className="guide-article" tabIndex={0} aria-label={current.title}><h2>{current.title}</h2><p className="guide-lead">{current.lead}</p><ol>{current.steps.map(text=><li key={text}>{text}</li>)}</ol>{current.tip&&<p className="guide-tip">{current.tip}</p>}</article></div></DialogContent></Dialog></>;
}
