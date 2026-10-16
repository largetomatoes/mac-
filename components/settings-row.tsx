'use client';
import type {ReactNode} from 'react';
import {ChevronRight} from 'lucide-react';
export function SettingsRow({title,description,icon,onClick,badge}:{title:string;description:string;icon:ReactNode;onClick:()=>void;badge?:ReactNode}){
 return <button type="button" className="settings-row" aria-label={title} onClick={onClick}><span className="settings-row-icon" aria-hidden="true">{icon}</span><span className="settings-row-copy"><strong>{title}</strong><small>{description}</small></span>{badge}<ChevronRight className="settings-row-arrow" size={16} aria-hidden="true"/></button>;
}
