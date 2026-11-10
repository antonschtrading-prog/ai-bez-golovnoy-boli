/* Free browser Telegram Login adapter. Client token exists only in memory.
 * Login must begin from explicit user interaction (popup constraints).
 * The Telegram SDK callback's decoded user is NEVER used as an identity.
 */
(function(root){'use strict';
function create({baseURL,clientId,telegramLogin,fetchImpl=root.fetch.bind(root)}){
 const parsed=new URL(baseURL);
 if(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&['127.0.0.1','localhost'].includes(parsed.hostname)))throw Error('HTTPS required');
 if(parsed.search||parsed.hash||parsed.username||parsed.password)throw Error('Invalid API URL');
 if(!Number.isSafeInteger(Number(clientId))||Number(clientId)<=0||!telegramLogin||typeof telegramLogin.auth!=='function')throw Error('Telegram Login library not ready');
 const base=baseURL.replace(/\/$/,'');let token=null,accountId=null;
 async function post(path,body){
  const res=await fetchImpl(base+path,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok)throw Error(data.error||'Telegram login failed');
  return data;
 }
 async function login(){
  if(token)throw Error('Sign out before starting another login');
  const challenge=await post('/v1/auth/browser/challenge',{});
  if(typeof challenge.nonce!=='string'||challenge.nonce.length<32)throw Error('Invalid server login challenge');
  const auth=await new Promise((resolve,reject)=>{
   try{telegramLogin.auth({client_id:Number(clientId),scope:['profile'],nonce:challenge.nonce},result=>{
    if(result?.error||!result?.id_token)reject(Error('Telegram authorization was cancelled'));
    else resolve(result.id_token);
   })}catch(e){reject(e)}
  });
  const session=await post('/v1/auth/browser',{nonce:challenge.nonce,idToken:auth});
  if(typeof session.token!=='string'||typeof session.accountId!=='string')throw Error('Invalid server session');
  token=session.token;accountId=session.accountId;
  return {accountId,expires:session.expires};
 }
 function getToken(){return token}
 function current(){return token?{authenticated:true,accountId}:{authenticated:false}}
 async function logout(){
  const currentToken=token;
  token=null;accountId=null;
  if(!currentToken)return {locallySignedOut:true,serverRevoked:false};
  try{
   const res=await fetchImpl(base+'/v1/session',{method:'DELETE',credentials:'omit',redirect:'error',cache:'no-store',
    headers:{Authorization:'Bearer '+currentToken}});
   return {locallySignedOut:true,serverRevoked:res.ok};
  }catch(_){return{locallySignedOut:true,serverRevoked:false}}
 }
 return Object.freeze({login,getToken,current,logout});
}
root.CourseBrowserLogin=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
