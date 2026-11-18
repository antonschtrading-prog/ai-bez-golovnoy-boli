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
   if(response.status===409)return {conflict:true,...body};
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
  async function browserChallenge(){
   token=null;accountId=null;
   const challenge=await request('/v1/auth/browser/challenge',{method:'POST'});
   if(typeof challenge.nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(challenge.nonce)||
      !Number.isFinite(challenge.expires)||challenge.expires<=Date.now())throw Error('Invalid browser login challenge');
   return {nonce:challenge.nonce,expires:challenge.expires};
  }
  async function browserComplete(idToken,nonce){
   if(typeof idToken!=='string'||idToken.length<50||idToken.length>20000||
      typeof nonce!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(nonce))throw Error('Invalid Telegram login token');
   const result=await request('/v1/auth/browser',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken,nonce})});
   if(typeof result.token!=='string'||!(/^[A-Za-z0-9_-]{32,256}$/).test(result.token)||
      typeof result.accountId!=='string')throw Error('Invalid login response');
   token=result.token;accountId=result.accountId;
   return {accountId};
  }
  async function save(sections,revision,operationId){
   if(!token)throw Error('Sign in first');
   if(!Number.isSafeInteger(revision)||revision<0||!(/^[A-Za-z0-9_-]{8,128}$/).test(operationId))throw Error('Invalid revision or operation ID');
   const payload=root.CourseSyncModel.makeEnvelope(sections,{deviceId:'account-cloud-save'}).sections;
   return request('/v1/progress',{method:'PUT',headers:{
    'Content-Type':'application/json','If-Match':'"'+revision+'"','Idempotency-Key':operationId
   },body:JSON.stringify({sections:payload})});
  }
  async function reviewStatus(){
   if(!token)throw Error('Sign in first');
   return request('/v1/review/status');
  }
  async function review(input){
   if(!token)throw Error('Sign in first');
   if(!input||typeof input!=='object')throw Error('Invalid review request');
   return request('/v1/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  }
  async function logout(){
   if(!token)return;
   try{await request('/v1/session',{method:'DELETE'});}finally{token=null;accountId=null;}
  }
  function clear(){token=null;accountId=null}
  return Object.freeze({login,browserChallenge,browserComplete,read,save,review,reviewStatus,logout,clear,isSignedIn:()=>!!token,account:()=>accountId});
 }
 // A same-origin child may borrow the shell session without seeing its token.
 // Signing out of the manual tools detaches only that view, not autosaving.
 function borrow(source){
  let attached=false;
  function requireSession(){if(!attached||!source.isSignedIn())throw Error('Sign in first')}
  return Object.freeze({
   async login(){if(!source.isSignedIn())throw Error('Mini App session expired');attached=true;return {accountId:source.account()}},
   async read(){requireSession();return source.read()},
   async save(...args){requireSession();return source.save(...args)},
   async review(...args){requireSession();return source.review(...args)},
   async reviewStatus(){requireSession();return source.reviewStatus()},
   async logout(){attached=false},clear(){attached=false},
   isSignedIn:()=>attached&&source.isSignedIn(),account:()=>attached&&source.isSignedIn()?source.account():null
  });
 }
 root.CourseCloudAccount=Object.freeze({create,borrow});
})(typeof window!=='undefined'?window:globalThis);
