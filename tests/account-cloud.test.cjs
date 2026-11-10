const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../account-cloud.js'),'utf8');
function setup(fetchImpl){
 const root={URL,fetch:fetchImpl,CourseAccountPreview:{remote(x){
  if(!Number.isSafeInteger(x.revision)||x.revision<0||!x.sections||typeof x.sections!=='object')throw Error('Invalid progress');
  return x;
 }}};
 root.window=root;vm.runInNewContext(source,root);
 return root.CourseCloudAccount;
}
test('cannot enable cloud without secure fixed API origin',()=>{
 const cloud=setup(async()=>{throw Error('must not call')});
 for(const url of ['http://example.org/','https://user:pass@example.org/','https://example.org/a','https://example.org/?a=1']){
  assert.throws(()=>cloud.create({baseURL:url,fetchImpl:()=>{},initData:'a'}));
 }
});
test('no requests until explicit login; read-only preview; token never stored',async()=>{
 const requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push({url,options});
  if(url.endsWith('/v1/auth/telegram'))return {ok:true,json:async()=>({token:'a'.repeat(48),accountId:'acct_test'})};
  if(url.endsWith('/v1/progress'))return {ok:true,json:async()=>({revision:2,sections:{}})};
  if(url.endsWith('/v1/session'))return {ok:true,json:async()=>({signedOut:true})};
  throw Error('Unexpected endpoint');
 };
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'signed-data'});
 assert.equal(requests.length,0);
 assert.equal(api.isSignedIn(),false);
 await api.login();assert.equal(api.isSignedIn(),true);
 const snapshot=await api.read();assert.equal(snapshot.revision,2);
 await api.logout();assert.equal(api.isSignedIn(),false);
 assert.deepEqual(requests.map(x=>x.options.method||'GET'),['POST','GET','DELETE']);
 assert.ok(requests.every(x=>x.options.credentials==='omit'&&x.options.cache==='no-store'&&x.options.redirect==='error'));
 assert.equal(requests[1].options.headers.Authorization,'Bearer '+'a'.repeat(48));
 assert.equal(requests[2].options.headers.Authorization,'Bearer '+'a'.repeat(48));
 assert.ok(requests.every(x=>!['PUT','PATCH'].includes(x.options.method)));
 assert.rejects(api.read(),/Sign in first/);
});
test('no Telegram initData: no requests, no login',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected')};
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:''});
 await assert.rejects(api.login(),/Telegram Mini App/);assert.equal(calls,0);
});
test('failed login does not leave a live session',async()=>{
 const fetchImpl=async()=>({ok:false,json:async()=>({error:'telegram_not_configured'})});
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'signed-data'});
 await assert.rejects(api.login(),/telegram_not_configured/);assert.equal(api.isSignedIn(),false);
});
test('logout clears memory even when remote revoke fails',async()=>{
 const fetchImpl=async(url)=>url.endsWith('telegram')?
  {ok:true,json:async()=>({token:'b'.repeat(48),accountId:'acct'})}:
  {ok:false,json:async()=>({error:'offline'})};
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'signed-data'});
 await api.login();await assert.rejects(api.logout(),/offline/);
 assert.equal(api.isSignedIn(),false);
});
