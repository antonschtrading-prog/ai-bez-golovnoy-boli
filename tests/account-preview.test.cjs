const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model.js');
require('../progress-core.js');
require('../progress-merge-rules.js');
require('../progress-sync-planner.js');
require('../account-preview.js');
const K='ai-no-headache-v1';
function storage(values={}){
 const m=new Map(Object.entries(values));
 return {getItem:key=>m.has(key)?m.get(key):null,setItem:(key,value)=>m.set(key,value),entries:()=>[...m.entries()]};
}
test('safe account preview preserves independent local and remote work with no writes',()=>{
 const local=storage({[K]:JSON.stringify({completed:['a'],deepNotes:{mine:'local'}})});
 const before=local.entries();
 const plan=CourseAccountPreview.plan(local,{revision:3,sections:{[K]:{completed:['b'],deepNotes:{remote:'cloud'}}}});
 assert.equal(plan.status,'ready');
 assert.equal(plan.revision,3);
 assert.deepEqual(plan.proposed[K].completed,['b','a']);
 assert.deepEqual(plan.proposed[K].deepNotes,{remote:'cloud',mine:'local'});
 assert.deepEqual(local.entries(),before);
 const result=JSON.parse(CourseAccountPreview.exportPlan(plan));
 assert.equal(result.format,'ai-course-sync-preview-v1');
 assert.equal(result.revision,3);
});
test('conflicting answers block combined export and preserve original copies',()=>{
 const local=storage({[K]:JSON.stringify({deepNotes:{same:'my draft'}})});
 const cloud={revision:2,sections:{[K]:{deepNotes:{same:'other device'}}}};
 const before=JSON.stringify(cloud);
 const preview=CourseAccountPreview.plan(local,cloud);
 assert.equal(preview.status,'conflicts');
 assert.equal(preview.conflicts.length,1);
 assert.equal(preview.proposed,null);
 assert.throws(()=>CourseAccountPreview.exportPlan(preview),/Конфликты/);
 assert.equal(JSON.stringify(cloud),before);
 assert.equal(JSON.parse(local.getItem(K)).deepNotes.same,'my draft');
});
test('unknown, malicious and oversized server files fail closed',()=>{
 for(const value of [{revision:0,sections:{unknown:{}}},{revision:-1,sections:{}},
  {revision:0,sections:JSON.parse('{"ai-no-headache-v1":{"deepNotes":{"__proto__":"evil"}}}')}])
  assert.throws(()=>CourseAccountPreview.remote(value));
 assert.throws(()=>CourseAccountPreview.remote({revision:0,sections:{[K]:{deepNotes:{a:'x'.repeat(1024*1024)}}}}),/1 МБ/);
});
test('corrupted local data forbids any account preview',()=>{
 const bad=storage({[K]:'{bad json'});
 assert.throws(()=>CourseAccountPreview.plan(bad,{revision:0,sections:{}}),/Повреждён/);
});
test('server-only lessons remain in merged plan',()=>{
 const local=storage({[K]:JSON.stringify({completed:['a']})});
 const cloud={revision:9,sections:{'ai-course-review-v1':{items:{x:{attempts:3}}}}};
 const plan=CourseAccountPreview.plan(local,cloud);
 assert.equal(plan.status,'ready');
 assert.equal(plan.proposed['ai-course-review-v1'].items.x.attempts,3);
});
