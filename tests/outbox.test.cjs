const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../progress-sync-model');
require('../progress-outbox');
class Memory{
 constructor(){this.data=new Map;this.fail=false}
 getItem(k){return this.data.has(k)?this.data.get(k):null}
 setItem(k,v){if(this.fail)throw Error('quota');this.data.set(k,v)}
}
const make=(storage,accountId='account-A')=>CourseOutbox.create({storage,accountId,randomUUID:()=>'operation-123456'});
const draft={'ai-no-headache-v1':{completed:[],deepNotes:{a:'offline text'}}};
test('outbox is passive until flush; no network or token storage',()=>{
 const s=new Memory(),a=make(s);assert.equal(a.read().pending,null);
 a.enqueue(draft,3);assert.equal(a.read().pending.baseRevision,3);
 assert.equal(a.read().pending.sections['ai-no-headache-v1'].deepNotes.a,'offline text');
 assert(!s.getItem(a.key).includes('Bearer'));
});
test('offline network failure preserves same operation for replay',async()=>{
 const s=new Memory(),a=make(s);a.enqueue(draft,3);
 const before=a.read().pending;
 assert.equal((await a.flush({save:async()=>{throw Error('offline')}})).status,'retry');
 assert.deepEqual(a.read().pending,before);
 const response=await a.flush({save:async(sections,revision,id)=>{
  assert.equal(revision,3);assert.equal(id,before.id);
  return{revision:4,sections};
 }});
 assert.equal(response.status,'synced');assert.equal(a.read().pending,null);
});
test('server conflict preserves draft and blocks retries',async()=>{
 const a=make(new Memory());a.enqueue(draft,1);let calls=0;
 assert.equal((await a.flush({save:async()=>{calls++;return{conflict:true,current:{revision:2}}}})).status,'conflict');
 assert.equal((await a.flush({save:async()=>{calls++}})).status,'conflict');
 assert.equal(calls,1);assert.equal(a.read().pending.sections['ai-no-headache-v1'].deepNotes.a,'offline text');
});
test('unexpected acknowledgment cannot delete offline draft',async()=>{
 const a=make(new Memory());a.enqueue(draft,1);
 assert.equal((await a.flush({save:async()=>({revision:99,sections:draft})})).status,'retry');
 assert(a.read().pending);
});
test('account isolation and corrupted outbox fail closed',()=>{
 const s=new Memory(),one=make(s,'account-A'),two=make(s,'account-B');
 one.enqueue(draft,0);assert.equal(two.read().pending,null);
 s.setItem(one.key,'{bad');
 assert.throws(()=>one.enqueue(draft,0));
 assert.equal(two.read().pending,null);
});
test('reject malformed sections, duplicate pending, invalid revision and quota errors',()=>{
 const s=new Memory(),a=make(s);
 assert.throws(()=>a.enqueue({'ai-no-headache-v1':{deepNotes:[]}},0));
 assert.throws(()=>a.enqueue(draft,-1));
 s.fail=true;assert.throws(()=>a.enqueue(draft,0));
 s.fail=false;a.enqueue(draft,0);assert.throws(()=>a.enqueue(draft,0));
});
test('explicit discard is required to remove pending conflicting changes',async()=>{
 const s=new Memory(),a=make(s);a.enqueue(draft,0);
 assert(a.read().pending);
 a.discard();assert.equal(a.read().pending,null);
});
