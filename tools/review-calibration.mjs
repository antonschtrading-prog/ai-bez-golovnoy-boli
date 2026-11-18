/* Offline model-review calibration. Does NOT invoke a model, browser, Worker or API.
 * Requires actual exported model responses to assess quality. The built-in corpus is NOT
 * evidence that any currently deployed model passed calibration.
 */
import '../rubric-review.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
export const defaultCorpusPath=resolve(here,'../calibration/review-cases.json');
export const minimum=Object.freeze({coverage:1,agreement:0.85,falsePositiveRate:0.05,criticalFalsePasses:0});
const codes=['met','partial','not-demonstrated'];
export function validateCorpus(value){
 if(value?.schema!=='course-rubric-calibration-v1'||!Array.isArray(value.cases)||value.cases.length<20)throw Error('Invalid or incomplete corpus');
 const ids=new Set();
 for(const c of value.cases){
  if(typeof c.id!=='string'||ids.has(c.id)||!['A1','A2','B1','B2','C1'].includes(c.level)||
   typeof c.work!=='string'||!c.work.trim()||!Array.isArray(c.criteria)||c.criteria.length<1||
   !Array.isArray(c.expected)||c.expected.length!==c.criteria.length||
   c.expected.some(x=>!codes.includes(x)))throw Error('Invalid calibration case: '+c?.id);
  ids.add(c.id);
 }
 for(const level of ['A1','A2','B1','B2','C1'])if(value.cases.filter(c=>c.level===level).length<4)throw Error('Not enough examples for '+level);
 return value;
}
export function assess(corpus,candidates,limits=minimum){
 validateCorpus(corpus);
 if(candidates?.schema!=='course-rubric-review-results-v1'||!Array.isArray(candidates.cases))throw Error('Invalid response collection');
 const byId=new Map();
 for(const r of candidates.cases){
  if(!r||typeof r.id!=='string'||byId.has(r.id))throw Error('Duplicate or invalid response id');
  byId.set(r.id,r);
 }
 if([...byId.keys()].some(k=>!corpus.cases.some(c=>c.id===k)))throw Error('Unknown response id');
 let correct=0,total=0,submitted=0,falsePasses=0,criticalFalsePasses=0,negative=0,invalid=0;
 const perLevel={},failures=[];
 for(const item of corpus.cases){
  const r=byId.get(item.id);let safe=null,reason='';
  if(r){
   try{
    safe=globalThis.CourseRubricReview.parse(JSON.stringify(r.review),{work:item.work,criteria:item.criteria});
   }catch(e){reason=String(e.message||e);invalid++;}
  }else reason='missing response';
  const stats=perLevel[item.level]??={cases:0,judgments:0,correct:0};
  stats.cases++;
  if(safe)submitted++;
  for(let i=0;i<item.expected.length;i++){
   const gold=item.expected[i],pred=safe?.items[i]?.rating||null;
   total++;stats.judgments++;
   if(pred===gold){correct++;stats.correct++;}
   if(gold!=='met'){
    negative++;
    if(pred==='met'){
     falsePasses++;
     if(gold==='not-demonstrated')criticalFalsePasses++;
    }
   }
   if(pred!==gold)failures.push({id:item.id,level:item.level,criterion:i,expected:gold,actual:pred,reason:reason||'rating disagrees'});
  }
 }
 const summary={
  cases:corpus.cases.length,submitted,invalid,judgments:total,
  coverage:submitted/corpus.cases.length,agreement:correct/total,
  falsePasses,criticalFalsePasses,falsePositiveRate:negative?falsePasses/negative:0,
  perLevel:Object.fromEntries(Object.entries(perLevel).map(([k,v])=>[k,{...v,agreement:v.correct/v.judgments}])),
  thresholds:limits,
  passed:submitted/corpus.cases.length>=limits.coverage&&correct/total>=limits.agreement&&
   (negative===0||falsePasses/negative<=limits.falsePositiveRate)&&criticalFalsePasses<=limits.criticalFalsePasses,
  failures
 };
 return summary;
}
export function readCorpus(file=defaultCorpusPath){return validateCorpus(JSON.parse(readFileSync(file,'utf8')))}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const corpus=readCorpus();
 const candidate=process.argv[2];
 if(!candidate){
  console.log(JSON.stringify({message:'No model outputs provided: calibration NOT performed',cases:corpus.cases.length,
   expectedJudgments:corpus.cases.reduce((x,c)=>x+c.criteria.length,0),
   command:'node tools/review-calibration.mjs path/to/model-results.json',limits:minimum},null,2));
 }else{
  try{
   const result=assess(corpus,JSON.parse(readFileSync(resolve(candidate),'utf8')));
   console.log(JSON.stringify(result,null,2));
   if(!result.passed)process.exitCode=1;
  }catch(e){console.error('Calibration cannot proceed: '+e.message);process.exitCode=2}
 }
}
