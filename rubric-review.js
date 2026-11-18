/* Imported feedback is untrusted: it is an aid to revision, never a certified grade.
 * Only exact quotations from the learner work may support a claimed criterion.
 * No network, credentials, or implicit change to progress.
 */
(function(root){'use strict';
 const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const ratings=['met','partial','not-demonstrated'];
 function prompt({level,title,task,work,criteria}){
  if(typeof work!=='string'||!Array.isArray(criteria))throw Error('Некорректное задание');
  return [
   'Проверь учебную практическую работу по рубрике. Это разбор для ученика, НЕ аттестация.',
   'Не считай количество символов и отметки ученика доказательством качества.',
   'Не выдумывай цитаты. Для каждого подтверждённого или частичного критерия дай ТОЧНУЮ подстроку из работы.',
   'Не подтверждай внешние факты без независимо открытого первоисточника. Укажи, что проверка ограничена присланным текстом.',
   'Ответь ТОЛЬКО JSON-объектом без Markdown, ключи: "schema":"course-rubric-review-v1", "items": массив.',
   'Для каждого критерия по индексу: {"index":0,"rating":"met|partial|not-demonstrated","quote":"дословная цитата из работы или пусто","reason":"конкретное обоснование","nextStep":"конкретное действие"}',
   'Дай ровно '+criteria.length+' элементов в порядке 0..'+(criteria.length-1)+'.',
   'Уровень: '+level+'. Тема: '+title,
   'Задание: '+task,
   'Критерии:\n'+criteria.map((x,i)=>i+'. '+x).join('\n'),
   'Работа ученика:\n'+work
  ].join('\n\n');
 }
 function parse(text,{work,criteria}){
  if(typeof text!=='string'||text.length>30000)throw Error('Ответ проверки слишком большой или отсутствует');
  if(typeof work!=='string'||!Array.isArray(criteria)||criteria.length<1||criteria.length>20)throw Error('Некорректные критерии');
  let parsed;
  try{parsed=JSON.parse(text)}catch(_){throw Error('Ожидается JSON без оформления Markdown')}
  if(!object(parsed)||parsed.schema!=='course-rubric-review-v1'||Object.keys(parsed).some(k=>!['schema','items'].includes(k))||!Array.isArray(parsed.items)||parsed.items.length!==criteria.length)throw Error('Неверный формат разбора или количество критериев');
  const seen=new Set(),items=[];
  for(const item of parsed.items){
   if(!object(item)||Object.keys(item).some(k=>!['index','rating','quote','reason','nextStep'].includes(k))||
      !Number.isInteger(item.index)||item.index<0||item.index>=criteria.length||seen.has(item.index)||
      !ratings.includes(item.rating)||typeof item.quote!=='string'||item.quote.length>700||
      typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>1600||
      typeof item.nextStep!=='string'||!item.nextStep.trim()||item.nextStep.length>1200)
    throw Error('Критерий разбора неверен или повторяется');
   seen.add(item.index);
   // Accept only verbatim evidence found in the work. This is not a truth/fact verification.
   if(item.rating!=='not-demonstrated'&&(!item.quote.trim()||!work.includes(item.quote)))throw Error('Цитата критерия '+(item.index+1)+' отсутствует в работе');
   if(item.rating==='not-demonstrated'&&item.quote.trim())throw Error('Нельзя подтверждать невыполненный критерий цитатой');
   items.push({index:item.index,rating:item.rating,quote:item.quote,reason:item.reason,nextStep:item.nextStep});
  }
  items.sort((a,b)=>a.index-b.index);
  return {schema:'course-rubric-review-v1',workSnapshot:work,criteriaSnapshot:criteria.slice(),items};
 }
 function isCurrent(review,work,criteria){
  return object(review)&&review.schema==='course-rubric-review-v1'&&review.workSnapshot===work&&
   JSON.stringify(review.criteriaSnapshot)===JSON.stringify(criteria);
 }
 function counts(review){const n={met:0,partial:0,'not-demonstrated':0};for(const item of review.items)n[item.rating]++;return n;}
 root.CourseRubricReview=Object.freeze({prompt,parse,isCurrent,counts});
})(typeof window!=='undefined'?window:globalThis);
