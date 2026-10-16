import type {Notebook,Note,ReadingNote,BookThought} from './notebook';
export function reviseQuestion(data:Notebook,id:string,title:string,body:string,reason:string,at=new Date().toISOString()):Notebook {
 const note=data.notes.find(n=>n.id===id);if(!note)throw Error('问题已变化。');if(!title.trim())throw Error('请保留问题标题。');if(!reason.trim())throw Error('请说明为什么修订这次判断。');
 if(note.title===title.trim()&&note.body===body)return data;
 const revision={title:note.title,nextTitle:title.trim(),body:note.body,origin:note.origin,source:note.source,reason:reason.trim(),at};
 return {...data,notes:data.notes.map(n=>n.id===id?{...n,title:title.trim(),body,modifiedAt:at,revisions:[...n.revisions,revision]}:n)};
}
export function reviseProcessNote(data:Notebook,id:string,text:string,reason='',at=new Date().toISOString()):Notebook {
 const note=data.readingNotes.find(n=>n.id===id);if(!note||!text.trim())throw Error('请保留笔记内容。');if(note.interpretation===text.trim())return data;
 return {...data,readingNotes:data.readingNotes.map(n=>n.id===id?{...n,interpretation:text.trim(),modifiedAt:at,revisions:[...(n.revisions||[]),{id:crypto.randomUUID(),text:n.interpretation,at,reason}]}:n)};
}
export function reviseBookThought(data:Notebook,id:string,text:string,reason='',at=new Date().toISOString()):Notebook {
 const note=data.bookThoughts.find(n=>n.id===id);if(!note||!text.trim())throw Error('请保留思考内容。');if(note.text===text.trim())return data;
 return {...data,bookThoughts:data.bookThoughts.map(n=>n.id===id?{...n,text:text.trim(),modifiedAt:at,revisions:[...(n.revisions||[]),{id:crypto.randomUUID(),text:n.text,sources:n.sources||[],questionIds:n.questionIds,at,reason}]}:n)};
}
