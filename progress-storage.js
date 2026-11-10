/* Local recovery history. Existing section keys remain the source of truth. */
(function(root){'use strict';
const PREFIX='ai-course-version-v1:', LIMIT=20, MAX=2000000;
const baselines=new WeakMap();
function validate(key,raw){
 if(typeof raw!=='string'||raw.length>MAX)throw Error('Снимок слишком большой');
 const value=JSON.parse(raw);
 root.CourseSyncModel.makeEnvelope({[key]:value},{deviceId:'local-validation'});
 return value;
}
function initialize(storage){
 const values=new Map();
 for(const key of root.CourseSyncModel.KEYS)values.set(key,storage.getItem(key));
 baselines.set(storage,values);
}
function list(storage,section){
 const versions=[];
 for(let i=0;i<storage.length;i++){
  const id=storage.key(i);if(!id?.startsWith(PREFIX))continue;
  const entry=JSON.parse(storage.getItem(id));
  if(entry.format!==PREFIX||!root.CourseSyncModel.KEYS.includes(entry.section)||typeof entry.at!=='string'||!Number.isFinite(Date.parse(entry.at)))throw Error('История повреждена; экспортируй данные до исправления');
  validate(entry.section,entry.raw);
  if(!section||entry.section===section)versions.push({...entry,id});
 }
 return versions.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}
function capture(storage,key,raw,reason){
 if(raw===null)return;
 validate(key,raw);
 const versions=list(storage,key);
 if(versions.at(-1)?.raw===raw)return;
 const id=PREFIX+root.crypto.randomUUID();
 storage.setItem(id,JSON.stringify({format:PREFIX,section:key,at:new Date(Math.max(Date.now(),Date.parse(versions.at(-1)?.at||'1970-01-01')+1)).toISOString(),reason,raw}));
}
function write(storage,key,raw,options={}){
 validate(key,raw);
 if(!baselines.has(storage))initialize(storage);
 const before=storage.getItem(key),expected=Object.hasOwn(options,'expected')?options.expected:baselines.get(storage).get(key);
 if(before!==expected){
  capture(storage,key,raw,'conflict');
  throw Error('Другая вкладка изменила прогресс. Твой вариант сохранён в истории; открой центр данных');
 }
 if(before===raw)return;
 // Fail closed: no overwrite unless the old and new snapshots can be retained.
 capture(storage,key,before,'before-change');
 capture(storage,key,raw,options.reason||'save');
 if(storage.getItem(key)!==before)throw Error('Конфликт записи; черновик сохранён в истории');
 storage.setItem(key,raw);
 baselines.get(storage).set(key,raw);
 // Retention only after the main write succeeds. A cleanup failure is harmless.
 try{const entries=list(storage,key);for(const v of entries.slice(0,-LIMIT))storage.removeItem(v.id)}catch(_){}
}
/* Best-effort undo of a multi-section import. Only revert keys whose current
 * value is still the one written by this import: do not overwrite a concurrent tab.
 * Synchronize baselines ONLY for verified successful reversions.
 */
function rollbackBatch(storage,changes){
 if(!Array.isArray(changes))throw Error('Неверный журнал отката');
 if(!baselines.has(storage))initialize(storage);
 const failures=[];
 for(const step of changes.slice().reverse()){
  const {key,before,after}=step||{};
  if(typeof key!=='string'||!root.CourseSyncModel.KEYS.includes(key)&&key!=='ai-course-journal-v1'||typeof after!=='string'&&after!==null||typeof before!=='string'&&before!==null){
   failures.push(key||'unknown');continue;
  }
  try{
   if(storage.getItem(key)!==after)throw Error('Изменения другой вкладки');
   if(before===null)storage.removeItem(key);else storage.setItem(key,before);
   if(storage.getItem(key)!==before)throw Error('Значение после отката не совпадает');
   if(root.CourseSyncModel.KEYS.includes(key))baselines.get(storage).set(key,before);
  }catch(_){failures.push(key)}
 }
 return {complete:failures.length===0,failures};
}
function restore(storage,id,expected){
 const version=list(storage).find(v=>v.id===id);if(!version)throw Error('Версия не найдена');
 write(storage,version.section,version.raw,{expected,reason:'restore'});
 return version.section;
}
root.CourseStorage=Object.freeze({PREFIX,LIMIT,initialize,list,write,restore,rollbackBatch});
if(root.document){try{initialize(root.localStorage)}catch(_){} }
})(typeof window!=='undefined'?window:globalThis);
