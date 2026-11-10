const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{readFileSync}=require('node:fs');
const path=require('node:path');
require('../progress-sync-model.js');
const schema=readFileSync(path.join(__dirname,'../cloudflare/migrations/0001_schema.sql'),'utf8');
function mockD1(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
 const prepare=(sql,args=[])=>({
  bind(...params){return prepare(sql,params)},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return{results:sqlite.prepare(sql).all(...args)}},
  async run(){const r=sqlite.prepare(sql).run(...args);return{meta:{changes:r.changes}}}
 });
 return{
  prepare,
  async batch(stmts){
   sqlite.exec('BEGIN IMMEDIATE');
   try{
    const results=[];
    for(const stmt of stmts)results.push(await stmt.run());
    sqlite.exec('COMMIT');return results;
   }catch(e){sqlite.exec('ROLLBACK');throw e}
  },
  close:()=>sqlite.close()
 };
}
const section='ai-no-headache-v1';
async function setup(){
 const db=mockD1();
 const {createD1Store}=await import('../cloudflare/d1-store.mjs');
 const {createHandler}=await import('../cloudflare/api.mjs');
 const store=createD1Store(db), origins=['https://antonschtrading-prog.github.io'];
 const handler=createHandler({db,origins});
 const token1=(await store.issueSession('person_A',60000)).token;
 const token2=(await store.issueSession('person_A',60000)).token;
 const tokenOther=(await store.issueSession('person_B',60000)).token;
 const req=async(token,path='/v1/progress',init={})=>{
  const response=await handler(new Request('https://api.example'+path,{
   ...init,headers:{Authorization:'Bearer '+token,...init.headers}
  }));
  return{status:response.status,body:await response.json(),headers:response.headers};
 };
 return{db,store,req,token1,token2,tokenOther};
}
const put=(rev,id,sections)=>({method:'PUT',headers:{
 'Content-Type':'application/json','If-Match':'"'+rev+'"','Idempotency-Key':id
},body:JSON.stringify({sections})});
test('D1 real SQLite: two devices share account, separate account isolated',async t=>{
 const f=await setup();t.after(f.db.close);
 const p=put(0,'operation-001',{[section]:{deepNotes:{a:'first'}}});
 const first=await f.req(f.token1,undefined,p);
 assert.equal(first.status,200);assert.equal(first.body.revision,1);
 assert.equal((await f.req(f.token2)).body.sections[section].deepNotes.a,'first');
 assert.deepEqual((await f.req(f.tokenOther)).body.sections,{});
 const second=await f.req(f.token2,undefined,put(1,'operation-002',{[section]:{deepNotes:{a:'first',b:'second'}}}));
 assert.equal(second.status,200);assert.equal(second.body.revision,2);
 assert.equal((await f.req(f.token1,'/v1/progress/versions')).body.versions.length,2);
});
test('D1 idempotent replay does not increment revision; stale writes conflict',async t=>{
 const f=await setup();t.after(f.db.close);
 const p=put(0,'operation-001',{[section]:{completed:['one']}});
 assert.equal((await f.req(f.token1,undefined,p)).status,200);
 assert.equal((await f.req(f.token1,undefined,p)).body.revision,1);
 assert.equal((await f.req(f.token1,undefined,put(0,'operation-001',{}))).status,409);
 assert.equal((await f.req(f.token2,undefined,put(0,'operation-002',{}))).status,409);
 assert.equal((await f.req(f.token1)).body.revision,1);
});
test('D1 rejects invalid data, malicious origin, no authorization and bad operations',async t=>{
 const f=await setup();t.after(f.db.close);
 assert.equal((await f.req('incorrect')).status,401);
 assert.equal((await f.req(f.token1,undefined,{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.req(f.token1,undefined,put(0,'operation-001',{unknown:{}}))).status,422);
 assert.equal((await f.req(f.token1,undefined,{method:'PUT',body:'{}'})).status,415);
 assert.equal((await f.req(f.token1,undefined,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,428);
 assert.equal((await f.req(f.token1,undefined,{...put(0,'operation-001',{}),body:'{'})).status,400);
});
test('D1 token revocation and logout only affect current device',async t=>{
 const f=await setup();t.after(f.db.close);
 assert.equal((await f.req(f.token1,'/v1/session')).body.accountId,'person_A');
 const logout=await f.req(f.token1,'/v1/session',{method:'DELETE'});
 assert.equal(logout.body.signedOut,true);
 assert.equal((await f.req(f.token1)).status,401);
 assert.equal((await f.req(f.token2)).status,200);
});
test('D1 batch rolls back progress on audit failure',async t=>{
 const f=await setup();t.after(f.db.close);
 const db=f.db;
 // Verify version failure via additional query, after explicit trigger.
 await db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'audit failed'); END;").run();
 const result=await f.req(f.token1,undefined,put(0,'operation-001',{}));
 assert.equal(result.status,500);
 assert.equal((await f.req(f.token1)).body.revision,0);
 assert.equal((await f.req(f.token1,'/v1/progress/versions')).body.versions.length,0);
});
