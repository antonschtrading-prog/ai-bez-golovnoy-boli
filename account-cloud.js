/* Opt-in, read-only Cloudflare account access. Tokens stay in memory.
 * No local progress is uploaded, and no browser storage is modified.
 */
(function(root){'use strict';
 function create({baseURL,fetchImpl,initData}){
  if(typeof baseURL!=='string')throw Error('API URL not configured');
  const url=new URL(baseURL);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('HTTPS API origin required');
  if(typeof fetchImpl!=='function')throw Error('Fetch unavailable');
  let token=null,accountId=null;
  async function request(path,options={}){
   const response=await fetchImpl(url.origin+path,{...options,credentials:'omit',cache:'no-store',redirect:'error',
    headers:{...options.headers,...(token?{Authorization:'Bearer '+token}:{})}});
   let body;
   try{body=await response.json()}catch(_){throw Error('Invalid server response')}
   if(!response.ok)throw Error(typeof body.error==='string'?body.error:'Server error');
   return body;
  }
  async function login(){
   if(typeof initData!=='string'||!initData)throw Error('Open this page inside Telegram Mini App');
   // Explicit action only. A new login revokes the locally held token.
   token=null;accountId=null;
   const result=await request('/v1/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData})});
   if(typeof result.token!=='string'||!(/^[A-Za-z0-9_-]{32,256}$/).test(result.token)||typeof result.accountId!=='string')throw Error('Invalid login response');
   token=result.token;accountId=result.accountId;
   return {accountId};
  }
  async function read(){
   if(!token)throw Error('Sign in first');
   const result=await request('/v1/progress');
   if(!root.CourseAccountPreview||typeof root.CourseAccountPreview.remote!=='function')throw Error('Progress validator unavailable');
   return root.CourseAccountPreview.remote(result);
  }
  async function logout(){
   if(!token)return;
   try{await request('/v1/session',{method:'DELETE'});}finally{token=null;accountId=null;}
  }
  function clear(){token=null;accountId=null}
  return Object.freeze({login,read,logout,clear,isSignedIn:()=>!!token,account:()=>accountId});
 }
 root.CourseCloudAccount=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
