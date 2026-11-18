const {test}=require('node:test'),assert=require('node:assert/strict');
async function setup(){const pilot=await import('../tools/free-review-pilot.mjs');const scoring=await import('../tools/review-calibration.mjs');return {pilot,corpus:scoring.readCorpus()}}
test('one test account schedules 20 cases across ten UTC days, two max per account, zero calls',async()=>{
 const {pilot,corpus}=await setup();
 const result=pilot.plan(corpus,{startDay:'2026-11-18'});
 assert.equal(result.kind,'offline-plan-only');assert.equal(result.callsPerformed,0);
 assert.equal(result.readyForProduction,false);assert.equal(result.days.length,10);
 assert.equal(result.days.reduce((s,d)=>s+d.slots.length,0),20);
 assert(result.days.every(d=>d.slots.length<=2&&d.freeMaxGlobal===8&&d.freeMaxPerAccount===2));
 assert.equal(new Set(result.days.flatMap(d=>d.slots.map(s=>s.id))).size,20);
 assert.equal(result.days.at(-1).utcDay,'2026-11-27');
});
test('four labeled pilot accounts can schedule 20 cases across three UTC days with global 8/day',async()=>{
 const {pilot,corpus}=await setup();
 const result=pilot.plan(corpus,{startDay:'2026-11-18',accounts:['p1owner','p2owner','p3owner','p4owner']});
 assert.deepEqual(result.days.map(d=>d.slots.length),[8,8,4]);
 for(const day of result.days){
  const usage={};for(const slot of day.slots)usage[slot.accountLabel]=(usage[slot.accountLabel]||0)+1;
  assert(Object.values(usage).every(x=>x<=2));
 }
});
test('schedule rejects invalid dates, accounts and unsafe labels',async()=>{
 const {pilot,corpus}=await setup();
 for(const startDay of ['2026-02-30','tomorrow','2026-13-02'])assert.throws(()=>pilot.plan(corpus,{startDay}));
 for(const accounts of [[],['dup','dup'],['secret:ab'],Array.from({length:26},(_,i)=>'p'+i+'account')])
  assert.throws(()=>pilot.plan(corpus,{startDay:'2026-11-18',accounts}));
});
test('batch import never invents model responses and does not mark actual calibration',async()=>{
 const {pilot,corpus}=await setup();
 const result=pilot.combine(corpus,[]);
 assert.equal(result.score.coverage,0);
 assert.equal(result.score.passed,false);
 assert.equal(result.realModelEvidence,false);
});
test('batch collector rejects duplicates and unknown cases',async()=>{
 const {pilot,corpus}=await setup();
 const batch={schema:'course-rubric-review-results-v1',cases:[{id:'a1-complete',review:{schema:'course-rubric-review-v1',items:[]}}]};
 assert.throws(()=>pilot.combine(corpus,[batch,batch]),/duplicate/);
 assert.throws(()=>pilot.combine(corpus,[{...batch,cases:[{id:'foreign',review:{}}]}]),/Unknown/);
});
test('single batch or partial batches retain independent criteria-based quality gate',async()=>{
 const {pilot,corpus}=await setup();
 const c=corpus.cases[0];
 const result=pilot.combine(corpus,[{schema:'course-rubric-review-results-v1',cases:[{
  id:c.id,review:{schema:'course-rubric-review-v1',items:c.expected.map((rating,index)=>({
   index,rating,quote:rating==='not-demonstrated'?'':c.work.slice(0,20),reason:'Проверка',nextStep:'Уточнить'
  }))}
 }]}]);
 assert.equal(result.score.submitted,1);
 assert.equal(result.score.passed,false);
});
