const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model');require('../progress-merge-rules');require('../progress-outbox');require('../progress-sync-planner');
const key='ai-no-headache-v1';
const make=()=>{const values=new Map;return{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}};
test('preflight combines independent lessons with existing server progress',()=>{
 const server={revision:5,sections:{[key]:{completed:['a'],deepNotes:{old:'server'}}}};
 const local={[key]:{completed:['b'],deepNotes:{new:'local'}}};
 const p=CourseSyncPlanner.prepare(local,server);
 assert.equal(p.status,'ready');assert.deepEqual(p.proposed[key].completed,['a','b']);
 assert.equal(p.proposed[key].deepNotes.old,'server');assert.equal(p.proposed[key].deepNotes.new,'local');
 const out=CourseOutbox.create({storage:make(),accountId:'opaque-A',randomUUID:()=>'operation-234567'});
 CourseSyncPlanner.queueIfSafe(out,p);assert.equal(out.read().pending.baseRevision,5);
});
test('preflight blocks different drafts of same item without overwriting either',()=>{
 const p=CourseSyncPlanner.prepare({[key]:{deepNotes:{x:'local'}}},{revision:3,sections:{[key]:{deepNotes:{x:'remote'}}}});
 assert.equal(p.status,'conflicts');assert.equal(p.proposed,null);assert.equal(p.conflicts.length,1);
 const out=CourseOutbox.create({storage:make(),accountId:'opaque-B',randomUUID:()=>'operation-234567'});
 assert.throws(()=>CourseSyncPlanner.queueIfSafe(out,p),/Manual conflict/);
 assert.equal(out.read().pending,null);
});
test('preflight protects existing server-only sections against partial upload',()=>{
 const a={'ai-course-review-v1':{items:{x:{attempts:2}}}};
 const p=CourseSyncPlanner.prepare({[key]:{completed:['new']}},{revision:1,sections:a});
 assert.equal(p.status,'ready');assert.deepEqual(p.proposed['ai-course-review-v1'],a['ai-course-review-v1']);
});
test('invalid server snapshots and revisions are rejected',()=>{
 assert.throws(()=>CourseSyncPlanner.prepare({}, {revision:-1,sections:{}}));
 assert.throws(()=>CourseSyncPlanner.prepare({}, {revision:0,sections:{wrong:{}}}));
});
