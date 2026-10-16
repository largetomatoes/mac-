/** Compare persisted JSON values without allocating whole-document strings. */
export function jsonEqual(a:unknown,b:unknown):boolean{
 const pending:[unknown,unknown][]=[[a,b]];
 while(pending.length){const [left,right]=pending.pop()!;if(left===right)continue;
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  if(Array.isArray(left)||Array.isArray(right)){if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;for(let i=0;i<left.length;i++)pending.push([left[i],right[i]]);continue;}
  const x=left as Record<string,unknown>,y=right as Record<string,unknown>,keys=Object.keys(x).filter(k=>x[k]!==undefined),other=Object.keys(y).filter(k=>y[k]!==undefined);if(keys.length!==other.length)return false;
  for(const key of keys){if(!Object.prototype.hasOwnProperty.call(y,key)||y[key]===undefined)return false;pending.push([x[key],y[key]]);}
 }
 return true;
}
