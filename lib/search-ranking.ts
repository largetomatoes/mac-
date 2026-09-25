export type SearchField={text:string;normalized?:string;weight?:number;primary?:boolean};
export type SearchDocument={id:string;title:string;label:string;fields:SearchField[]};
export type SearchHit<T extends SearchDocument>=T&{score:number;excerpt:string};

const concepts=[
 ['诚实','真诚','坦诚','真实','说真话'],
 ['语言','言语','话语','说话','表达'],
 ['想法','思考','念头','思想','观点','看法'],
 ['联系','关联','关系','连接','接口'],
 ['世界','现实','外界','生活世界'],
 ['动机','意图','目的','意愿'],
 ['自己','自我','主体'],
 ['理解','解释','阐释'],
 ['矛盾','冲突','反驳','反例'],
];
const stops=new Set(['的','了','和','与','及','在','是','有','我','你','他','们','一个','一些','什么','如何','怎么','关于','那个','这个','里面','问题','笔记','记录']);
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
const clean=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu,'');
export const indexedField=(text:string,weight=1,primary=true):SearchField=>({text,normalized:clean(text),weight,primary});
const termsOf=(query:string)=>{
 const terms=[...segmenter.segment(query)].filter(part=>part.isWordLike).map(part=>clean(part.segment)).filter(part=>part.length>1&&!stops.has(part));
 return [...new Set(terms.length?terms:[clean(query)].filter(Boolean))];
};
const gramsOf=(value:string)=>{const result=new Set<string>();for(let i=0;i<value.length-1;i++)result.add(value.slice(i,i+2));return result;};
const related=(term:string)=>concepts.find(group=>group.includes(term))?.filter(item=>item!==term)||[];

type Query={raw:string;full:string;terms:string[];grams:Set<string>};
function fieldScore(value:SearchField,query:Query){
 const text=value.normalized??clean(value.text);
 if(!text)return 0;
 if(text.includes(query.full))return 150+Math.min(query.full.length*3,45);
 if(query.full.length<2)return 0;
 let direct=0,similar=0;
 for(const term of query.terms){
  if(text.includes(term))direct++;
  else if(related(term).some(word=>text.includes(word)))similar++;
 }
 const coverage=(direct+similar*.68)/query.terms.length;
 let common=0;
 if(query.full.length>=3){for(const gram of query.grams)if(text.includes(gram))common++;}
 const gramCoverage=query.grams.size?common/query.grams.size:0;
 if(!direct&&!similar&&gramCoverage<.55)return 0;
 if(query.terms.length>1&&coverage<.45&&gramCoverage<.48)return 0;
 if(query.terms.length===1&&coverage<.6&&gramCoverage<.55)return 0;
 return Math.round(direct*24+similar*13+coverage*26+gramCoverage*25);
}

function excerpt(value:string,query:Query,max=170){
 const text=value.replace(/\s+/g,' ').trim();
 if(text.length<=max)return text;
 const lower=text.normalize('NFKC').toLocaleLowerCase('zh-CN');
 const probes=[query.raw,...query.terms,...query.terms.flatMap(related)].filter(Boolean);
 let at=probes.reduce((best,probe)=>{const index=lower.indexOf(probe.toLocaleLowerCase('zh-CN'));return index>=0&&index<best?index:best;},Number.POSITIVE_INFINITY);
 if(!Number.isFinite(at))at=0;
 const start=Math.max(0,Math.min(text.length-max,at-35));
 return `${start?'…':''}${text.slice(start,start+max)}${start+max<text.length?'…':''}`;
}

/** Search only preselected note fields; callers should leave bulk OCR text out of this index. */
export function rankSearch<T extends SearchDocument>(documents:T[],rawQuery:string,limit=80):SearchHit<T>[] {
 const raw=rawQuery.trim();
 const full=clean(raw);
 if(!full)return [];
 const query:Query={raw,full,terms:termsOf(raw),grams:gramsOf(full)};
 const hits:SearchHit<T>[]=[];
 for(const document of documents){
  let score=0,best=0,snippet='';
  for(const field of document.fields){
   const current=fieldScore(field,query)*(field.weight??1);
   if(current>score)score=current;
   if(field.primary!==false&&current>best){best=current;snippet=excerpt(field.text,query);}
  }
  if(best>0)hits.push({...document,score:Math.round(score+best*.15),excerpt:snippet});
 }
 return hits.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'zh-CN')).slice(0,limit);
}
