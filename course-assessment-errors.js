/* Distinguish currently wrong answers from answers corrected after the first try.
   No previous assessment schema changes, and no successful answer is rewritten. */
(function(root){'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 function inspect(results,levels=['A1','A2','B1','B2','C1']){
  const unresolved=[],corrected=[];
  if(!results||typeof results!=='object'||Array.isArray(results))return {unresolved,corrected};
  for(const level of levels){
   const record=own(results,level)?results[level]:null;
   if(!record||typeof record!=='object'||Array.isArray(record))continue;
   const answers=record.answers&&typeof record.answers==='object'&&!Array.isArray(record.answers)?record.answers:{};
   const first=record.firstAnswers&&typeof record.firstAnswers==='object'&&!Array.isArray(record.firstAnswers)?record.firstAnswers:{};
   const wrong=new Set(Array.isArray(record.errors)?record.errors.filter(i=>Number.isSafeInteger(i)&&i>=0):[]);
   if(wrong.size)unresolved.push({level,count:wrong.size});
   const fixed=Object.keys(first).filter(k=>/^\d+$/.test(k)&&Number.isSafeInteger(first[k])&&Number.isSafeInteger(answers[k])&&first[k]!==answers[k]&&!wrong.has(Number(k)));
   if(fixed.length)corrected.push({level,count:fixed.length});
  }
  return {unresolved,corrected};
 }
 root.CourseAssessmentErrors=Object.freeze({inspect});
})(typeof window!=='undefined'?window:globalThis);
