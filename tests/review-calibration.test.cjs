const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const make=async()=>{
 const m=await import('../tools/review-calibration.mjs');
 const corpus=m.readCorpus();
 const cases=corpus.cases.map(c=>({id:c.id,review:{schema:'course-rubric-review-v1',items:c.expected.map((rating,index)=>({
  index,rating,quote:rating==='not-demonstrated'?'':c.work.slice(0,Math.min(32,c.work.length)),
  reason:'Фрагмент исходной работы',nextStep:'Уточни результат'
 }))}}));
 return {m,corpus,candidates:{schema:'course-rubric-review-results-v1',cases}};
};
test('gold-standard fixture has 20 labeled, balanced A1-C1 examples',async()=>{
 const {corpus}=await make();
 assert.equal(corpus.cases.length,20);
 assert.deepEqual([...new Set(corpus.cases.map(c=>c.level))].sort(),['A1','A2','B1','B2','C1']);
 const labels=corpus.cases.flatMap(c=>c.expected);
 assert(labels.includes('met'));assert(labels.includes('partial'));assert(labels.includes('not-demonstrated'));
});
test('fully matching grounded responses satisfy offline gate (not actual AI performance)',async()=>{
 const {m,corpus,candidates}=await make();
 const result=m.assess(corpus,candidates);
 assert.equal(result.passed,true);assert.equal(result.coverage,1);assert.equal(result.agreement,1);
 assert.equal(result.criticalFalsePasses,0);assert.equal(result.invalid,0);
});
test('unsafe unsupported positive predictions fail the no-false-pass gate',async()=>{
 const {m,corpus,candidates}=await make();
 const victim=candidates.cases.find(x=>x.id==='a1-weak');
 victim.review.items[0].rating='met';victim.review.items[0].quote=corpus.cases.find(x=>x.id==='a1-weak').work.slice(0,20);
 const outcome=m.assess(corpus,candidates);
 assert.equal(outcome.passed,false);assert.equal(outcome.criticalFalsePasses,1);
});
test('fabricated quotes are rejected, never counted as a valid review',async()=>{
 const {m,corpus,candidates}=await make();
 const victim=candidates.cases.find(x=>x.id==='b2-complete');
 victim.review.items[0].quote='Придуманные факты и несуществующий результат';
 const outcome=m.assess(corpus,candidates);
 assert.equal(outcome.passed,false);assert.equal(outcome.invalid,1);assert(outcome.coverage<1);
});
test('missing cases and duplicates fail; unknown sample IDs are forbidden',async()=>{
 const {m,corpus,candidates}=await make();
 const without={...candidates,cases:candidates.cases.slice(1)};
 assert.equal(m.assess(corpus,without).passed,false);
 assert.throws(()=>m.assess(corpus,{...candidates,cases:[...candidates.cases,candidates.cases[0]]}),/Duplicate/);
 assert.throws(()=>m.assess(corpus,{...candidates,cases:[...candidates.cases,{id:'unknown'}]}),/Unknown/);
});
test('no model output is reported as not calibrated (not a success)',async()=>{
 const {m,corpus}=await make();
 const result=m.assess(corpus,{schema:'course-rubric-review-results-v1',cases:[]});
 assert.equal(result.passed,false);assert.equal(result.coverage,0);
});
