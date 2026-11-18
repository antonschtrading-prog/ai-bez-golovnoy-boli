(function(root){'use strict';
 // A truthful status model: only deterministic questions can be marked verified.
 // Learner-authored evidence can be present but is NEVER automatically certified.
 function evaluate({questions=[],answers={},work='',rubric=[],evidence={},criteria=[]}={}){
  const total=questions.length;
  const answered=questions.filter((_,i)=>Number.isInteger(answers?.[i])).length;
  const correct=questions.filter((q,i)=>answers?.[i]===q.correct).length;
  const knowledge=answered<total?'incomplete':correct===total?'verified':'review';
  const supplied=typeof work==='string'&&work.trim().length>0;
  const selected=new Set(Array.isArray(rubric)?rubric:[]);
  const details=criteria.map((criterion,i)=>({
   index:i,criterion,selected:selected.has(i),
   evidence:typeof evidence?.[i]==='string'&&evidence[i].trim().length>0,
   status:!selected.has(i)?'not-reviewed':!evidence?.[i]||!String(evidence[i]).trim()?'missing-evidence':'self-reported'
  }));
  const practice=!supplied?'not-started':details.every(item=>item.status==='self-reported')?'self-reviewed':'in-progress';
  const actions=[];
  if(knowledge==='incomplete')actions.push('Ответь на оставшиеся контрольные вопросы.');
  else if(knowledge==='review')actions.push('Разбери ошибки и повтори проверку знаний.');
  if(!supplied)actions.push('Если выполняешь практику, запиши конкретный результат или рабочую ссылку на него.');
  for(const d of details){
   if(d.status==='not-reviewed')actions.push('Проверь критерий: '+d.criterion);
   else if(d.status==='missing-evidence')actions.push('Для критерия «'+d.criterion+'» укажи пример, фрагмент работы или способ проверки.');
  }
  if(practice==='self-reviewed')actions.push('Самооценка заполнена. Для подтверждения качества нужна независимая проверка результата; отметки ученика недостаточно.');
  return {knowledge,practice,answered,correct,total,details,actions};
 }
 root.CourseAssessmentEvidence=Object.freeze({evaluate});
})(typeof window!=='undefined'?window:globalThis);
