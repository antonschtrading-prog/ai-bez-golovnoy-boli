const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {createHmac,webcrypto}=require('node:crypto');
globalThis.crypto=webcrypto;
require('../progress-sync-model.js');require('../progress-core.js');
require('../progress-merge-rules.js');require('../progress-sync-planner.js');
require('../account-preview.js');require('../progress-storage.js');
require('../account-cloud.js');require('../progress-sync-commit.js');
require('../account-cloud-restore.js');
const K='ai-no-headache-v1',L='ai-course-assessment-v1';
function d1(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['0001_schema.sql','0002_oidc_challenges.sql'])
  sqlite.exec(readFileSync(path.join(__dirname,'../cloudflare/migrations',file),'utf8'));
 const prepare=(sql,args=[])=>({bind(...params){return prepare(sql,params)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}},
  async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:r.changes}}}});
 return {prepare,async batch(stmts){
  sqlite.exec('BEGIN IMMEDIATE');try{
   const out=[];for(const stmt of stmts)out.push(await stmt.run());
   sqlite.exec('COMMIT');return out;
  }catch(error){sqlite.exec('ROLLBACK');throw error}
 },close:()=>sqlite.close()};
}
function memory(init={}){
 const map=new Map(Object.entries(init));
 return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v),
 removeItem:k=>map.delete(k),key:i=>[...map.keys()][i]||null,
 get length(){return map.size}};
}
function signed(botToken,nonce,userId=345){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),query_id:nonce,user:JSON.stringify({id:userId,first_name:'Course'})});
 const check=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(botToken).digest();
 p.set('hash',createHmac('sha256',key).update(check).digest('hex'));
 return p.toString();
}
function locks(){let chain=Promise.resolve();return {request:(_name,_opts,task)=>{
 const current=chain.catch(()=>{}).then(task);chain=current.catch(()=>{});return current;
}}}
test('Cloudflare D1: Mac draft -> authenticated cloud -> iPhone restore -> more work -> Mac restore',async t=>{
 const db=d1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const token='integration-only-secret',origin='https://antonschtrading-prog.github.io';
 const handler=createHandler({db,origins:[origin],botToken:token});
 const fetchImpl=(url,options={})=>handler(new Request(url,{
  ...options,headers:{Origin:origin,...options.headers}
 }));
 const mac=memory({[K]:JSON.stringify({completed:['a1-1'],deepNotes:{lesson:'Черновик урока на Mac'}})});
 const iphone=memory();
 const makeClient=initData=>CourseCloudAccount.create({baseURL:'https://api.example/',fetchImpl,initData});
 const macClient=makeClient(signed(token,'mac-2026')),phoneClient=makeClient(signed(token,'iphone-2026'));
 const first=await macClient.login(),second=await phoneClient.login();
 assert.equal(first.accountId,second.accountId);
 assert.match(first.accountId,/^tg_[a-f0-9]{32}$/);
 const macSave=CourseSyncCommit.create({storage:mac,client:macClient,uuid:()=> 'mac_write_00000001'});
 const prepare=await macSave.inspect();assert.equal(prepare.status,'ready');
 const saved=await macSave.commit(prepare.id,true);assert.equal(saved.revision,1);
 assert.equal(await phoneClient.read().then(x=>x.revision),1);
 const restorePhone=CourseCloudRestore.create({
  storage:iphone,client:phoneClient,locks:locks(),accountId:second.accountId,
  uuid:(()=>{let n=0;return()=> 'phone_backup_'+(++n)})(),hasPending:()=>false
 });
 const received=await restorePhone.inspect();assert.equal(received.status,'ready');
 const restored=await restorePhone.apply(received.ticket,true);
 assert.equal(restored.status,'restored');
 assert.equal(JSON.parse(iphone.getItem(K)).deepNotes.lesson,'Черновик урока на Mac');
 assert.ok(iphone.getItem(restored.backupKey),'Original iPhone backup preserved');
 iphone.setItem(L,JSON.stringify({results:{A1:{work:'Неоконченное задание на iPhone'}}}));
 const phoneSave=CourseSyncCommit.create({storage:iphone,client:phoneClient,uuid:()=> 'phone_write_0000001'});
 const p=await phoneSave.inspect();assert.equal(p.status,'ready');
 assert.equal((await phoneSave.commit(p.id,true)).revision,2);
 const restoreMac=CourseCloudRestore.create({
  storage:mac,client:macClient,locks:locks(),accountId:first.accountId,
  uuid:(()=>{let n=0;return()=> 'mac_backup_'+(++n)})(),hasPending:()=>false
 });
 const merge=await restoreMac.inspect();assert.equal(merge.status,'ready');
 assert.equal((await restoreMac.apply(merge.ticket,true)).status,'restored');
 assert.equal(JSON.parse(mac.getItem(K)).deepNotes.lesson,'Черновик урока на Mac');
 assert.equal(JSON.parse(mac.getItem(L)).results.A1.work,'Неоконченное задание на iPhone');
 assert.equal((await macClient.read()).revision,2);
 const stranger=makeClient(signed(token,'stranger-2026',999));
 assert.notEqual((await stranger.login()).accountId,first.accountId);
 assert.deepEqual((await stranger.read()).sections,{});
});
test('Cloudflare D1: conflicting unfinished answers stop restore and leave local draft intact',async t=>{
 const db=d1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const token='integration-only-secret',origin='https://antonschtrading-prog.github.io';
 const handler=createHandler({db,origins:[origin],botToken:token});
 const fetchImpl=(url,options={})=>handler(new Request(url,{...options,headers:{Origin:origin,...options.headers}}));
 const a=CourseCloudAccount.create({baseURL:'https://api.example/',fetchImpl,initData:signed(token,'device-A')});
 const b=CourseCloudAccount.create({baseURL:'https://api.example/',fetchImpl,initData:signed(token,'device-B')});
 await a.login();const loginB=await b.login();
 const first=memory({[K]:JSON.stringify({deepNotes:{work:'Версия A'}})});
 const second=memory({[K]:JSON.stringify({deepNotes:{work:'Версия B'}})});
 const writer=CourseSyncCommit.create({storage:first,client:a,uuid:()=> 'conflict_write_001'});
 const preview=await writer.inspect();await writer.commit(preview.id,true);
 const reader=CourseCloudRestore.create({storage:second,client:b,locks:locks(),
  accountId:loginB.accountId,uuid:()=> 'conflict_backup_001',hasPending:()=>false});
 const p=await reader.inspect();assert.equal(p.status,'conflicts');
 assert.equal(JSON.parse(second.getItem(K)).deepNotes.work,'Версия B');
 await assert.rejects(reader.apply('any_id_123456',true),/explicit consent/);
 assert.equal(JSON.parse(second.getItem(K)).deepNotes.work,'Версия B');
});
