import '../progress-sync-model.js';
import {createHandler} from './api.mjs';
export default {
 fetch(request,env){
  if(!env?.DB)return new Response('Storage unavailable',{status:503});
  const origins=(env.COURSE_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  return createHandler({db:env.DB,origins,botToken:env.TELEGRAM_BOT_TOKEN||null,oidcClientId:env.TELEGRAM_CLIENT_ID||null})(request);
 }
};
