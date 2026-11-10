/* Atomic IndexedDB compare-and-swap for future account-scoped progress.
 * No automatic migration from localStorage and no network access.
 */
(function(root){'use strict';
function open({indexedDB=root.indexedDB,dbName='ai-course-account-data-v1'}={}){
 if(!indexedDB||typeof indexedDB.open!=='function')return Promise.reject(Error('IndexedDB unavailable'));
 if(typeof dbName!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(dbName))return Promise.reject(Error('Invalid database name'));
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(dbName,1);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains('progress'))db.createObjectStore('progress',{keyPath:'key'});
  };
  request.onerror=()=>reject(request.error||Error('Cannot open IndexedDB'));
  request.onblocked=()=>reject(Error('Database upgrade blocked by another tab'));
  request.onsuccess=()=>{
   const db=request.result;
   db.onversionchange=()=>db.close();
   function keyFor(accountId,section){
    if(typeof accountId!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(accountId))throw Error('Invalid account identifier');
    if(typeof section!=='string'||!root.CourseSyncModel.KEYS.includes(section))throw Error('Invalid section');
    return accountId+':'+section;
   }
   function get(accountId,section){
    const key=keyFor(accountId,section);
    return new Promise((ok,no)=>{
     const tx=db.transaction('progress','readonly');
     const req=tx.objectStore('progress').get(key);
     req.onerror=()=>no(req.error||Error('IndexedDB read failed'));
     req.onsuccess=()=>{const r=req.result;ok(r?{revision:r.revision,value:structuredClone(r.value)}:{revision:0,value:null})};
    });
   }
   function update(accountId,section,expectedRevision,value){
    const key=keyFor(accountId,section);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)return Promise.reject(Error('Invalid revision'));
    let safe;
    try{safe=root.CourseSyncModel.makeEnvelope({[section]:value},{deviceId:'indexed-validation'}).sections[section]}
    catch(e){return Promise.reject(e)}
    return new Promise((ok,no)=>{
     const tx=db.transaction('progress','readwrite');
     const store=tx.objectStore('progress');
     let result=null,conflict=null,done=false;
     const req=store.get(key);
     req.onsuccess=()=>{
      const current=req.result;
      const rev=current?current.revision:0;
      if(rev!==expectedRevision){conflict={conflict:true,currentRevision:rev};return}
      store.put({key,revision:rev+1,value:safe});
      result={revision:rev+1};
     };
     req.onerror=()=>{conflict=req.error||Error('IndexedDB read failed');tx.abort()};
     tx.oncomplete=()=>{done=true;ok(conflict||result)};
     tx.onerror=()=>{if(!done)no(tx.error||Error('IndexedDB transaction failed'))};
     tx.onabort=()=>{if(!done)no(tx.error||Error('IndexedDB transaction aborted'))};
    });
   }
   resolve(Object.freeze({get,update,close:()=>db.close()}));
  };
 });
}
root.CourseIndexedStore=Object.freeze({open});
})(typeof window!=='undefined'?window:globalThis);
