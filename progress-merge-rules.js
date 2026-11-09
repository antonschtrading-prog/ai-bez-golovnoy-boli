/* Проект правил слияния прогресса — только анализ, никаких записей.
 * ПРЕДУПРЕЖДЕНИЕ: создаётся черновик предложения, не окончательная
 * синхронизация. Неизвестные структуры и спорные значения блокируют слияние.
 */
(function(root){'use strict';
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const unsafe=k=>k==='__proto__'||k==='constructor'||k==='prototype';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rules={
 'ai-no-headache-v1':{set:['completed','deepDone','extendedDone'],maps:['answers','deepAnswers','deepNotes','v05Answers','v05Evidence','diagnosticAnswers','reviewStats','levelExams06']},
 'ai-course-study-lab-v1':{set:[],maps:['terms','cases','notes','errors']},
 'ai-course-deep-workshop-v1':{set:[],maps:['progress']},
 'ai-course-assessment-v1':{set:[],maps:['results']},
 'ai-course-review-v1':{set:[],maps:['items']},
 'ai-course-platform-choice-v1':{set:[],maps:[]},
 'ai-course-compare-v1':{set:[],maps:['aScores','bScores']}
};
const labels={
 'completed':'Завершённые занятия','deepDone':'Завершённые углублённые занятия',
 'extendedDone':'Завершённые расширенные задания'
};
function audit(local,incoming){
 const proposed={},conflicts=[],merged=[],single=[],unchanged=[];
 if(!record(local)||!record(incoming))throw Error('Обе копии должны быть объектами разделов');
 // Validate nested keys even in sections present on only one side.
 root.CourseSyncModel.makeEnvelope(local,{deviceId:'merge-local'});
 root.CourseSyncModel.makeEnvelope(incoming,{deviceId:'merge-incoming'});
 const allowed=Object.keys(rules);
 for(const key of Object.keys(incoming)){if(!allowed.includes(key))conflicts.push({key,field:'',reason:'Неизвестный раздел'});}
 for(const key of allowed){
  const a=local[key],b=incoming[key];
  if(!has(incoming,key)){if(has(local,key))proposed[key]=clone(a);continue}
  if(!has(local,key)){if(!record(b)){conflicts.push({key,field:'',reason:'Некорректная структура раздела'});continue}proposed[key]=clone(b);single.push({key,field:'',reason:'Раздел есть только в файле'});continue}
  if(!record(a)||!record(b)){conflicts.push({key,field:'',reason:'Некорректная структура раздела'});continue}
  if(same(a,b)){proposed[key]=clone(a);unchanged.push({key});continue}
  const out=clone(a),rule=rules[key];
  for(const field of Object.keys(b)){
   if(unsafe(field)){conflicts.push({key,field,reason:'Недопустимое имя поля'});continue}
   if(!has(a,field)){out[field]=clone(b[field]);single.push({key,field,reason:'Поле есть только в одной копии'});continue}
   if(same(a[field],b[field]))continue;
   if(rule.set.includes(field)){
     if(!Array.isArray(a[field])||!Array.isArray(b[field])||![...a[field],...b[field]].every(x=>typeof x==='string'||typeof x==='number')){
      conflicts.push({key,field,reason:'Некорректный список завершённых занятий'});continue}
     const unique=[...new Set([...a[field],...b[field]])];out[field]=unique;
     merged.push({key,field,reason:labels[field]||'Подтверждённые уникальные идентификаторы объединены'});
     continue;
   }
   if(rule.maps.includes(field)){
     if(!record(a[field])||!record(b[field])){conflicts.push({key,field,reason:'Несовместимые структуры'});continue}
     const next=clone(a[field]);let added=0;
     for(const entry of Object.keys(b[field])){
       if(unsafe(entry)){conflicts.push({key,field:field+'.'+entry,reason:'Недопустимое имя записи'});continue}
       if(!has(a[field],entry)){next[entry]=clone(b[field][entry]);added++}
       else if(!same(a[field][entry],b[field][entry])){
         conflicts.push({key,field:field+'.'+entry,reason:'Разные значения одной записи — требуется ручное решение'});
       }
     }
     out[field]=next;if(added)merged.push({key,field,reason:'Добавлено независимых записей: '+added});
     continue;
   }
   conflicts.push({key,field,reason:'Нет подтверждённого правила объединения'});
  }
  proposed[key]=out;
 }
 return {proposed,conflicts,merged,single,unchanged,safe:conflicts.length===0,
 summary:{sectionCount:Object.keys(proposed).length,conflictCount:conflicts.length,mergedFieldCount:merged.length,newFieldCount:single.length}};
}
root.CourseMergeRules=Object.freeze({audit});
})(typeof window!=='undefined'?window:globalThis);
