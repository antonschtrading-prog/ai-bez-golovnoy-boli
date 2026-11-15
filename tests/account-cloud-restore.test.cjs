const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto').webcrypto;
globalThis.crypto=crypto;
require('../progress-sync-model.js');require('../progress-core.js');
require('../progress-merge-rules.js');require('../progress-sync-planner.js');
require('../account-preview.js');require('../progress-storage.js');require('../account-cloud-restore.js');
const K='ai-no-headache-v1',L='ai-course-study-lab-v1';
function storage(initial={}){
 const map=new Map(Object.entries(initial));
 return {getItem:k=>map.has(k)?map.get(k):null,
 setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),
 key:i=>[...map.keys()][i]||null,get length(){return map.size},
 dump:()=>[...map.entries()]};
}
function locks(){
 let last=Promise.resolve();
 return {request:(_name,opts,fn)=>{const next=last.catch(()=>{}).then(fn);last=next.catch(()=>{});return next}};
}
function fixture(local={},cloud={revision:3,sections:{[K]:{completed:['cloud']}}}){
 const disk=storage(Object.fromEntries(Object.entries(local).map(([k,v])=>[k,JSON.stringify(v)])));
 let remote=structuredClone(cloud),pending=false,ids=0,reads=0;
 const client={read:async()=>{reads++;return structuredClone(remote)}};
 const make=()=>CourseCloudRestore.create({storage:disk,client,locks:locks(),accountId:'tg_account123456789',
 uuid:()=> 'secure_restore_'+(++ids),hasPending:()=>pending});
 return {disk,client,make,setCloud:v=>remote=structuredClone(v),setPending:v=>pending=v,reads:()=>reads};
}
test('explicit restore preserves backup, history and original progress after applying cloud-only draft',async()=>{
 const f=fixture({[K]:{completed:['local']}},{revision:5,sections:{[K]:{completed:['cloud']},[L]:{notes:{p:'unfinished lesson'}}}});
 const original=f.disk.getItem(K),q=f.make(),plan=await q.inspect();
 assert.equal(plan.status,'ready');assert.equal(f.disk.getItem(K),original);
 await assert.rejects(q.apply(plan.ticket,false),/explicit consent/);
 const result=await q.apply(plan.ticket,true);
 assert.equal(result.status,'restored');
 assert.deepEqual(JSON.parse(f.disk.getItem(K)).completed,['cloud','local']);
 assert.deepEqual(JSON.parse(f.disk.getItem(L)).notes,{p:'unfinished lesson'});
 const backup=JSON.parse(f.disk.getItem(result.backupKey));
 assert.equal(backup.values[K],original);assert.equal(backup.values[L],null);
 assert.ok(CourseStorage.list(f.disk).length>=1);
});
test('conflicting unfinished answers never create restoration proposal',async()=>{
 const f=fixture({[K]:{deepNotes:{a:'mine'}}},{revision:2,sections:{[K]:{deepNotes:{a:'different'}}}});
 const q=f.make(),p=await q.inspect();assert.equal(p.status,'conflicts');
 await assert.rejects(q.apply('any',true));assert.equal(f.disk.getItem(K),JSON.stringify({deepNotes:{a:'mine'}}));
});
test('stale local draft blocks restore and creates no backup',async()=>{
 const f=fixture({[K]:{completed:['local']}}),q=f.make(),p=await q.inspect();
 f.disk.setItem(K,JSON.stringify({completed:['new']}));
 await assert.rejects(q.apply(p.ticket,true),/Local progress changed/);
 assert.equal(f.disk.dump().filter(([k])=>k.startsWith('ai-course-cloud-restore-backup')).length,0);
});
test('changed remote revision blocks restore',async()=>{
 const f=fixture(),q=f.make(),p=await q.inspect();
 f.setCloud({revision:4,sections:{[K]:{completed:['other']}}});
 await assert.rejects(q.apply(p.ticket,true),/Cloud progress changed/);
});
test('outbox conflict blocks restoring even after inspection',async()=>{
 const f=fixture(),q=f.make(),p=await q.inspect();f.setPending(true);
 await assert.rejects(q.apply(p.ticket,true),/Pending upload/);
});
test('backup quota failure cannot overwrite any section',async()=>{
 const f=fixture({[K]:{completed:['local']}}),q=f.make(),p=await q.inspect();
 const original=f.disk.getItem(K),setter=f.disk.setItem;
 f.disk.setItem=(key,value)=>{if(key.startsWith('ai-course-cloud-restore-backup'))throw Error('quota');setter(key,value)};
 await assert.rejects(q.apply(p.ticket,true),/quota/);assert.equal(f.disk.getItem(K),original);
});
test('failure during second section rolls first back; backup retained',async()=>{
 const f=fixture({[K]:{completed:['a']}},{revision:2,sections:{[K]:{completed:['b']},[L]:{notes:{draft:'keep'}}}});
 const q=f.make(),p=await q.inspect(),orig=f.disk.getItem(K);
 const setter=f.disk.setItem;let fail=true;
 f.disk.setItem=(key,value)=>{if(key===L&&fail){fail=false;throw Error('quota')}setter(key,value)};
 await assert.rejects(q.apply(p.ticket,true),/rolled back/);
 assert.equal(f.disk.getItem(K),orig);assert.equal(f.disk.getItem(L),null);
 assert.equal(f.disk.dump().filter(([k])=>k.startsWith('ai-course-cloud-restore-backup')).length,1);
});
test('missing cross-tab lock rejects before any restore',()=>{
 assert.throws(()=>CourseCloudRestore.create({storage:storage(),client:{read:async()=>({})},locks:null,
 accountId:'tg_account123456789',uuid:()=> 'valid_id_123',hasPending:()=>false}),/Web Locks/);
});
