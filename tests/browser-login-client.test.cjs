const {test}=require('node:test'),assert=require('node:assert/strict');
require('../browser-telegram-login.js');
const nonce='n'.repeat(43);
test('browser login requires server challenge and verifies through backend before accepting session',async()=>{
 let sdkOptions,requests=[];
 const sdk={auth:(options,callback)=>{sdkOptions=options;callback({id_token:'signed.id.token',user:{id:999999}})}};
 const fetchImpl=async(path,options)=>{
  requests.push({path,options});
  if(path.endsWith('/challenge'))return{ok:true,json:async()=>({nonce,expires:Date.now()+300000})};
  if(path.endsWith('/v1/auth/browser'))return{ok:true,json:async()=>({token:'verified-server-token',accountId:'tg_real_account',expires:123})};
  if(path.endsWith('/v1/session'))return{ok:true};
  throw Error('Unexpected request');
 };
 const auth=CourseBrowserLogin.create({baseURL:'https://api.example',clientId:123456,telegramLogin:sdk,fetchImpl});
 assert.equal(auth.getToken(),null);
 const logged=await auth.login();
 assert.equal(logged.accountId,'tg_real_account');assert.equal(auth.getToken(),'verified-server-token');
 assert.equal(sdkOptions.nonce,nonce);
 assert.equal(sdkOptions.client_id,123456);
 assert.equal(requests.length,2);
 assert.equal(JSON.parse(requests[1].options.body).idToken,'signed.id.token');
 assert.equal(requests[1].options.credentials,'omit');
 assert.equal((await auth.logout()).serverRevoked,true);
 assert.equal(auth.getToken(),null);
});
test('browser login discards unverified SDK payload and rejects unsafe origins',async()=>{
 assert.throws(()=>CourseBrowserLogin.create({baseURL:'http://external.example',clientId:1,telegramLogin:{auth(){}}}),/HTTPS/);
 const sdk={auth:(_,cb)=>cb({user:{id:123456}})};
 const fetchImpl=async()=>({ok:true,json:async()=>({nonce})});
 const client=CourseBrowserLogin.create({baseURL:'https://api.example',clientId:123456,telegramLogin:sdk,fetchImpl});
 await assert.rejects(()=>client.login(),/cancelled/);
 assert.equal(client.current().authenticated,false);
});
test('server rejects fake JWT even when SDK provides plausible user data',async()=>{
 const sdk={auth:(_,cb)=>cb({id_token:'fake',user:{id:987}})};
 const request=async(url)=>{
  if(url.endsWith('/challenge'))return{ok:true,json:async()=>({nonce})};
  return{ok:false,json:async()=>({error:'invalid_browser_login'})};
 };
 const browser=CourseBrowserLogin.create({baseURL:'https://api.example',clientId:1234,telegramLogin:sdk,fetchImpl:request});
 await assert.rejects(()=>browser.login(),/invalid_browser_login/);
 assert.equal(browser.getToken(),null);
});
test('logout clears memory token even if revocation network fails',async()=>{
 let step=0;
 const browser=CourseBrowserLogin.create({baseURL:'https://api.example',clientId:1,
  telegramLogin:{auth:(_,cb)=>cb({id_token:'legit'})},
  fetchImpl:async()=>{step++;if(step===1)return{ok:true,json:async()=>({nonce})};if(step===2)return{ok:true,json:async()=>({token:'t'.repeat(43),accountId:'tg_x'})};throw Error('offline')}});
 await browser.login();
 const result=await browser.logout();
 assert.equal(result.locallySignedOut,true);assert.equal(result.serverRevoked,false);
 assert.equal(browser.getToken(),null);
});
