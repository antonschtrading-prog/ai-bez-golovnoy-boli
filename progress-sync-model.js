/* Подготовка облачной модели: чистые функции, без сети и записи в хранилище.
   v2 не заменяет текущие локальные форматы, а создаёт отдельный переносимый снимок.
   revision и updatedAt при серверном обмене подтверждаются сервером, не клиентом.
*/
(function(root){
'use strict';
const VERSION=2;
const KEYS=[
'ai-no-headache-v1','ai-course-study-lab-v1','ai-course-deep-workshop-v1',
'ai-course-assessment-v1','ai-course-review-v1',
'ai-course-platform-choice-v1','ai-course-compare-v1'
];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const deep=v=>JSON.parse(JSON.stringify(v));
const invalid=k=>k==='__proto__'||k==='constructor'||k==='prototype';
function rejectUnsafe(value,depth=0){
 if(depth>25)throw Error('Слишком глубокая структура');
 if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
 if(Array.isArray(value)){if(value.length>200000)throw Error('Слишком большой массив');for(const x of value)rejectUnsafe(x,depth+1);return}
 if(!obj(value))throw Error('Неподдерживаемый тип значения');
 const keys=Object.keys(value);if(keys.length>20000)throw Error('Слишком много полей');
 for(const k of keys){if(invalid(k))throw Error('Опасное имя поля '+k);rejectUnsafe(value[k],depth+1)}
}
const SHAPES={
'ai-no-headache-v1':[['completed','array'],['deepDone','array'],['answers','record'],['deepNotes','record'],['levelExams06','record']],
'ai-course-study-lab-v1':[['terms','record'],['cases','record']],
'ai-course-deep-workshop-v1':[['progress','record']],
'ai-course-assessment-v1':[['results','record']],
'ai-course-review-v1':[['items','record']],
'ai-course-platform-choice-v1':[['platform','string']],
'ai-course-compare-v1':[['aScores','record'],['bScores','record']]
};
function checkSectionShape(key,item){
 for(const [field,kind] of SHAPES[key]||[]){
  if(!own(item,field))continue;
  const v=item[field];
  if(kind==='array'&&!Array.isArray(v))throw Error('Неверный массив '+key+'.'+field);
  if(kind==='record'&&!obj(v))throw Error('Неверный объект '+key+'.'+field);
  if(kind==='string'&&typeof v!=='string')throw Error('Неверная строка '+key+'.'+field);
 }
}
function cleanSections(sections){
 if(!obj(sections))throw Error('Разделы должны быть объектом');
 rejectUnsafe(sections);
 const result={};
 for(const k of Object.keys(sections)){
  if(!KEYS.includes(k))throw Error('Неизвестный раздел: '+k);
  if(!obj(sections[k]))throw Error('Неправильная структура раздела '+k);
  checkSectionShape(k,sections[k]);
  result[k]=deep(sections[k]);
 }
 return result;
}
function eventShape(e){
 if(!obj(e)||typeof e.id!=='string'||e.id.length<8||e.id.length>160)throw Error('Неверный идентификатор события');
 if(!/^[a-zA-Z0-9_.:-]+$/.test(e.id))throw Error('Недопустимые символы идентификатора');
 if(typeof e.deviceId!=='string'||!e.deviceId.trim()||e.deviceId.length>160)throw Error('Неверный идентификатор устройства');
 if(!Number.isSafeInteger(e.seq)||e.seq<1)throw Error('Неверный номер события');
 if(!KEYS.includes(e.section))throw Error('Неизвестный раздел события');
 if(!['section.replace','checkpoint'].includes(e.kind))throw Error('Неизвестный тип события');
 if(typeof e.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(e.at)||!Number.isFinite(Date.parse(e.at)))throw Error('Неверная дата события');
 if(typeof e.baseRevision!=='number'||!Number.isSafeInteger(e.baseRevision)||e.baseRevision<0)throw Error('Неверная исходная ревизия');
 if(!obj(e.value))throw Error('Значение события должно быть объектом');
 checkSectionShape(e.section,e.value);
 rejectUnsafe(e.value);
 return {id:e.id,deviceId:e.deviceId,seq:e.seq,section:e.section,kind:e.kind,at:e.at,baseRevision:e.baseRevision,value:deep(e.value)};
}
function makeEnvelope(sections,meta={}){
 const data=cleanSections(sections);
 const deviceId=meta.deviceId;
 if(typeof deviceId!=='string'||!deviceId.trim()||deviceId.length>160)throw Error('Не указан идентификатор устройства');
 const revision=meta.revision===undefined?0:meta.revision;
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Неверная ревизия');
 return {format:'ai-course-sync-envelope-v2',schemaVersion:VERSION,
  deviceId,revision,serverRevision:null,sections:data,events:[],createdAt:new Date().toISOString()};
}
function readEnvelope(x){
 if(!obj(x)||x.format!=='ai-course-sync-envelope-v2'||x.schemaVersion!==VERSION)throw Error('Неподдерживаемая версия');
 if(typeof x.deviceId!=='string'||!x.deviceId.trim()||x.deviceId.length>160)throw Error('Некорректное устройство');
 if(!Number.isSafeInteger(x.revision)||x.revision<0)throw Error('Некорректная ревизия');
 if(x.serverRevision!==null&&x.serverRevision!==undefined&&(!Number.isSafeInteger(x.serverRevision)||x.serverRevision<0))throw Error('Некорректная ревизия сервера');
 const sections=cleanSections(x.sections);
 if(!Array.isArray(x.events)||x.events.length>10000)throw Error('Слишком большой журнал событий');
 const ids=new Set(),seqs=new Set(),events=[];
 for(const raw of x.events){
  const e=eventShape(raw);
  const marker=e.deviceId+':'+e.seq;
  if(ids.has(e.id)||seqs.has(marker))throw Error('Повтор идентификатора или последовательности события');
  ids.add(e.id);seqs.add(marker);events.push(e);
 }
 return {...x,sections,events};
}
function append(envelope,event){
 const input=readEnvelope(envelope),e=eventShape(event);
 if(e.deviceId!==input.deviceId)throw Error('Событие принадлежит другому устройству');
 if(input.events.some(x=>x.id===e.id||x.deviceId===e.deviceId&&x.seq===e.seq))
  throw Error('Событие уже существует');
 if(e.baseRevision!==input.revision)throw Error('Конфликт ревизий: запись не выполнена');
 const last=input.events.filter(x=>x.deviceId===e.deviceId).reduce((max,x)=>Math.max(max,x.seq),0);
 if(e.seq<=last)throw Error('Нарушен порядок событий');
 const next=deep(input);
 // Не пишем в localStorage и не делаем запросы. Только черновик следующей версии.
 next.sections[e.section]=deep(e.value);
 next.events.push(e);next.revision++;
 return next;
}
function compare(local,remote){
 const a=readEnvelope(local),b=readEnvelope(remote);
 const duplicate=[],localOnly=[],remoteOnly=[],conflicts=[];
 const byId=new Map(a.events.map(e=>[e.id,e]));
 for(const e of b.events){
  if(byId.has(e.id)){
   if(JSON.stringify(byId.get(e.id))===JSON.stringify(e))duplicate.push(e.id);
   else conflicts.push({id:e.id,reason:'Одинаковый ID, разные события'});
  }else remoteOnly.push(e.id);
 }
 const remoteIds=new Set(b.events.map(e=>e.id));
 for(const e of a.events)if(!remoteIds.has(e.id))localOnly.push(e.id);
 for(const k of KEYS)if(own(a.sections,k)&&own(b.sections,k)&&JSON.stringify(a.sections[k])!==JSON.stringify(b.sections[k]))conflicts.push({section:k,reason:'Разные данные раздела — требуется разрешение конфликта'});
 return {duplicate,localOnly,remoteOnly,conflicts,canFastForward:conflicts.length===0};
}
function fromLegacy(legacy,deviceId){
 const source=legacy?.format==='ai-course-full-local-backup-v1'?legacy.items:
  legacy?.format==='ai-course-progress-snapshot-v1'?legacy.sections:null;
 if(!source)throw Error('Неизвестный старый формат');
 const envelope=makeEnvelope(source,{deviceId});
 envelope.migratedFrom=legacy.format;
 envelope.migrationStatus='preview-only';
 return envelope;
}
root.CourseSyncModel=Object.freeze({VERSION,KEYS:KEYS.slice(),makeEnvelope,readEnvelope,append,compare,fromLegacy});
})(typeof window!=='undefined'?window:globalThis);
