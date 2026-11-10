const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../account-cloud.js'),'utf8');
const model=fs.readFileSync(require('node:path').join(__dirname,'../progress-sync-model.js'),'utf8');
function setup(fetchImpl){
 const root={URL,fetch:fetchImpl,CourseAccountPreview:{remote:x=>x}};
 root.window=root;vm.runInNewContext(model,root);vm.runInNewContext(source,root);
 return root.CourseCloudAccount;
}
test('authenticated save uses If-Match and idempotency only after explicit call',async()=>{
 const requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push({url,options});
  if(url.endsWith('/v1/auth/telegram'))return {ok:true,status:200,json:async()=>({token:'z'.repeat(48),accountId:'account'})};
  if(options.method==='PUT')return {ok:true,status:200,json:async()=>({revision:6})};
  throw Error('unexpected request');
 };
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'valid'});
 await api.login();
 assert.equal(requests.length,1);
 const result=await api.save({'ai-no-headache-v1':{completed:['a']}},5,'secure_op_123456789');
 assert.equal(result.revision,6);
 assert.equal(requests.length,2);
 const req=requests[1];
 assert.equal(req.url,'https://worker.example.org/v1/progress');
 assert.equal(req.options.method,'PUT');
 assert.equal(req.options.headers['If-Match'],'"5"');
 assert.equal(req.options.headers['Idempotency-Key'],'secure_op_123456789');
 assert.equal(req.options.headers.Authorization,'Bearer '+'z'.repeat(48));
 assert.deepEqual(JSON.parse(req.options.body).sections['ai-no-headache-v1'].completed,['a']);
});
test('invalid revisions, operation IDs and unsafe data never reach network',async()=>{
 let calls=0;
 const fetchImpl=async(url)=>{calls++;
  if(url.endsWith('telegram'))return {ok:true,json:async()=>({token:'z'.repeat(48),accountId:'account'})};
  throw Error('unexpected');
 };
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'valid'});
 await api.login();
 await assert.rejects(api.save({},-1,'secure_op_123456789'));
 await assert.rejects(api.save({},0,'bad'));
 await assert.rejects(api.save({bad:{}},0,'secure_op_123456789'));
 assert.equal(calls,1);
});
test('HTTP 409 retains conflict for guarded commit to handle',async()=>{
 const fetchImpl=async(url,options)=>url.endsWith('telegram')?
  {ok:true,json:async()=>({token:'z'.repeat(48),accountId:'account'})}:
  {ok:false,status:409,json:async()=>({error:'revision_conflict',revision:8})};
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'valid'});
 await api.login();
 const result=await api.save({},5,'secure_op_123456789');
 assert.equal(result.conflict,true);
 assert.equal(result.revision,8);
});
test('unauthenticated API cannot write',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected')};
 const api=setup(fetchImpl).create({baseURL:'https://worker.example.org/',fetchImpl,initData:'valid'});
 await assert.rejects(api.save({},0,'secure_op_123456789'),/Sign in first/);
 assert.equal(calls,0);
});
