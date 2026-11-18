const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const schema=readFileSync(join(__dirname,'../cloudflare/migrations/0003_ai_review_budget.sql'),'utf8');
function memory({migrated=true}={}){
 const sqlite=new DatabaseSync(':memory:');
 if(migrated)sqlite.exec(schema);
 const prepare=(query,args=[])=>({
  bind(...next){return prepare(query,next)},
  async run(){const x=sqlite.prepare(query).run(...args);return{meta:{changes:x.changes}}},
  async all(){return{results:sqlite.prepare(query).all(...args)}}
 });
 return {prepare,close:()=>sqlite.close()};
}
test('only the Free model may be used and reservation cap is small relative to free allocation',async()=>{
 const {FREE_REVIEW_POLICY}=await import('../cloudflare/free-review-budget.mjs');
 assert.equal(FREE_REVIEW_POLICY.model,'@cf/meta/llama-3.1-8b-instruct-fp8-fast');
 assert.equal(FREE_REVIEW_POLICY.totalDaily,8);
 assert.equal(FREE_REVIEW_POLICY.perAccountDaily,2);
 assert(FREE_REVIEW_POLICY.estimatedMaxNeuronsPerReview*FREE_REVIEW_POLICY.totalDaily < FREE_REVIEW_POLICY.freeNeuronAllocation);
});
test('daily global and per-account limits survive remounting instances, use UTC and reset next day',async t=>{
 const db=memory();t.after(db.close);
 const {createFreeReviewBudget}=await import('../cloudflare/free-review-budget.mjs');
 const one=createFreeReviewBudget(db,{totalDaily:3,perAccountDaily:2});
 const two=createFreeReviewBudget(db,{totalDaily:3,perAccountDaily:2});
 assert.equal((await one.reserve('acct1','2026-11-18')).ok,true);
 assert.equal((await two.reserve('acct1','2026-11-18')).ok,true);
 assert.equal((await one.reserve('acct1','2026-11-18')).reason,'account_limit');
 assert.equal((await one.reserve('acct2','2026-11-18')).ok,true);
 assert.equal((await two.reserve('acct3','2026-11-18')).reason,'global_limit');
 const s=await two.status('acct2','2026-11-18');
 assert.equal(s.globalRemaining,0);assert.equal(s.accountRemaining,1);
 assert.equal((await one.reserve('acct1','2026-11-19')).ok,true);
 assert.equal((await one.status('acct1','2026-11-19')).globalRemaining,2);
});
test('concurrent requests share a single global D1 upsert boundary',async t=>{
 const db=memory();t.after(db.close);
 const {createFreeReviewBudget}=await import('../cloudflare/free-review-budget.mjs');
 const a=createFreeReviewBudget(db,{totalDaily:4,perAccountDaily:2});
 const b=createFreeReviewBudget(db,{totalDaily:4,perAccountDaily:2});
 const results=await Promise.all(Array.from({length:30},(_,i)=>(i%2?a:b).reserve('acct'+i,'2026-11-18')));
 assert.equal(results.filter(x=>x.ok).length,4);
 const status=await a.status('acct30','2026-11-18');
 assert.equal(status.globalRemaining,0);
});
test('missing D1 quota migration fails closed instead of granting model access',async t=>{
 const db=memory({migrated:false});t.after(db.close);
 const {createFreeReviewBudget}=await import('../cloudflare/free-review-budget.mjs');
 await assert.rejects(createFreeReviewBudget(db).reserve('acct','2026-11-18'));
});
test('UTC rollover is deterministic and invalid identities/caps cannot bypass the budget',async t=>{
 const db=memory();t.after(db.close);
 const {utcDay,createFreeReviewBudget}=await import('../cloudflare/free-review-budget.mjs');
 assert.equal(utcDay(Date.parse('2026-11-18T23:59:59.000Z')),'2026-11-18');
 assert.equal(utcDay(Date.parse('2026-11-19T00:00:00.000Z')),'2026-11-19');
 assert.throws(()=>createFreeReviewBudget(db,{totalDaily:999}));
 assert.throws(()=>createFreeReviewBudget(db,{perAccountDaily:3}));
 const budget=createFreeReviewBudget(db);
 await assert.rejects(budget.reserve('account:admin','2026-11-18'));
 await assert.rejects(budget.reserve('acct','18.11.2026'));
});
