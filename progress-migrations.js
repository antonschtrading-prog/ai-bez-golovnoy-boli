(function(root){'use strict';
const KEY='ai-course-migration-v2';
function prepare(input,deviceId){
 let envelope;
 if(input?.format==='ai-course-sync-envelope-v2')envelope=root.CourseSyncModel.readEnvelope(input);
 else if(input?.type==='ai-course-progress'&&[3,4,5].includes(input.schemaVersion)){
  envelope=root.CourseSyncModel.makeEnvelope({'ai-no-headache-v1':input.state},{deviceId});
 }else if(input?.format==='ai-course-full-local-backup-v1'){
  // The old full export also contains diagnostic metadata, not course sections.
  const items={...input.items};delete items['ai-course-journal-v1'];
  envelope=root.CourseSyncModel.fromLegacy({...input,items},deviceId);
 }else if(input?.format==='ai-course-study-lab-v1'){
  envelope=root.CourseSyncModel.makeEnvelope({'ai-course-study-lab-v1':input.state},{deviceId});
 }else envelope=root.CourseSyncModel.fromLegacy(input,deviceId);
 return root.CourseSyncModel.readEnvelope(envelope);
}
function stage(storage,input,deviceId){
 const envelope=prepare(input,deviceId);
 const raw=JSON.stringify({format:KEY,source:input,envelope});
 if(raw.length>4000000)throw Error('Копия превышает лимит миграции');
 const existing=storage.getItem(KEY);
 if(existing!==null){
  const old=JSON.parse(existing);
  if(JSON.stringify(old.source)===JSON.stringify(input))return root.CourseSyncModel.readEnvelope(old.envelope);
  throw Error('Уже есть другая подготовленная миграция. Сначала экспортируй её');
 }
 storage.setItem(KEY,raw);
 if(storage.getItem(KEY)!==raw)throw Error('Не удалось проверить запись миграции');
 return envelope;
}
root.CourseMigrations=Object.freeze({KEY,prepare,stage});
})(typeof window!=='undefined'?window:globalThis);
