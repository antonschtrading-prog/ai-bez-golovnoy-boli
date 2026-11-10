const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model.js');require('../progress-core.js');
require('../progress-merge-rules.js');require('../progress-sync-planner.js');
require('../account-preview.js');require('../progress-sync-commit.js');
const K='ai-no-headache-v1';
const storage=(v)=>{const m=new Map([[K,JSON.stringify(v)]]);return{
 getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),snapshot:()=>[...m.entries()]};};
function environment(local,remote={revision:1,sections:{}},overrides={}){
 const state={remote:structuredClone(remote),writes:[]};
 const client={
  async read(){return structuredClone(state.remote)},
  async save(sections,revision,id){
   state.writes.push({sections,revision,id});
   if(revision!==state.remote.revision)return {conflict:true};
   state.remote={revision:revision+1,sections:structuredClone(sections)};
   return {revision:state.remote.revision};
  },...overrides
 };
 const session=CourseSyncCommit.create({storage:local,client,uuid:()=>'secure_uuid_12345678'});
 return {state,session};
}
test('requires explicit confirmation and preserves local progress',async()=>{
 const local=storage({completed:['local']});const old=local.snapshot();
 const {state,session}=environment(local);
 const p=await session.inspect();assert.equal(p.status,'ready');
 await assert.rejects(session.commit(p.id,false),/Explicit confirmation/);
 assert.equal(state.writes.length,0);
 const result=await session.commit(p.id,true);
 assert.equal(result.status,'saved');assert.equal(state.writes.length,1);
 assert.deepEqual(state.writes[0].sections[K].completed,['local']);
 assert.equal(state.writes[0].revision,1);
 assert.equal(state.writes[0].id,p.id);
 assert.deepEqual(local.snapshot(),old);
 await assert.rejects(session.commit(p.id,true),/Explicit confirmation/);
});
test('conflicting answer never creates a proposal or write',async()=>{
 const local=storage({deepNotes:{a:'one'}});
 const {state,session}=environment(local,{revision:3,sections:{[K]:{deepNotes:{a:'two'}}}});
 const p=await session.inspect();assert.equal(p.status,'conflicts');
 await assert.rejects(session.commit('secure_uuid_12345678',true));
 assert.equal(state.writes.length,0);
});
test('changed local progress invalidates approval',async()=>{
 const local=storage({completed:['a']});
 const {state,session}=environment(local);
 const p=await session.inspect();
 local.setItem(K,JSON.stringify({completed:['a','b']}));
 await assert.rejects(session.commit(p.id,true),/Local progress changed/);
 assert.equal(state.writes.length,0);
});
test('changed server snapshot invalidates approval',async()=>{
 const local=storage({completed:['a']});
 const {state,session}=environment(local);
 const p=await session.inspect();
 state.remote={revision:2,sections:{[K]:{completed:['other']}}};
 await assert.rejects(session.commit(p.id,true),/Cloud progress changed/);
 assert.equal(state.writes.length,0);
});
test('server race returns conflict, no local overwrite',async()=>{
 const local=storage({completed:['a']});const old=local.snapshot();
 const {state,session}=environment(local,undefined,{save:async()=>({conflict:true})});
 const p=await session.inspect();const result=await session.commit(p.id,true);
 assert.equal(result.status,'conflicts');assert.equal(state.writes.length,0);
 assert.deepEqual(local.snapshot(),old);
});
test('cancel prevents commit',async()=>{
 const {session,state}=environment(storage({completed:['a']}));
 const p=await session.inspect();session.cancel();
 await assert.rejects(session.commit(p.id,true));assert.equal(state.writes.length,0);
});
test('invalid operation ID stops before a write',async()=>{
 const st=storage({completed:['a']});let writes=0;
 const session=CourseSyncCommit.create({storage:st,client:{read:async()=>({revision:0,sections:{}}),save:async()=>{writes++}},uuid:()=>''});
 await assert.rejects(session.inspect(),/Invalid secure operation ID/);
 assert.equal(writes,0);
});
