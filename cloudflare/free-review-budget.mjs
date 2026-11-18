/* Global UTC day safety cap on review calls. These are conservative
 * reservations, not billed token accounting. On an unconfirmed plan, FAIL CLOSED.
 * D1 conditional UPSERT is atomic across global Cloudflare locations.
 */
const DAY=/^\d{4}-\d\d-\d\d$/;
const ACCOUNT=/^[A-Za-z0-9_-]{1,128}$/;
export const FREE_REVIEW_POLICY=Object.freeze({
 model:'@cf/meta/llama-3.1-8b-instruct-fp8-fast',
 totalDaily:8,
 perAccountDaily:2,
 maxOutputTokens:1250,
 freeNeuronAllocation:10000,
 // Conservative per invocation estimate for the pinned low-cost 8B model.
 // The Free plan, not this estimate, is the actual zero-spend enforcement.
 estimatedMaxNeuronsPerReview:500
});
export function utcDay(now=Date.now()){
 if(!Number.isFinite(now))throw Error('invalid_clock');
 return new Date(now).toISOString().slice(0,10);
}
export function createFreeReviewBudget(db,{totalDaily=FREE_REVIEW_POLICY.totalDaily,
 perAccountDaily=FREE_REVIEW_POLICY.perAccountDaily}={}){
 if(!db||typeof db.prepare!=='function'||
    !Number.isSafeInteger(totalDaily)||totalDaily<1||totalDaily>8||
    !Number.isSafeInteger(perAccountDaily)||perAccountDaily<1||perAccountDaily>2)
  throw Error('invalid_free_review_budget_config');
 async function reserve(scope,day,max){
  const statement=db.prepare(
   'INSERT INTO ai_review_daily_budget(day,scope,used) VALUES(?,?,1) '+
   'ON CONFLICT(day,scope) DO UPDATE SET used=ai_review_daily_budget.used+1 '+
   'WHERE ai_review_daily_budget.used < ?'
  ).bind(day,scope,max);
  const result=await statement.run();
  return result?.meta?.changes===1;
 }
 return Object.freeze({
  async reserve(account,day=utcDay()){
   if(typeof account!=='string'||!ACCOUNT.test(account)||!DAY.test(day))throw Error('invalid_review_budget_identity');
   // Account first: rejected repeated calls never deplete global reservations.
   // If global cap fails after local succeeds, local reservation is not refunded:
   // safety and zero additional AI use take priority over full utilization.
   if(!await reserve('account:'+account,day,perAccountDaily))return {ok:false,reason:'account_limit'};
   if(!await reserve('global',day,totalDaily))return {ok:false,reason:'global_limit'};
   return {ok:true};
  },
  async status(account,day=utcDay()){
   if(typeof account!=='string'||!ACCOUNT.test(account)||!DAY.test(day))throw Error('invalid_review_budget_identity');
   const rows=await db.prepare(
    'SELECT scope,used FROM ai_review_daily_budget WHERE day=? AND (scope=? OR scope=?)'
   ).bind(day,'global','account:'+account).all();
   const count=Object.fromEntries((rows.results||[]).map(x=>[x.scope,x.used]));
   return {day,globalRemaining:Math.max(0,totalDaily-(count.global||0)),
    accountRemaining:Math.max(0,perAccountDaily-(count['account:'+account]||0))};
  }
 });
}
