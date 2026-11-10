const {test}=require('node:test'), assert=require('node:assert/strict'), http=require('node:http');
const {Store}=require('../server/store.cjs');
const {handler}=require('../server/api.cjs');
require('../progress-sync-model.js');
require('../progress-merge-rules.js');
require('../progress-outbox.js');
require('../progress-sync-planner.js');
require('../progress-client.js');
require('../progress-sync-coordinator.js');
const tokenA='a'.repeat(40), tokenB='b'.repeat(40), tokenOther='c'.repeat(40);
const K='ai-no-headache-v1';
class Memory{
 constructor(){this.map=new Map}
 getItem(key){return this.map.has(key)?this.map.get(key):null}
 setItem(key,value){this.map.set(key,value)}
}
async function fixture(t){
 const store=new Store();
 const expiry=Date.now()+300000;
 store.provision('shared_account',tokenA,expiry);
 store.provision('shared_account',tokenB,expiry);
 store.provision('separate_account',tokenOther,expiry);
 const server=http.createServer(handler({store,origins:['http://127.0.0.1:8080']}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close()});
 return {baseURL:'http://127.0.0.1:'+server.address().port,store};
}
function device(baseURL,initialToken,store){
 let token=initialToken,forgotten=0;
 const client=CourseProgressClient.create({baseURL,getToken:()=>token,fetchImpl:fetch});
 const coord=CourseSyncCoordinator.create({
  client,storage:store,forgetCredentials:()=>{token=null;forgotten++},
  randomUUID:()=>'sync-'+Math.random().toString(36).slice(2).padEnd(14,'0')
 });
 return {coord,client,get token(){return token},get forgotten(){return forgotten}};
}
test('two devices sync through the real HTTP API without losing independent drafts',async t=>{
 const {baseURL}=await fixture(t);
 const phone=device(baseURL,tokenA,new Memory());
 const mac=device(baseURL,tokenB,new Memory());
 const other=device(baseURL,tokenOther,new Memory());
 const [p,m,o]=await Promise.all([phone.coord.connect(),mac.coord.connect(),other.coord.connect()]);
 assert.equal(p.accountId,'shared_account');
 assert.equal(m.accountId,p.accountId);
 assert.equal(o.accountId,'separate_account');
 assert.equal((await phone.coord.queue({[K]:{deepNotes:{phone:'first'}}},{confirmed:true})).status,'queued');
 assert.equal((await phone.coord.send()).status,'synced');
 assert.equal((await mac.coord.queue({[K]:{deepNotes:{mac:'second'}}},{confirmed:true})).status,'queued');
 assert.equal((await mac.coord.send()).status,'synced');
 const result=await phone.client.read();
 assert.equal(result.revision,2);
 assert.deepEqual(result.sections[K].deepNotes,{phone:'first',mac:'second'});
 assert.deepEqual((await other.client.read()).sections,{});
});
test('an offline device retains pending changes until the user resolves server conflict',async t=>{
 const {baseURL}=await fixture(t);
 const phone=device(baseURL,tokenA,new Memory()),mac=device(baseURL,tokenB,new Memory());
 await phone.coord.connect();await mac.coord.connect();
 await phone.coord.queue({[K]:{deepNotes:{phone:'offline'}}},{confirmed:true});
 await mac.coord.queue({[K]:{deepNotes:{mac:'online'}}},{confirmed:true});
 assert.equal((await mac.coord.send()).status,'synced');
 assert.equal((await phone.coord.send()).status,'conflict');
 assert.equal(phone.coord.pending().pending.sections[K].deepNotes.phone,'offline');
 assert.equal((await phone.coord.send()).status,'conflict');
 assert.equal((await phone.client.read()).sections[K].deepNotes.mac,'online');
});
test('server-verified logout revokes token and leaves pending drafts recoverable',async t=>{
 const {baseURL}=await fixture(t);
 const memory=new Memory(),phone=device(baseURL,tokenA,memory);
 await phone.coord.connect();
 await phone.coord.queue({[K]:{deepNotes:{a:'keep'}}},{confirmed:true});
 const before=phone.coord.pending().pending.id;
 const signedOut=await phone.coord.signOut();
 assert.equal(signedOut.signedOut,true);
 assert.equal(signedOut.serverRevoked,true);
 assert.equal(phone.token,null);
 assert.equal(phone.coord.state().connected,false);
 await assert.rejects(()=>phone.coord.send(),/Connect to account/);
 const again=device(baseURL,tokenB,memory);
 await again.coord.connect();
 assert.equal(again.coord.pending().pending.id,before);
 await assert.rejects(()=>phone.client.read(),/Account required/);
});
test('unverified account identity is never allowed to choose a local outbox',async()=>{
 let stored=0;
 const client={session:async()=>({accountId:'fake',authenticated:false}),read:async()=>({}),save:async()=>({}),logout:async()=>({})};
 const coord=CourseSyncCoordinator.create({client,storage:{getItem:()=>null,setItem:()=>stored++},forgetCredentials:()=>{}});
 await assert.rejects(()=>coord.connect(),/Server identity/);
 assert.equal(stored,0);
});
test('sign out clears credentials even when server is offline, with honest status',async()=>{
 let cleared=false;
 const client={session:async()=>({accountId:'safe',authenticated:true}),read:async()=>({}),save:async()=>({}),logout:async()=>{throw Error('offline')}};
 const coord=CourseSyncCoordinator.create({client,storage:new Memory(),forgetCredentials:()=>{cleared=true}});
 await coord.connect();
 const result=await coord.signOut();
 assert.equal(result.signedOut,true);assert.equal(result.serverRevoked,false);
 assert.equal(result.serverError,'server_revocation_unconfirmed');
 assert.equal(cleared,true);
});

