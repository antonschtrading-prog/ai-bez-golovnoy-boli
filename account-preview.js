/* Safe, side-effect-free account preview. Never imports server data into a lesson.
 * Designed for browser and Mini App to share the same consent/check workflow.
 */
(function(root){'use strict';
const MAX=1024*1024;
function local(storage){
 const snapshot=root.CourseProgressCore.collect(storage);
 if(snapshot.errors.length)throw Error('Повреждён локальный прогресс: исправь разделы перед переносом');
 const safe=root.CourseSyncModel.makeEnvelope(snapshot.sections,{deviceId:'account-preview'}).sections;
 return {sections:safe,missing:snapshot.missing};
}
function remote(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Некорректная серверная копия');
 if(!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.sections!=='object'||!value.sections)throw Error('В копии нет ревизии и разделов');
 if(JSON.stringify(value).length>MAX)throw Error('Копия превышает 1 МБ');
 return {revision:value.revision,sections:root.CourseSyncModel.makeEnvelope(value.sections,{deviceId:'account-preview'}).sections};
}
function plan(storage,record){
 const current=local(storage),server=remote(record);
 const result=root.CourseSyncPlanner.prepare(current.sections,server);
 const localKeys=Object.keys(current.sections);
 return {...result,localCount:localKeys.length,serverCount:Object.keys(server.sections).length,
  localMissing:current.missing,hasLocalWork:localKeys.length>0};
}
function exportPlan(result){
 if(!result||result.status!=='ready'||!result.proposed)throw Error('Конфликты не разрешены — экспорт объединённого прогресса запрещён');
 const payload={format:'ai-course-sync-preview-v1',revision:result.revision,sections:result.proposed,
  warning:'Это только предварительная копия. Отправки на сервер не выполнялось.'};
 return JSON.stringify(payload,null,2);
}
root.CourseAccountPreview=Object.freeze({MAX,local,remote,plan,exportPlan});
})(typeof window!=='undefined'?window:globalThis);
