const {test}=require('node:test');const assert=require('node:assert/strict');
require('../progress-sync-model');require('../progress-storage');require('../progress-migrations');require('../progress-merge-rules');
const key='ai-no-headache-v1';
class Memory{constructor(){this.m=new Map()}get length(){return this.m.size}key(i){return [...this.m.keys()][i]}getItem(k){return this.m.get(k)??null}setItem(k,v){if(this.fail)throw Error('quota');this.m.set(k,v)}removeItem(k){this.m.delete(k)}}
const raw=x=>JSON.stringify({deepNotes:{a:x}});
test('old and new versions survive restoration',()=>{const s=new Memory();s.setItem(key,raw('first'));CourseStorage.write(s,key,raw('second'));const v=CourseStorage.list(s,key)[0];CourseStorage.restore(s,v.id,raw('second'));assert.equal(s.getItem(key),raw('first'));assert(CourseStorage.list(s,key).some(v=>v.raw===raw('second')))});
test('storage failure never overwrites source',()=>{const s=new Memory();s.setItem(key,raw('old'));s.fail=true;assert.throws(()=>CourseStorage.write(s,key,raw('new')));assert.equal(s.getItem(key),raw('old'))});
test('stale tab retains incoming draft and refuses overwrite',()=>{const s=new Memory();s.setItem(key,raw('old'));CourseStorage.initialize(s);s.setItem(key,raw('other'));assert.throws(()=>CourseStorage.write(s,key,raw('mine')),/Другая вкладка/);assert.equal(s.getItem(key),raw('other'));assert(CourseStorage.list(s,key).some(v=>v.raw===raw('mine')))});
test('restore guards preview revision',()=>{const s=new Memory();CourseStorage.write(s,key,raw('one'));const v=CourseStorage.list(s,key)[0];CourseStorage.write(s,key,raw('two'));assert.throws(()=>CourseStorage.restore(s,v.id,raw('one')));assert.equal(s.getItem(key),raw('two'))});
test('retention is bounded',()=>{const s=new Memory();for(let i=0;i<30;i++)CourseStorage.write(s,key,raw(String(i)));assert.equal(CourseStorage.list(s,key).length,20)});
test('corrupt history blocks replacement',()=>{const s=new Memory();s.setItem(key,raw('old'));s.setItem(CourseStorage.PREFIX+'bad','{');assert.throws(()=>CourseStorage.write(s,key,raw('new')));assert.equal(s.getItem(key),raw('old'))});
test('migration is separate, repeatable and preserves original',()=>{const s=new Memory();s.setItem(key,raw('old'));const source={format:'ai-course-full-local-backup-v1',items:{[key]:JSON.parse(raw('old')),'ai-course-journal-v1':{events:[]}}};const first=CourseMigrations.stage(s,source,'test');assert.deepEqual(CourseMigrations.stage(s,source,'test'),first);assert.equal(s.getItem(key),raw('old'));assert.deepEqual(JSON.parse(s.getItem(CourseMigrations.KEY)).source,source)});
test('unknown schema and unsafe nested values rejected',()=>{assert.throws(()=>CourseMigrations.prepare({format:'v99'},'test'));assert.throws(()=>CourseMigrations.prepare({format:'ai-course-progress-snapshot-v1',sections:JSON.parse('{"ai-no-headache-v1":{"answers":{"__proto__":{}}}}')},'test'));assert.throws(()=>CourseSyncModel.makeEnvelope({[key]:{deepAnswers:[]}}, {deviceId:'test'}))});
test('migration storage failure leaves all original data',()=>{const s=new Memory();s.setItem(key,raw('old'));s.fail=true;assert.throws(()=>CourseMigrations.stage(s,{format:'ai-course-progress-snapshot-v1',sections:{[key]:{}}},'test'));assert.equal(s.getItem(key),raw('old'))});
test('merge allows independent records but keeps conflicting answers explicit',()=>{const a={[key]:{completed:['a'],answers:{a:1}}},b={[key]:{completed:['b'],answers:{a:2,b:3}}};const result=CourseMergeRules.audit(a,b);assert.equal(result.safe,false);assert.deepEqual(result.proposed[key].completed,['a','b']);assert.equal(result.proposed[key].answers.a,1);assert.equal(result.proposed[key].answers.b,3)});
test('current v5 main-course export migrates without field loss',()=>{const source={type:'ai-course-progress',schemaVersion:5,state:{completed:[],deepDone:[],deepAnswers:{},report:{task:'draft'},customFutureField:42}};const copy=JSON.stringify(source);assert.deepEqual(CourseMigrations.prepare(source,'test').sections[key],source.state);assert.equal(JSON.stringify(source),copy);assert.throws(()=>CourseMigrations.prepare({...source,schemaVersion:99},'test'))});
test('single-sided merge cannot smuggle unsafe nested keys',()=>{assert.throws(()=>CourseMergeRules.audit({},JSON.parse('{"ai-no-headache-v1":{"answers":{"constructor":{}}}}')))});
test('primary-write failure still leaves both versions recoverable',()=>{const s=new Memory();s.setItem(key,raw('old'));const original=s.setItem.bind(s);s.setItem=(k,v)=>{if(k===key)throw Error('write interrupted');original(k,v)};assert.throws(()=>CourseStorage.write(s,key,raw('new')));assert.equal(s.getItem(key),raw('old'));assert.equal(CourseStorage.list(s,key).length,2)});
test('malformed legacy full backup cannot migrate as empty progress',()=>{for(const items of [undefined,null,[],42,'bad'])assert.throws(()=>CourseMigrations.prepare({format:'ai-course-full-local-backup-v1',items},'test'))});

