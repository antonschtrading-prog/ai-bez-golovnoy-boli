const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path'),vm=require('node:vm');
const model=readFileSync(join(__dirname,'../progress-sync-model.js'),'utf8');
const clientCode=readFileSync(join(__dirname,'../account-cloud.js'),'utf8');
const nonce='N'.repeat(43);
function create(fetchImpl){
 const root={URL,fetch:fetchImpl,Date,CourseAccountPreview:{remote:x=>x}};
 root.window=root;vm.runInNewContext(model,root);vm.runInNewContext(clientCode,root);
 return root.CourseCloudAccount.create({baseURL:'https://worker.example.org/',fetchImpl,initData:''});
}
test('browser login: server-issued nonce then JWT exchange, no client token in storage',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/v1/auth/browser/challenge'))return{ok:true,status:200,json:async()=>({nonce,expires:Date.now()+300000})};
  if(url.endsWith('/v1/auth/browser'))return{ok:true,status:200,json:async()=>({token:'T'.repeat(48),accountId:'tg_account'})};
  if(url.endsWith('/v1/progress'))return{ok:true,status:200,json:async()=>({revision:3,sections:{}})};
  throw Error('unexpected '+url);
 };
 const api=create(fetchImpl);assert.equal(calls.length,0);
 const challenge=await api.browserChallenge();assert.equal(challenge.nonce,nonce);
 assert.equal(api.isSignedIn(),false);
 await api.browserComplete('x'.repeat(70),nonce);
 assert.equal(api.isSignedIn(),true);assert.equal(api.account(),'tg_account');
 assert.equal((await api.read()).revision,3);
 assert.deepEqual(calls.map(x=>x.options.method||'GET'),['POST','POST','GET']);
 assert.equal(calls[1].options.headers['Content-Type'],'application/json');
 assert.equal(JSON.parse(calls[1].options.body).nonce,nonce);
 assert.equal(JSON.parse(calls[1].options.body).idToken,'x'.repeat(70));
 assert.equal(calls[2].options.headers.Authorization,'Bearer '+'T'.repeat(48));
 assert.ok(calls.every(x=>x.options.redirect==='error'&&x.options.credentials==='omit'));
});
test('server rejects login when the challenge is expired or absent',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return{ok:true,status:200,json:async()=>({nonce,expires:Date.now()-100})}};
 const api=create(fetchImpl);
 await assert.rejects(api.browserChallenge(),/Invalid browser login challenge/);
 await assert.rejects(api.browserComplete('short',nonce),/Invalid Telegram login token/);
 assert.equal(calls,1);assert.equal(api.isSignedIn(),false);
});
test('untrusted Telegram token and bad nonce cannot start session',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('network must not be used')};
 const api=create(fetchImpl);
 await assert.rejects(api.browserComplete('x'.repeat(70),'not-a-valid-nonce'));
 assert.equal(calls,0);
});
test('failed server signature validation leaves browser unsigned',async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return{ok:false,status:401,json:async()=>({error:'invalid_browser_login'})}};
 const api=create(fetchImpl);
 await assert.rejects(api.browserComplete('x'.repeat(70),nonce),/invalid_browser_login/);
 assert.equal(api.isSignedIn(),false);assert.equal(calls,1);
});
