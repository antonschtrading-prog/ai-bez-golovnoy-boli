/* Explicit adapter only: no automatic network requests or localStorage tokens. */
(function(root){'use strict';
function create({baseURL,getToken,fetchImpl=root.fetch.bind(root)}){
 const url=new URL(baseURL);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('HTTPS required');
 if(url.username||url.password||url.search||url.hash)throw Error('Invalid API URL');
 const base=baseURL.replace(/\/$/,'');
 async function request(path,options={}){
  const token=await getToken();if(!token)throw Error('Account required');
  const response=await fetchImpl(base+path,{...options,credentials:'omit',redirect:'error',cache:'no-store',headers:{...options.headers,Authorization:'Bearer '+token}});
  const body=await response.json();
  if(response.status===409)return{conflict:true,...body};
  if(!response.ok)throw Error(body.error||'Request failed');
  return body;
 }
 return Object.freeze({read:()=>request('/v1/progress'),versions:()=>request('/v1/progress/versions'),
  save:(sections,revision,operationId)=>request('/v1/progress',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':`"${revision}"`,'Idempotency-Key':operationId},body:JSON.stringify({sections})}),
  linkTelegram:initData=>request('/v1/telegram/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData})})});
}
root.CourseProgressClient=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
