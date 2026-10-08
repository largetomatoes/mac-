function validOcrEntry(entry){
 const box=value=>value&&typeof value.text==='string'&&value.text.length<=10000&&['x0','y0','x1','y1'].every(k=>Number.isFinite(value[k])&&value[k]>=0&&value[k]<=1)&&value.x1>=value.x0&&value.y1>=value.y0;
 return !!entry&&typeof entry.libraryBookId==='string'&&entry.libraryBookId.length>0&&entry.libraryBookId.length<=100&&Number.isInteger(entry.page)&&entry.page>0&&typeof entry.text==='string'&&entry.text.length<=200000&&typeof entry.at==='string'&&Number.isFinite(Date.parse(entry.at))&&(entry.version===undefined||Number.isInteger(entry.version))&&(entry.rotation===undefined||[0,90,180,270].includes(entry.rotation))&&(entry.preferOcr===undefined||typeof entry.preferOcr==='boolean')&&Array.isArray(entry.lines)&&entry.lines.length>0&&entry.lines.length<=10000&&entry.lines.every(line=>box(line)&&(line.words===undefined||Array.isArray(line.words)&&line.words.length<=1000&&line.words.every(box)));
}
function mergeOcrPage(data,entry){
 const previous=data.ocrCache.find(item=>item.libraryBookId===entry.libraryBookId&&item.page===entry.page);
 if(previous&&Date.parse(previous.at)>Date.parse(entry.at))return data;
 return {...data,ocrCache:[...data.ocrCache.filter(item=>!(item.libraryBookId===entry.libraryBookId&&item.page===entry.page)),entry]};
}
module.exports={validOcrEntry,mergeOcrPage};
