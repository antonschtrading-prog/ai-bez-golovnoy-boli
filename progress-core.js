/* Безопасная модель прогресса для подготовки миграций и облачной синхронизации.
 * Не записывает данные в хранилище без явного вызова в будущем.
 * Не меняет существующие ключи и структуру данных.
 */
(function(root){
'use strict';
const VERSION=1;
const SECTION_KEYS=Object.freeze([
'ai-no-headache-v1',
'ai-course-study-lab-v1',
'ai-course-deep-workshop-v1',
'ai-course-assessment-v1',
'ai-course-review-v1',
'ai-course-platform-choice-v1',
'ai-course-compare-v1'
]);
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
function validateSection(key,object){
 if(!SECTION_KEYS.includes(key))return 'Неизвестный раздел';
 if(!isRecord(object))return 'Данные раздела должны быть объектом';
 const rules={
 'ai-no-headache-v1':[['completed','array'],['answers','record'],['deepDone','array'],['deepAnswers','record'],['deepNotes','record'],['levelExams06','record']],
 'ai-course-study-lab-v1':[['terms','record'],['cases','record'],['notes','record']],
 'ai-course-deep-workshop-v1':[['progress','record']],
 'ai-course-assessment-v1':[['results','record']],
 'ai-course-review-v1':[['items','record']],
 'ai-course-platform-choice-v1':[['platform','string']],
 'ai-course-compare-v1':[['aScores','record'],['bScores','record']]
 };
 for(const [field,type] of rules[key]){
   if(!own(object,field))continue;const value=object[field];
   if(type==='array'&&!Array.isArray(value))return 'Поле '+field+' должно быть массивом';
   if(type==='record'&&!isRecord(value))return 'Поле '+field+' должно быть объектом';
   if(type==='string'&&typeof value!=='string')return 'Поле '+field+' должно быть строкой';
 }
 return null;
}
function collect(storage){
 const sections={},errors=[],missing=[];
 for(const key of SECTION_KEYS){
   let raw;try{raw=storage.getItem(key)}catch(e){errors.push({key,issue:'Нет доступа к чтению хранилища'});continue}
   if(raw===null){missing.push(key);continue}
   let value;try{value=JSON.parse(raw)}catch(e){errors.push({key,issue:'Некорректный JSON'});continue}
   const issue=validateSection(key,value);if(issue){errors.push({key,issue});continue}
   sections[key]=value;
 }
 return {format:'ai-course-progress-snapshot-v1',schemaVersion:VERSION,sections,errors,missing};
}
function fromBackup(value){
 if(!isRecord(value))throw Error('Файл должен содержать объект');
 let source;
 if(value.format==='ai-course-full-local-backup-v1'&&isRecord(value.items))source=value.items;
 else if(value.format==='ai-course-progress-snapshot-v1'&&isRecord(value.sections))source=value.sections;
 else throw Error('Неподдерживаемый формат копии');
 const sections={},errors=[];
 for(const [key,obj] of Object.entries(source)){
   if(!SECTION_KEYS.includes(key)){errors.push({key,issue:'Раздел не поддерживается этой версией'});continue}
   const issue=validateSection(key,obj);if(issue)errors.push({key,issue});else sections[key]=obj;
 }
 return {sections,errors};
}
// До появления проверенных правил слияния изменённые записи не объединяются автоматически.
// Даже похожие списки и ответы могут содержать разные версии одной незаконченной работы.
function fingerprint(value){return JSON.stringify(value)}
function previewMerge(current,incoming){
 const additions=[],same=[],conflicts=[],invalid=[];
 if(!isRecord(current)||!isRecord(incoming))throw Error('Неверная структура данных сравнения');
 for(const key of SECTION_KEYS){
   if(!own(incoming,key))continue;
   const issue=validateSection(key,incoming[key]);if(issue){invalid.push({key,issue});continue}
   if(!own(current,key)){additions.push(key);continue}
   const localIssue=validateSection(key,current[key]);
   if(localIssue){conflicts.push({key,issue:'Локальная запись повреждена; замена требует отдельного решения'});continue}
   if(fingerprint(current[key])===fingerprint(incoming[key]))same.push(key);
   else conflicts.push({key,issue:'Обе копии содержат разные данные. Автоматическое слияние запрещено'});
 }
 return {additions,same,conflicts,invalid,canAutoMerge:conflicts.length===0&&invalid.length===0};
}
function cloudRecordTemplate(){
 return {
  schemaVersion:VERSION,
  accountId:'<идентификатор авторизованного пользователя>',
  deviceId:'<идентификатор устройства>',
  revision:0,
  updatedAt:'<время сервера в UTC>',
  sections:{},
  // Каждая запись сможет иметь отдельную версию и стратегию конфликта.
  conflicts:[]
 };
}
root.CourseProgressCore=Object.freeze({VERSION,SECTION_KEYS,validateSection,collect,fromBackup,previewMerge,cloudRecordTemplate});
})(typeof window!=='undefined'?window:globalThis);