test('failed multi-section import rolls back baseline and permits later editing',()=>{
 const s=new Memory(),key2='ai-course-assessment-v1';
 s.setItem(key,raw('old'));CourseStorage.initialize(s);
 const first=s.getItem(key),imported=raw('imported');
 CourseStorage.write(s,key,imported);
 const originalSet=s.setItem.bind(s);
 s.setItem=(k,v)=>{if(k===key2)throw Error('simulated quota');originalSet(k,v)};
 assert.throws(()=>CourseStorage.write(s,key2,JSON.stringify({results:{}})),/simulated quota/);
 const result=CourseStorage.rollbackBatch(s,[{key,before:first,after:imported}]);
 assert.equal(result.complete,true);
 assert.equal(s.getItem(key),first);
 CourseStorage.write(s,key,raw('after failure'));
 assert.equal(s.getItem(key),raw('after failure'));
});
test('partial rollback does not hide failure or overwrite another tab',()=>{
 const s=new Memory(),key2='ai-course-assessment-v1',value=raw('mine');
 s.setItem(key,raw('original'));CourseStorage.initialize(s);
 CourseStorage.write(s,key,value);
 s.setItem(key,raw('changed by second tab'));
 const rollback=CourseStorage.rollbackBatch(s,[{key,before:raw('original'),after:value}]);
 assert.equal(rollback.complete,false);
 assert.deepEqual(rollback.failures,[key]);
 assert.equal(s.getItem(key),raw('changed by second tab'));
 assert.throws(()=>CourseStorage.write(s,key,raw('next')),/Другая вкладка/);
});
test('rollback reports a storage failure rather than claiming full recovery',()=>{
 const s=new Memory(),before=raw('before'),after=raw('after');
 s.setItem(key,before);CourseStorage.initialize(s);CourseStorage.write(s,key,after);
 const baseSet=s.setItem.bind(s);
 s.setItem=(k,v)=>{if(k===key&&v===before)throw Error('rollback disk failure');baseSet(k,v)};
 const result=CourseStorage.rollbackBatch(s,[{key,before,after}]);
 assert.equal(result.complete,false);assert.deepEqual(result.failures,[key]);
 assert.equal(s.getItem(key),after);
});
