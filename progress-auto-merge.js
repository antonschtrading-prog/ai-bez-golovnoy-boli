/* Three-way merge for automatic progress sync. Never resolve competing edits by time. */
(function(root){'use strict';
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
 function merge(base,local,remote){
  const conflicts=[];
  function visit(b,l,r,path){
   if(same(l,r))return copy(l);
   if(same(l,b))return copy(r);
   if(same(r,b))return copy(l);
   const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
   if(object(l)&&object(r)&&(b===undefined||object(b))){
    const out={};
    for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
     if(['__proto__','constructor','prototype'].includes(key))throw Error('Unsafe progress key');
     const value=visit(b?.[key],l[key],r[key],path.concat(key));
     if(value!==undefined)out[key]=value;
    }
    return out;
   }
   conflicts.push(path.join('.'));return copy(l);
  }
  const proposed=visit(base,local,remote,[]);
  return {status:conflicts.length?'conflicts':'ready',conflicts,proposed:conflicts.length?null:proposed};
 }
 root.CourseAutoMerge=Object.freeze({merge});
})(typeof window!=='undefined'?window:globalThis);
