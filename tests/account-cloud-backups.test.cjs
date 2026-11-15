const {test}=require('node:test'),assert=require('node:assert/strict');
require('../progress-sync-model.js');require('../account-cloud-backups.js');
const K='ai-no-headache-v1',PREFIX='ai-course-cloud-restore-backup-v1:';
function storage(records={}){
 const m=new Map(Object.entries(records));
 return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),
 key:i=>[...m.keys()][i]??null,get length(){return m.size}};
}
function record(accountId='tg_account123456789',value={completed:['a']}){
 const values=Object.fromEntries(CourseSyncModel.KEYS.map(key=>[key,null]));
 values[K]=JSON.stringify(value);
 return {format:'ai-course-cloud-restore-backup-v1',accountId,createdAt:'2026-11-16T00:00:00.000Z',
  cloudRevision:4,values};
}
test('lists only verified account backups and exports validated full original snapshot',()=>{
 const disk=storage({[PREFIX+'1']:JSON.stringify(record()),[PREFIX+'2']:JSON.stringify(record('tg_someoneelse123456'))});
 const reader=CourseCloudBackups.create({storage:disk,accountId:'tg_account123456789'});
 assert.equal(reader.list().length,1);
 const exported=JSON.parse(reader.exportBackup(PREFIX+'1'));
 assert.equal(JSON.parse(exported.values[K]).completed[0],'a');
 assert.equal(exported.cloudRevision,4);
 assert.equal(disk.getItem(PREFIX+'1'),JSON.stringify(record()));
});
test('other user backup is not exported even when key is known',()=>{
 const disk=storage({[PREFIX+'2']:JSON.stringify(record('tg_someoneelse123456'))});
 const reader=CourseCloudBackups.create({storage:disk,accountId:'tg_account123456789'});
 assert.equal(reader.list().length,0);
 assert.throws(()=>reader.exportBackup(PREFIX+'2'),/Invalid account backup/);
});
test('tampered and invalid section backups fail closed',()=>{
 const bad=record();bad.values[K]=JSON.stringify({deepNotes:JSON.parse('{"__proto__":"evil"}')});
 const disk=storage({[PREFIX+'broken']:JSON.stringify(bad)});
 const reader=CourseCloudBackups.create({storage:disk,accountId:'tg_account123456789'});
 assert.throws(()=>reader.list(),/Опасное имя/);
 assert.throws(()=>reader.exportBackup(PREFIX+'broken'));
});
test('missing sections or invalid revision are rejected',()=>{
 const bad=record();delete bad.values[K];
 const disk=storage({[PREFIX+'bad']:JSON.stringify(bad)});
 const reader=CourseCloudBackups.create({storage:disk,accountId:'tg_account123456789'});
 assert.throws(()=>reader.exportBackup(PREFIX+'bad'),/Incomplete backup/);
});
test('unauthenticated access is blocked',()=>{
 assert.throws(()=>CourseCloudBackups.create({storage:storage(),accountId:'anonymous'}),/Verified account/);
});
