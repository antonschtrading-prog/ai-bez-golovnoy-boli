/* Offline Free-only Workers AI calibration planning.
 * This module does NOT authenticate, connect to a provider, invoke a Worker,
 * modify D1, or turn on any production feature. Each slot is a proposal only.
 */
import {readCorpus,validateCorpus,assess} from './review-calibration.mjs';
import {FREE_REVIEW_POLICY} from '../cloudflare/free-review-budget.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const NAME=/^[A-Za-z0-9_-]{3,80}$/;
function dateAt(date,offset){
 if(!DAY.test(date))throw Error('Invalid start day: use YYYY-MM-DD UTC');
 const parsed=new Date(date+'T00:00:00.000Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw Error('Invalid calendar date');
 parsed.setUTCDate(parsed.getUTCDate()+offset);
 return parsed.toISOString().slice(0,10);
}
export function plan(corpus,{startDay,accounts=['pilot-owner']}={}){
 validateCorpus(corpus);
 const first=startDay||new Date().toISOString().slice(0,10);
 dateAt(first,0);
 if(!Array.isArray(accounts)||!accounts.length||accounts.length>25||new Set(accounts).size!==accounts.length||
  accounts.some(x=>typeof x!=='string'||!NAME.test(x)))throw Error('Pilot requires unique synthetic account labels');
 // Preserve each example and alternate levels, not difficulty or review outcome.
 const levels=['A1','A2','B1','B2','C1'];
 const ordered=[];
 const queue=Object.fromEntries(levels.map(l=>[l,corpus.cases.filter(x=>x.level===l)]));
 while(ordered.length<corpus.cases.length){
  for(const level of levels)if(queue[level].length)ordered.push(queue[level].shift());
 }
 const days=[];
 let cursor=0,offset=0;
 while(cursor<ordered.length){
  const day=dateAt(first,offset),usage=Object.fromEntries(accounts.map(x=>[x,0]));
  const slots=[];
  for(let i=0;i<FREE_REVIEW_POLICY.totalDaily&&cursor<ordered.length;i++){
   const account=accounts.find(a=>usage[a]<FREE_REVIEW_POLICY.perAccountDaily);
   if(!account)break;
   const item=ordered[cursor++];
   usage[account]++;
   slots.push({id:item.id,level:item.level,accountLabel:account,
    task:item.task,title:item.title,work:item.work,criteria:item.criteria});
  }
  if(!slots.length)throw Error('Cannot schedule pilot safely within the Free quota');
  days.push({utcDay:day,freeMaxGlobal:FREE_REVIEW_POLICY.totalDaily,
   freeMaxPerAccount:FREE_REVIEW_POLICY.perAccountDaily,slots});
  offset++;
 }
 return {schema:'course-free-ai-pilot-plan-v1',kind:'offline-plan-only',
  callsPerformed:0,cases:ordered.length,accounts:accounts.slice(),
  model:FREE_REVIEW_POLICY.model,days,
  readyForProduction:false,
  note:'No model was called. Actual run requires verified Workers Free, D1 quotas, explicit auth, and separately recorded human-reviewed results.'};
}
export function combine(corpus,collections){
 validateCorpus(corpus);
 if(!Array.isArray(collections))throw Error('Provide an array of response batches');
 const known=new Set(corpus.cases.map(x=>x.id)),all=new Map();
 for(const batch of collections){
  if(!batch||batch.schema!=='course-rubric-review-results-v1'||!Array.isArray(batch.cases))throw Error('Invalid response batch');
  for(const item of batch.cases){
   if(!item||!known.has(item.id)||all.has(item.id))throw Error('Unknown or duplicate calibration case');
   all.set(item.id,{id:item.id,review:item.review});
  }
 }
 const results={schema:'course-rubric-review-results-v1',cases:[...all.values()]};
 const score=assess(corpus,results);
 return {results,score,realModelEvidence:false,
  note:'These scores describe supplied files only. The caller must independently verify actual provider origin and review contested outcomes.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const cmd=process.argv[2]||'plan',corpus=readCorpus();
 if(cmd==='plan'){
  const startDay=process.argv[3]||new Date().toISOString().slice(0,10);
  // Account labels are scheduling slots, never Telegram IDs or access tokens.
  const accounts=process.argv.slice(4);
  console.log(JSON.stringify(plan(corpus,{startDay,accounts:accounts.length?accounts:['pilot-owner']}),null,2));
 }else if(cmd==='check'){
  const paths=process.argv.slice(3);
  if(!paths.length)throw Error('Provide at least one local JSON result batch');
  const batches=paths.map(file=>JSON.parse(readFileSync(resolve(file),'utf8')));
  const result=combine(corpus,batches);
  console.log(JSON.stringify({score:result.score,note:result.note},null,2));
  if(!result.score.passed)process.exitCode=1;
 }else throw Error('Usage: node tools/free-review-pilot.mjs plan [YYYY-MM-DD] [account-label...] | check results.json ...');
}
