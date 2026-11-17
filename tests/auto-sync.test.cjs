const {test}=require('node:test');const assert=require('node:assert/strict');require('../progress-auto-merge.js');require('../progress-auto-sync.js');
function fixture(){let local={draft:'first'},base={},remote={revision:0,sections:{}};let fail=false,saves=0;
 const client={read:async()=>structuredClone(remote),save:async(s,r)=>{if(fail)throw Error('offline');if(r!==remote.revision)return {conflict:true};saves++;remote={revision:r+1,sections:structuredClone(s)};return remote}};
 const engine=CourseAutoSync.create({client,readLocal:()=>structuredClone(local),writeLocal:s=>{local=structuredClone(s)},loadBase:()=>base,saveBase:s=>{base=structuredClone(s)},uuid:()=> 'operation-1234'});
 return {engine,edit:x=>local=x,offline:x=>fail=x,remote:()=>remote,saves:()=>saves,other:x=>remote={revision:remote.revision+1,sections:x}}}
test('draft persists, unchanged polling does not create revisions',async()=>{const f=fixture();await f.engine.tick();await f.engine.tick();assert.equal(f.saves(),1);assert.equal(f.remote().sections.draft,'first')});
test('offline edits survive and are sent on retry',async()=>{const f=fixture();f.offline(true);await assert.rejects(f.engine.tick());f.offline(false);await f.engine.tick();assert.equal(f.remote().sections.draft,'first')});
test('two writers editing same answer cannot overwrite each other',async()=>{const f=fixture();await f.engine.tick();f.edit({draft:'local'});f.other({draft:'remote'});assert.equal((await f.engine.tick()).status,'conflicts');assert.equal(f.remote().sections.draft,'remote')});

test('missing local section never deletes cloud progress automatically',async()=>{const f=fixture();await f.engine.tick();f.edit({});assert.equal((await f.engine.tick()).status,'conflicts');assert.equal(f.remote().sections.draft,'first')});
test('stopped engine does not send data',async()=>{const f=fixture();f.engine.stop();await f.engine.tick();assert.equal(f.saves(),0)});
