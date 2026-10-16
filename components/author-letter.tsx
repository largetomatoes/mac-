'use client';
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {Mail} from 'lucide-react';
import {SettingsRow} from './settings-row';
import {readDraft,writeDraft} from '@/lib/draft-storage';
import './author-letter.css';

const readKey='author-letter:2026-10';
export function AuthorLetter(){
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;void readDraft<{readAt:string}|null>(readKey,null).then(value=>{if(!cancelled&&!value?.readAt)setOpen(true);}).catch(()=>{if(!cancelled)setOpen(true);});const show=()=>{setError('');setOpen(true);};window.addEventListener('wenjian:author-letter',show);return()=>{cancelled=true;window.removeEventListener('wenjian:author-letter',show);};},[]);
 async function close(){if(saving)return;setSaving(true);setError('');try{await writeDraft(readKey,{readAt:new Date().toISOString()});setOpen(false);}catch{setError('阅读状态暂未保存，可以稍后再试。');}finally{setSaving(false);}}
 return <Dialog open={open} onOpenChange={value=>{if(!value)void close();}}><DialogContent className="author-letter" showCloseButton={false} onOpenAutoFocus={event=>{event.preventDefault();}}>
  <header><span className="author-letter-eyebrow">问间 · 圆周率版</span><DialogTitle>一封给使用者的信</DialogTitle><DialogDescription>西林（sirens）</DialogDescription></header>
  <article className="author-letter-body" tabIndex={0} aria-label="给使用者的信正文">
   <p className="author-letter-greeting">你好！我是「问间」的作者西林（sirens），非常开心你能使用这款软件。</p>
   <p>萌生自己做一套笔记系统的念头已经很久了。面对市面上纷繁复杂的笔记软件，我挑花了眼，却始终觉得差点意思：第一，阅读与笔记的协同往往不够顺畅；第二，即便联动做好了，它们大多也只是“静态资料的仓库”，而非“动态思路的记录器”。</p>
   <p>因为一直找不到趁手的工具，这件事让我耿耿于怀。直到在准备《当代社会学前沿社会理论十讲》这门课的过程中，我读到了社会学家卢曼自建的“卡片盒系统”。书里说，卢曼的对理论的处理方式未必适合所有理论工作者；但我转念一想：如果不把目标定得那么宏大，仅仅借用卡片的逻辑，去安放我们日常阅读中那一小部分局部的思考呢？我觉得这是可行的，我们处理一些小的问题也是需要动用各种知识的！</p>
   <p>我觉得这条路完全可行。恰逢 AI 时代降低了开发门槛，我便直接动手把想法变成了现实。「问间」的核心设计很大程度上便源于此——帮你接住那些灵光一现的瞬间，并通过软件内的「问题图」将它们串联成网。</p>
   <p>在记录机制上，「问间」有两个看似固执的设计：</p>
   <p><strong>第一，关于思路的部分，我砍掉了“删除”功能，转而采用“旧版本归档”与“再组合”的方案。</strong> 卢曼在记录时从不丢弃错误的内容。这让我想到维特根斯坦写给友人的一段话：</p>
   <blockquote>“我宁愿要你那些未经修剪、未经雕琢的思想，哪怕它们显得干瘪或粗糙；我也绝不能容忍那种经过精心修饰、看似体面却骨子里不诚实的论调。”</blockquote>
   <p>我非常认同这种态度。那些看似“错误”、“粗糙”的念头，恰恰是我们思考演进的真实路标。与其为了版面的整洁而抹杀它们，不如将其归档留存，在未来的重组中赋予它们新的价值。</p>
   <p><strong>第二，我为所有记录都加上了精确的时间戳。</strong> 我希望每一次思考都有迹可循。当你回过头梳理脉络时，时间戳能帮你唤起当时的环境与状态——知道自己为何而想，对认识我们自己同样大有裨益。</p>
   <p>软件的开篇不宜冗长，关于具体的功能演示与后续更新，大家可以移步我的 Bilibili 观看操作视频。</p>
   <p>最后，我要郑重感谢我的舍友和网友。虽然最初只有寥寥数人，但当我带着点小得意把雏形展示给他们时，他们那种“我一定要用上”的迫切态度，给了我巨大的动力。没有他们的功能建议与发布指导，我大概很难坚持把它打磨到今天。</p>
   <p>「问间」是一款开源免费软件（当前版本为：<strong>问间·圆周率版</strong>），开源协议与代码均托管在我的 <a href="https://github.com/largetomatoes/wenjian-software/releases" target="_blank" rel="noreferrer">GitHub 发布页</a>，有需要的朋友完全可以按照自己的习惯去二次开发、定制功能。</p>
   <p>我们身处一个呼啸而来的 AI 时代。希望大家都能借助新的技术“搓”出称手的好工具；更希望「问间」能成为你阅读与思考的一片净土，祝你在这里有所收获，更好地发现自己！</p>
   <div className="author-letter-signature"><p>西林（sirens）</p><time dateTime="2026-10-16">2026年10月16日</time></div>
  </article>
  <footer><span>{error||'以后可在「设置 → 给使用者的信」重新阅读。'}</span><Button onClick={()=>void close()} disabled={saving}>{saving?'保存中…':'进入问间'}</Button></footer>
 </DialogContent></Dialog>;
}
export function AuthorLetterButton({settingsEntry=false}:{settingsEntry?:boolean}){const show=()=>window.dispatchEvent(new Event('wenjian:author-letter'));return settingsEntry?<SettingsRow title="给使用者的信" description="西林（sirens） · 2026年10月16日" icon={<Mail size={19}/>} onClick={show}/>:<Button variant="outline" onClick={show}>给使用者的信</Button>;}
