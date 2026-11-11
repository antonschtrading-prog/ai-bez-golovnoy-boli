const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model.js');require('../progress-outbox.js');
const K='ai-no-headache-v1';
const sections={[K]:{completed:['one']}};
function storage(){
 const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,
 setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
}
function fixture(){
 const disk=storage(),accountId='tg_account_01';let remote={revision:0,sections:{}};
 let writes=0,drop=false,readFail=false;
 const queue=()=>CourseOutbox.create({storage:disk,accountId,randomUUID:()=> 'operation_fixed_123'});
 const client={
  read:async()=>{if(readFail)throw Error('offline read');return structuredClone(remote)},
  save:async(payload,base,id)=>{writes++;
   if(remote.revision!==base)return {conflict:true};
   remote={revision:base+1,sections:structuredClone(payload)};
   if(drop)throw Error('response lost');
   return {revision:remote.revision,sections:structuredClone(payload)};
  }};
 return {disk,queue,client,remote:v=>{if(v)remote=structuredClone(v);return structuredClone(remote)},
  writes:()=>writes,drop:v=>{drop=v},readFail:v=>{readFail=v}};
}
test('verified delivery reads server and clears outbox only after readback',async()=>{
 const f=fixture(),q=f.queue();
 q.enqueue(sections,0);
 assert.equal(f.writes(),0);
 const result=await q.flushVerified(f.client);
 assert.equal(result.status,'synced');assert.equal(f.writes(),1);
 assert.equal(q.read().pending,null);
});
test('lost acknowledgment survives restart; recovery does not resend',async()=>{
 const f=fixture(),q=f.queue();q.enqueue(sections,0);f.drop(true);
 assert.equal((await q.flushVerified(f.client)).status,'retry');
 assert.equal(f.writes(),1);assert.ok(q.read().pending);
 const fresh=f.queue();f.drop(false);
 const outcome=await fresh.flushVerified(f.client);
 assert.equal(outcome.status,'synced');assert.equal(outcome.recovered,true);
 assert.equal(f.writes(),1);assert.equal(fresh.read().pending,null);
});
test('read failure retains operation without network write',async()=>{
 const f=fixture(),q=f.queue();q.enqueue(sections,0);f.readFail(true);
 assert.equal((await q.flushVerified(f.client)).reason,'read_failed');
 assert.equal(f.writes(),0);assert.ok(q.read().pending);
});
test('different server content blocks upload and preserves pending data',async()=>{
 const f=fixture(),q=f.queue();q.enqueue(sections,0);
 f.remote({revision:1,sections:{[K]:{completed:['other']}}});
 const result=await q.flushVerified(f.client);
 assert.equal(result.status,'conflict');assert.equal(f.writes(),0);
 assert.equal(q.read().conflict.reason,'server_revision_conflict');
 assert.deepEqual(q.read().pending.sections,sections);
});
test('uncertain response alone cannot acknowledge operation',async()=>{
 const f=fixture(),q=f.queue();q.enqueue(sections,0);
 const client={read:async()=>({revision:0,sections:{}}),
 save:async()=>({revision:1,sections})};
 assert.equal((await q.flushVerified(client)).reason,'unverified_server_state');
 assert.ok(q.read().pending);
});
test('outbox remains account-scoped and no automatic flush occurs',async()=>{
 const f=fixture();f.queue().enqueue(sections,0);
 const other=CourseOutbox.create({storage:f.disk,accountId:'tg_other',randomUUID:()=> 'other_fixed_123'});
 assert.equal(other.read().pending,null);assert.equal(f.writes(),0);
});
