'use strict';
require('../progress-sync-model.js');
const {verify}=require('./telegram.cjs');
const MAX=1024*1024;
function handler({store,origins=[],botToken}){
 return async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  const origin=req.headers.origin;
  if(origin&&!origins.includes(origin))return send(403,{error:'origin_denied'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','ETag')}
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','GET, PUT, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, If-Match, Idempotency-Key');return send(204,{});
  }
  try{
  const token=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization||'')?.[1];
  const account=token&&store.authenticate(token);if(!account)return send(401,{error:'unauthorized'});
   if(req.url==='/v1/session'&&req.method==='GET')return send(200,{accountId:account,authenticated:true});
   if(req.url==='/v1/session'&&req.method==='DELETE'){store.revoke(token);return send(200,{signedOut:true})}
   if(req.url==='/v1/progress'&&req.method==='GET'){const data=store.get(account);res.setHeader('ETag',`"${data.revision}"`);return send(200,data)}
   if(req.url==='/v1/progress/versions'&&req.method==='GET')return send(200,{versions:store.history(account)});
   if(!((req.url==='/v1/progress'&&req.method==='PUT')||(req.url==='/v1/telegram/link'&&req.method==='POST')))return send(404,{error:'not_found'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(415,{error:'json_required'});
   let size=0,chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>MAX){send(413,{error:'body_too_large'});return}chunks.push(chunk)}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch(_){return send(400,{error:'invalid_json'})}
   if(req.url==='/v1/telegram/link'){
    if(!botToken)return send(503,{error:'telegram_not_configured'});
    try{const data=verify(body.initData,botToken);store.link(account,data.user,data.hash,data.expires);return send(200,{linked:true})}catch(_){return send(409,{error:'telegram_link_rejected'})}
   }
   const match=/^"(0|[1-9]\d*)"$/.exec(req.headers['if-match']||'');
   if(!match)return send(428,{error:'revision_required'});
   const base=Number(match[1]),id=req.headers['idempotency-key'];
   if(!Number.isSafeInteger(base)||base>=Number.MAX_SAFE_INTEGER||typeof id!=='string'||! /^[A-Za-z0-9_-]{8,128}$/.test(id))return send(400,{error:'invalid_operation'});
   let sections;
   try{
    if(!body||Object.keys(body).some(k=>k!=='sections'))throw Error();
    sections=globalThis.CourseSyncModel.makeEnvelope(body.sections,{deviceId:'server-validation'}).sections;
   }catch(_){return send(422,{error:'invalid_progress'})}
   const {status,...result}=store.put(account,id,base,sections);
   if(result.revision!==undefined)res.setHeader('ETag',`"${result.revision}"`);
   return send(status,result);
  }catch(_){return send(500,{error:'storage_failure'})}
 };
}
module.exports={handler};
