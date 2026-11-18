import '../progress-sync-model.js';
import {createHandler} from './api.mjs';
import {reviewWithModel} from './ai-review.mjs';
import {createFreeReviewBudget,FREE_REVIEW_POLICY} from './free-review-budget.mjs';
export default {
 fetch(request,env){
  if(!env?.DB)return new Response('Storage unavailable',{status:503});
  const origins=(env.COURSE_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  // Never allow a paid-only model, even when older flags remain enabled.
  // Confirmation requires independently verifying the account is Workers Free.
  // The Free plan stops beyond its own daily no-charge Neuron allocation.
  const enabled=env.AI_REVIEW_ENABLED==='true'&&
    env.AI_REVIEW_CALIBRATED==='true'&&
    env.AI_REVIEW_FREE_PLAN_CONFIRMED==='true'&&
    env.AI_REVIEW_MODEL===FREE_REVIEW_POLICY.model&&
    env.AI&&typeof env.AI.run==='function'&&
    env.AI_REVIEW_LIMITER&&typeof env.AI_REVIEW_LIMITER.limit==='function';
  const budget=enabled?createFreeReviewBudget(env.DB):null;
  const reviewProvider=enabled?(input=>reviewWithModel(input,{
   run:env.AI.run.bind(env.AI),model:FREE_REVIEW_POLICY.model
  })):null;
  const reviewLimiter=enabled?(async account=>{
   // The short-lived per-user limit is an extra anti-abuse layer, not a global quota.
   const limited=await env.AI_REVIEW_LIMITER.limit({key:account});
   return limited?.success===true;
  }):null;
  const reviewBudget=enabled?(account=>budget.reserve(account)):null;
  return createHandler({db:env.DB,origins,botToken:env.TELEGRAM_BOT_TOKEN||null,
   oidcClientId:env.TELEGRAM_CLIENT_ID||null,
   reviewProvider,reviewLimiter,reviewBudget})(request);
 }
};
