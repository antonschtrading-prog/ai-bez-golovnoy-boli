const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model.js');require('../progress-core.js');
require('../progress-merge-rules.js');require('../progress-sync-planner.js');
require('../account-preview.js');require('../progress-durable-outbox.js');
const K='ai-no-headache-v1', accountId='tg_account_1';
function memory(initial={}) {
 const m=new Map(Object.entries(initial));
 return {getItem:key=>m.has(key)?m.get(key):null,
 setItem:(key,value)=>m.set(key,value),removeItem:key=>m.delete(key),
 snapshot:()=>[...m.entries()]};
}
function fixture({local={completed:['one']},remote={revision:0,sections:{}},failure=false}={}){
 const storage=memory(),progressStorage=memory({[K]:JSON.stringify(local)});
 let cloud=structuredClone(remote),saves=[],fail=failure;
 const client={read:async()=>structuredClone(cloud),save:async(sections,rev,id)=>{
  saves.push({sections,rev,id});
  if(cloud.revision!==rev)return {conflict:true};
  cloud={revision:rev+1,sections:structuredClone(sections)};
  if(fail)throw Error('connection dropped after server commit');
  return {revision:cloud.revision};
 }};
 const make=()=>CourseDurableOutbox.create({storage,progressStorage,client,accountId,uuid:()=> 'one_op_123456789'});
 return {storage,progressStorage,client,make,saves,setCloud:v=>cloud=structuredClone(v),getCloud:()=>structuredClone(cloud)};
}
test('explicit approval queues without uploading, then verifies server before removal',async()=>{
 const f=fixture(),original=f.progressStorage.snapshot(),queue=f.make();
 const plan=await queue.prepare();assert.equal(plan.status,'ready');
 assert.equal(f.saves.length,0);assert.equal(queue.pending(),null);
 await assert.rejects(queue.approve(plan.ticket,false),/Explicit approval/);
 assert.equal(queue.pending(),null);
 assert.equal((await queue.approve(plan.ticket,true)).status,'queued');
 assert.equal(f.saves.length,0);
 assert.equal(queue.pending().id,plan.ticket);
 const outcome=await queue.sendPending();
 assert.equal(outcome.status,'confirmed');assert.equal(f.saves.length,1);
 assert.equal(queue.pending(),null);assert.deepEqual(f.progressStorage.snapshot(),original);
});
test('uncertain network success is recovered after restart, without repeated write',async()=>{
 const f=fixture({failure:true}),one=f.make();
 const p=await one.prepare();await one.approve(p.ticket,true);
 await assert.rejects(one.sendPending(),/connection dropped/);
 assert.equal(one.pending().id,p.ticket);
 const restarted=f.make();const result=await restarted.sendPending();
 assert.equal(result.status,'confirmed');assert.equal(f.saves.length,1);
 assert.equal(restarted.pending(),null);
});
test('offline before send retains the original id and payload for retry',async()=>{
 const f=fixture(),queue=f.make();const p=await queue.prepare();await queue.approve(p.ticket,true);
 const original=JSON.stringify(queue.pending());
 const oldRead=f.client.read;
 f.client.read=async()=>{throw Error('offline')};
 await assert.rejects(queue.sendPending(),/offline/);
 assert.equal(JSON.stringify(queue.pending()),original);
 f.client.read=oldRead;
 assert.equal((await f.make().sendPending()).status,'confirmed');
 assert.equal(f.saves.length,1);
});
test('new local work invalidates approval without writing an outbox record',async()=>{
 const f=fixture(),q=f.make(),p=await q.prepare();
 f.progressStorage.setItem(K,JSON.stringify({completed:['one','two']}));
 await assert.rejects(q.approve(p.ticket,true),/Local progress changed/);
 assert.equal(q.pending(),null);assert.equal(f.saves.length,0);
});
test('remote advance before approval blocks queueing',async()=>{
 const f=fixture(),q=f.make(),p=await q.prepare();
 f.setCloud({revision:1,sections:{[K]:{completed:['other']}}});
 await assert.rejects(q.approve(p.ticket,true),/Cloud progress changed/);
 assert.equal(q.pending(),null);
});
test('remote conflict keeps pending data, forbids silent overwrite',async()=>{
 const f=fixture(),q=f.make(),p=await q.prepare();await q.approve(p.ticket,true);
 f.setCloud({revision:1,sections:{[K]:{completed:['foreign']}}});
 const status=await q.sendPending();
 assert.equal(status.status,'conflicts');assert.equal(f.saves.length,0);
 assert.ok(q.pending());assert.equal(q.pending().id,p.ticket);
});
test('corrupted queue fails closed and cannot be replaced',async()=>{
 const f=fixture();f.storage.setItem('ai-course-sync-outbox-v1:'+accountId,'{broken');
 const q=f.make();
 assert.throws(q.pending,/corrupted/);
 await assert.rejects(q.prepare(),/corrupted/);
});
test('pending operation survives other account sessions and blocks second approval',async()=>{
 const f=fixture(),q=f.make(),p=await q.prepare();await q.approve(p.ticket,true);
 const other=CourseDurableOutbox.create({storage:f.storage,progressStorage:f.progressStorage,client:f.client,
 accountId:'tg_another',uuid:()=> 'new_op_987654321'});
 assert.equal(other.pending(),null);
 await assert.rejects(q.prepare(),/Unresolved cloud operation/);
 assert.ok(q.pending());
});
test('conflicting answer cannot create queue entry',async()=>{
 const f=fixture({local:{deepNotes:{same:'local'}},
 remote:{revision:3,sections:{[K]:{deepNotes:{same:'cloud'}}}}});
 const q=f.make(),p=await q.prepare();
 assert.equal(p.status,'conflicts');assert.equal(q.pending(),null);
 await assert.rejects(q.approve('one_op_123456789',true));
});
