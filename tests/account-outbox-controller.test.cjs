const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model.js');require('../progress-core.js');
require('../progress-merge-rules.js');require('../progress-sync-planner.js');
require('../account-preview.js');require('../progress-outbox.js');
require('../account-outbox-controller.js');
const K='ai-no-headache-v1';
function storage(initial={}){
 const m=new Map(Object.entries(initial));
 return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),all:()=>[...m.entries()]};
}
function locks(){
 const chains=new Map();
 return {request(name,opts,task){
  const previous=chains.get(name)||Promise.resolve();
  const current=previous.catch(()=>{}).then(task);
  chains.set(name,current.catch(()=>{}));
  return current;
 }};
}
function setup(){
 const local=storage({[K]:JSON.stringify({completed:['A']})});
 const network={revision:0,sections:{}},calls=[];
 const client={read:async()=>structuredClone(network),save:async(sections,base,id)=>{
  calls.push({sections,base,id});
  if(base!==network.revision)return {conflict:true};
  network.revision++;network.sections=structuredClone(sections);
  return {revision:network.revision,sections:structuredClone(sections)};
 }};
 let seq=0;const randomUUID=()=> 'ticket_secure_'+(++seq);
 const lock=locks();
 const create=(accountId='tg_account123456789')=>CourseAccountOutboxController.create({
  storage:local,client,accountId,locks:lock,randomUUID
 });
 return {local,client,network,calls,create};
}
test('prepares and queues only with explicit consent, without uploading',async()=>{
 const f=setup(),q=f.create(),original=f.local.all();
 const preview=await q.inspect();
 assert.equal(preview.status,'ready');
 await assert.rejects(q.approve(preview.ticket,false),/explicit approval/);
 assert.equal(q.pending(),null);
 const approved=await q.approve(preview.ticket,true);
 assert.equal(approved.status,'queued');
 assert.equal(f.calls.length,0);
 assert.ok(q.pending());assert.deepEqual(f.local.getItem(K),JSON.stringify({completed:['A']}));
 assert.equal((await q.retry()).status,'synced');
 assert.equal(f.calls.length,1);assert.equal(q.pending(),null);
 assert.equal(f.local.getItem(K),JSON.stringify({completed:['A']}));
});
test('two tabs cannot overwrite pending operation',async()=>{
 const f=setup(),tab1=f.create(),tab2=f.create();
 const a=await tab1.inspect(),b=await tab2.inspect();
 await tab1.approve(a.ticket,true);
 await assert.rejects(tab2.approve(b.ticket,true),/Existing unsent operation/);
 assert.equal(f.calls.length,0);
 assert.ok(tab1.pending());
});
test('local changes after review stop queue creation',async()=>{
 const f=setup(),q=f.create(),p=await q.inspect();
 f.local.setItem(K,JSON.stringify({completed:['A','B']}));
 await assert.rejects(q.approve(p.ticket,true),/Local data changed/);
 assert.equal(q.pending(),null);
});
test('new cloud revision after review stops queue creation',async()=>{
 const f=setup(),q=f.create(),p=await q.inspect();
 f.network.revision=1;
 await assert.rejects(q.approve(p.ticket,true),/Cloud data changed/);
 assert.equal(q.pending(),null);
});
test('pending operation stays account scoped',async()=>{
 const f=setup(),a=f.create(),b=f.create('tg_another123456789');
 const p=await a.inspect();await a.approve(p.ticket,true);
 assert.equal(b.pending(),null);assert.ok(a.pending());
});
test('no Web Locks refuses unsafe writes',()=>{
 const f=setup();
 assert.throws(()=>CourseAccountOutboxController.create({
  storage:f.local,client:f.client,accountId:'tg_account123456789',
  locks:null,randomUUID:()=> 'good_secure_id'
 }),/secure lock/);
});
test('recovery after refresh can verify stored pending operation',async()=>{
 const f=setup(),one=f.create(),p=await one.inspect();await one.approve(p.ticket,true);
 const resumed=f.create();
 const status=await resumed.retry();
 assert.equal(status.status,'synced');assert.equal(f.calls.length,1);
 assert.equal(resumed.pending(),null);
});