test('account transfer requires explicit user confirmation',async()=>{
 const c={session:async()=>({authenticated:true,accountId:'signed_in_account'}),read:async()=>({revision:0,sections:{}}),save:async()=>({}),logout:async()=>({signedOut:true})};
 const memory=new Memory();
 const coord=CourseSyncCoordinator.create({client:c,storage:memory,forgetCredentials:()=>{},randomUUID:()=>'operation-00001'});
 await coord.connect();
 await assert.rejects(()=>coord.queue({[K]:{completed:['one']}}),/Explicit consent/);
 assert.equal(coord.pending().pending,null);
 const queued=await coord.queue({[K]:{completed:['one']}},{confirmed:true});
 assert.equal(queued.status,'queued');
});
test('account switch or sign-out during remote read cannot queue stale progress',async()=>{
 let resolveRead;
 const c={session:async()=>({authenticated:true,accountId:'account-A'}),read:()=>new Promise(r=>{resolveRead=r}),save:async()=>({}),logout:async()=>({signedOut:true})};
 const memory=new Memory();
 const coord=CourseSyncCoordinator.create({client:c,storage:memory,forgetCredentials:()=>{},randomUUID:()=>'operation-00001'});
 await coord.connect();
 const pending=coord.queue({[K]:{deepNotes:{x:'draft'}}},{confirmed:true});
 // Wait for the asynchronous read to start.
 for(let i=0;i<5&&!resolveRead;i++)await Promise.resolve();
 assert.equal(typeof resolveRead,'function');
 await coord.signOut();
 resolveRead({revision:0,sections:{}});
 await assert.rejects(pending,/Session changed/);
 assert.equal(memory.getItem('ai-course-outbox-v1:account-A'),null);
});

test('offline retry reaches real API exactly once and preserves the operation id',async t=>{
 const {baseURL,store}=await fixture(t);
 let token=tokenA,offline=true,sends=0;
 const client=CourseProgressClient.create({baseURL,getToken:()=>token,fetchImpl:async(url,options)=>{
  if(options.method==='PUT'){sends++;if(offline)throw Error('network temporarily offline')}
  return fetch(url,options);
 }});
 const device=CourseSyncCoordinator.create({client,storage:new Memory(),forgetCredentials:()=>{token=null},randomUUID:()=>'stable-retry-0001'});
 await device.connect();
 await device.queue({[K]:{completed:['unit-1']}},{confirmed:true});
 const id=device.pending().pending.id;
 assert.equal((await device.send()).status,'retry');
 assert.equal(device.pending().pending.id,id);
 assert.equal(store.get('shared_account').revision,0);
 offline=false;
 assert.equal((await device.send()).status,'synced');
 assert.equal(store.get('shared_account').revision,1);
 assert.equal(sends,2);
 assert.equal((await device.send()).status,'idle');
 assert.equal(store.get('shared_account').revision,1);
});
