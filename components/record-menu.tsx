'use client';
import {MoreHorizontal} from 'lucide-react';
import type {MaintenanceTarget} from '@/lib/maintenance.cjs';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from './ui/dropdown-menu';
export function RecordMenu({target,label='记录'}:{target:MaintenanceTarget;label?:string}){return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="record-more" aria-label={'管理'+label}><MoreHorizontal size={17}/></button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={()=>window.dispatchEvent(new CustomEvent('wenjian:maintain',{detail:{target}}))}>在资料维护中处理</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;}
