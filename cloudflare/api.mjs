/* Workers-compatible API. No public token issuance and no live account provider.
 * Same endpoints as local Node API (except Telegram linking, not ported yet).
 */
import {createD1Store} from './d1-store.mjs';
const MAX=1024*1024;
const send=(code,data,extra={})=>new Response(JSON.stringify(data),{status:code,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',...extra}});
async function bodyJSON(request){
 const claimed=Number(request.headers.get('content-length'));
 if(Number.isFinite(claimed)&&claimed>MAX)throw Object.assign(Error('too_large'),{status:413});
 const reader=request.body?.getReader();
 if(!reader)throw Object.assign(Error('invalid_json'),{status:400});
 let length=0;const pieces=[];
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   length+=value.byteLength;
   if(length>MAX){await reader.cancel();throw Object.assign(Error('too_large'),{status:413})}
   pieces.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const part of pieces){bytes.set(part,offset);offset+=part.byteLength}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch(e){if(e.status)throw e;throw Object.assign(Error('invalid_json'),{status:400})}
}
export function createHandler({db,origins=[]}){
 const store=createD1Store(db);
 const allow=new Set(origins);
 return async(request)=>{
  const origin=request.headers.get('origin'),url=new URL(request.url),path=url.pathname;
  const cors=origin&&allow.has(origin)?{
   'Access-Control-Allow-Origin':origin,'Access-Control-Expose-Headers':'ETag','Vary':'Origin'}:{};
  if(origin&&!allow.has(origin))return send(403,{error:'origin_denied'});
  if(url.search)return send(400,{error:'query_forbidden'},cors);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,
   'Access-Control-Allow-Methods':'GET,PUT,DELETE,OPTIONS',
   'Access-Control-Allow-Headers':'Authorization,Content-Type,If-Match,Idempotency-Key',
   'Access-Control-Max-Age':'300'}});
  const answer=(code,data,extra={})=>send(code,data,{...cors,...extra});
  try{
   const token=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('authorization')||'')?.[1];
   if(!token)return answer(401,{error:'unauthorized'});
   const account=await store.authenticate(token);
   if(!account)return answer(401,{error:'unauthorized'});
   if(path==='/v1/session'&&request.method==='GET')return answer(200,{accountId:account,authenticated:true});
   if(path==='/v1/session'&&request.method==='DELETE'){
    await store.revoke(token);
    return answer(200,{signedOut:true});
   }
   if(path==='/v1/progress'&&request.method==='GET'){
    const result=await store.read(account);
    return answer(200,result,{'ETag':'"'+result.revision+'"'});
   }
   if(path==='/v1/progress/versions'&&request.method==='GET')return answer(200,{versions:await store.history(account)});
   if(path!=='/v1/progress'||request.method!=='PUT')return answer(404,{error:'not_found'});
   if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return answer(415,{error:'json_required'});
   const match=/^"(0|[1-9]\d*)"$/.exec(request.headers.get('if-match')||'');
   if(!match)return answer(428,{error:'revision_required'});
   const base=Number(match[1]),id=request.headers.get('idempotency-key');
   if(!Number.isSafeInteger(base)||base>=Number.MAX_SAFE_INTEGER||!id||!/^[A-Za-z0-9_-]{8,128}$/.test(id))return answer(400,{error:'invalid_operation'});
   let input;
   try{input=await bodyJSON(request)}catch(e){return answer(e.status||400,{error:e.status===413?'body_too_large':'invalid_json'})}
   let sections;
   try{
    if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>k!=='sections'))throw Error();
    sections=globalThis.CourseSyncModel.makeEnvelope(input.sections,{deviceId:'worker-validation'}).sections;
   }catch(_){return answer(422,{error:'invalid_progress'})}
   const {status,...result}=await store.put(account,id,base,sections);
   return answer(status,result,result.revision!==undefined?{'ETag':'"'+result.revision+'"'}:{});
  }catch(_){return answer(500,{error:'storage_failure'})}
 };
}
