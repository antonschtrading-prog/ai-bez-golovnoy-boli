const {test}=require('node:test');const assert=require('node:assert/strict');
require('../progress-auto-merge.js');const {merge}=globalThis.CourseAutoMerge;
test('independent device edits preserve both drafts',()=>{
 assert.deepEqual(merge({a:'old',b:'old'},{a:'new',b:'old'},{a:'old',b:'other'}).proposed,{a:'new',b:'other'});
});
test('competing edits stop sync without overwriting',()=>{
 const result=merge({draft:'old'},{draft:'local'},{draft:'remote'});
 assert.equal(result.status,'conflicts');assert.equal(result.proposed,null);assert.deepEqual(result.conflicts,['draft']);
});
test('remote deletion and unchanged local are propagated',()=>{
 assert.deepEqual(merge({a:1},{a:1},{}).proposed,{});
});
test('deletion against an edited draft is a conflict',()=>{
 assert.equal(merge({a:1},{a:2},{}).status,'conflicts');
});
test('arrays are atomic, never merge answers by index',()=>{
 assert.equal(merge({a:[1]},{a:[1,2]},{a:[1,3]}).status,'conflicts');
});
test('first sync cannot silently replace existing answers',()=>{
 assert.equal(merge({}, {draft:'local'},{draft:'cloud'}).status,'conflicts');
});
