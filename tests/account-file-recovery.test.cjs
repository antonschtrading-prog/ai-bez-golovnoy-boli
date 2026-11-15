const {test}=require('node:test'),assert=require('node:assert/strict');
globalThis.crypto=require('node:crypto').webcrypto;
require('../progress-sync-model.js');require('../progress-core.js');
require('../progress-merge-rules.js');require('../progress-sync-planner.js');
require('../account-preview.js');require('../progress-storage.js');
require('../account-file-recovery.js');
const K='ai-no-headache-v1',L='ai-course-study-lab-v1',ACCOUNT='tg_account123456789';
function storage(initial={}){
 const m=new Map(Object.entries(initial));
 return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),
 removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]||null,
 get length(){return m.size},entries:()=>[...m.entries()]};
}
function locks(){let queue=Promise.resolve();return{request:(_name,_opts,fn)=>{
 const p=queue.catch(()=>{}).then(fn);queue=p.catch(()=>{});return p;
}}}
function backup(values={},accountId=ACCOUNT){
 return JSON.stringify({format:'ai-course-cloud-restore-backup-v1',accountId,
 createdAt:'2026-11-15T12:00:00.000Z',cloudRevision:4,
 values:Object.fromEntries(CourseSyncModel.KEYS.map(k=>[k,values[k]===undefined?null:JSON.stringify(values[k])]))});
}
function environment(local={}){
 const disk=storage(Object.fromEntries(Object.entries(local).map(([k,v])=>[k,JSON.stringify(v)])));
 let pending=false,serial=0;
 const make=()=>CourseFileRecovery.create({storage:disk,accountId:ACCOUNT,locks:locks(),
 uuid:()=> 'restore_operation_'+(++serial),hasPending:()=>pending});
 return {disk,make,setPending:v=>pending=v};
}
test('restores unfinished course draft from file after explicit consent, saving previous state',async()=>{
 const f=environment({[K]:{completed:['local']}});
 const raw=backup({[K]:{completed:['local','cloud']},[L]:{notes:{one:'unfinished'}}});
 const q=f.make(),preview=await q.inspect(raw);
 assert.equal(preview.status,'ready');
 assert.equal(f.disk.getItem(L),null);
 await assert.rejects(q.apply(preview.ticket,false),/Explicit approval/);
 const applied=await q.apply(preview.ticket,true);
 assert.equal(applied.status,'restored');assert.equal(applied.written,2);
 assert.equal(JSON.parse(f.disk.getItem(L)).notes.one,'unfinished');
 assert.equal(JSON.parse(f.disk.getItem(applied.backupKey)).values[K],JSON.stringify({completed:['local']}));
 assert.equal(JSON.parse(f.disk.getItem(applied.backupKey)).values[L],null);
 assert.ok(CourseStorage.list(f.disk).length>0);
});
test('divergent unfinished answer blocks overwrite',async()=>{
 const f=environment({[K]:{deepNotes:{same:'new answer'}}});
 const q=f.make(),p=await q.inspect(backup({[K]:{deepNotes:{same:'old answer'}}}));
 assert.equal(p.status,'conflicts');
 await assert.rejects(q.apply('restore_operation_1',true));
 assert.equal(JSON.parse(f.disk.getItem(K)).deepNotes.same,'new answer');
 assert.equal(f.disk.entries().some(([k])=>k.startsWith('ai-course-cloud-restore-backup-v1:')),false);
});
test('different account backup is denied without touching any data',async()=>{
 const f=environment({[K]:{completed:['a']}});
 await assert.rejects(f.make().inspect(backup({[L]:{notes:{x:'test'}}},'tg_other123456789')),/Invalid backup format or account/);
 assert.equal(f.disk.entries().length,1);
});
test('unsafe JSON field rejected at preview',()=>{
 const values=JSON.parse('{"ai-no-headache-v1":{"deepNotes":{"__proto__":"unsafe"}}}');
 assert.throws(()=>CourseFileRecovery.validateBackup(backup(values),ACCOUNT),/Опасное имя/);
});
test('pending cloud upload prevents even file preview',async()=>{
 const f=environment();f.setPending(true);
 await assert.rejects(f.make().inspect(backup({[K]:{completed:['a']}})),/pending cloud upload/);
});
test('concurrent local editing after preview prevents apply',async()=>{
 const f=environment({[K]:{completed:['a']}}),q=f.make();
 const p=await q.inspect(backup({[K]:{completed:['a','b']}}));
 f.disk.setItem(K,JSON.stringify({completed:['a','different']}));
 await assert.rejects(q.apply(p.ticket,true),/Local data changed/);
 assert.deepEqual(JSON.parse(f.disk.getItem(K)).completed,['a','different']);
});
test('failure to create verified backup prevents writes',async()=>{
 const f=environment({[K]:{completed:['a']}}),q=f.make();
 const p=await q.inspect(backup({[K]:{completed:['a','b']}}));
 const original=f.disk.getItem(K),setter=f.disk.setItem;
 f.disk.setItem=(k,v)=>{if(k.startsWith('ai-course-cloud-restore-backup-v1:'))throw Error('quota');setter(k,v)};
 await assert.rejects(q.apply(p.ticket,true),/quota/);
 assert.equal(f.disk.getItem(K),original);
});
test('failure in second section triggers rollback and retains current-data backup',async()=>{
 const f=environment({[K]:{completed:['a']}}),q=f.make();
 const raw=backup({[K]:{completed:['a','b']},[L]:{notes:{one:'draft'}}});
 const p=await q.inspect(raw),old=f.disk.getItem(K);
 const setter=f.disk.setItem;let failure=true;
 f.disk.setItem=(k,v)=>{if(k===L&&failure){failure=false;throw Error('quota')}setter(k,v)};
 await assert.rejects(q.apply(p.ticket,true),/Import rolled back/);
 assert.equal(f.disk.getItem(K),old);assert.equal(f.disk.getItem(L),null);
 assert.equal(f.disk.entries().filter(([k])=>k.startsWith('ai-course-cloud-restore-backup-v1:')).length,1);
});
