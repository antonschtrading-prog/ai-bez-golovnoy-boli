import '../progress-sync-model.js';
import {createHandler} from './api.mjs';
import {reviewWithModel} from './ai-review.mjs';
export default {
 fetch(request,env){
  if(!env?.DB)return new Response('Storage unavailable',{status:503});
  const origins=(env.COURSE_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  // Explicit production opt-in: no model calls or costs without AI, limiter, model and flag.
  const enabled=env.AI_REVIEW_ENABLED==='true'&&env.AI_REVIEW_CALIBRATED==='true'&&env.AI&&env.AI_REVIEW_LIMITER&&
   typeof env.AI_REVIEW_LIMITER.limit==='function'&&typeof env.AI_REVIEW_MODEL==='string'&&env.AI_REVIEW_MODEL.startsWith('@cf/');
  const reviewProvider=enabled?(input=>reviewWithModel(input,{
   run:env.AI.run.bind(env.AI),model:env.AI_REVIEW_MODEL
  })):null;
  const reviewLimiter=enabled?(async account=>{
   const result=await env.AI_REVIEW_LIMITER.limit({key:account});
   return result?.success===true;
  }):null;
  return createHandler({db:env.DB,origins,botToken:env.TELEGRAM_BOT_TOKEN||null,
   oidcClientId:env.TELEGRAM_CLIENT_ID||null,reviewProvider,reviewLimiter})(request);
 }
};
