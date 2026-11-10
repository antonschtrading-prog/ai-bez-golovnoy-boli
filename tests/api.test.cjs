const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {Store}=require('../server/store.cjs'),{handler}=require('../server/api.cjs'),{verify}=require('../server/telegram.cjs');
const {createHmac}=require('node:crypto');const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const tokenA='a'.repeat(40),tokenB='b'.repeat(40),section='ai-no-headache-v1';
async function fixture(t){const store=new Store();store.provision('a',tokenA,Date.now()+60000);store.provision('b',tokenB,Date.now()+60000);const server=http.createServer(handler({store,origins:['https://course.example']}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.close();store.close()});const base='http://127.0.0.1:'+server.address().port;return{store,call:async(path='/v1/progress',options={})=>{const r=await fetch(base+path,{...options,headers:{Authorization:'Bearer '+tokenA,...options.headers}});return{status:r.status,body:await r.json()}}}}
const put=(revision,id,sections)=>({method:'PUT',headers:{'Content-Type':'application/json','If-Match':`"${revision}"`,'Idempotency-Key':id},body:JSON.stringify({sections})});
test('HTTP save, read, duplicate, stale conflict and account isolation',async t=>{const {call}=await fixture(t);const operation=put(0,'operation-1',{[section]:{deepNotes:{a:'draft'}}});assert.equal((await call(undefined,operation)).body.revision,1);assert.equal((await call(undefined,operation)).body.revision,1);assert.equal((await call(undefined,put(0,'operation-2',{}))).status,409);assert.equal((await call(undefined,put(1,'operation-1',{}))).status,409);assert.equal((await call()).body.sections[section].deepNotes.a,'draft');assert.deepEqual((await call(undefined,{headers:{Authorization:'Bearer '+tokenB}})).body.sections,{});assert.equal((await call('/v1/progress/versions',{headers:{Authorization:'Bearer '+tokenB}})).body.versions.length,0)});
test('HTTP unauthorized, origin, schema, content type and missing revision',async t=>{const {call}=await fixture(t);assert.equal((await call(undefined,{headers:{Authorization:''}})).status,401);assert.equal((await call(undefined,{headers:{Origin:'https://evil.example'}})).status,403);assert.equal((await call(undefined,put(0,'operation-1',{unknown:{}}))).status,422);assert.equal((await call(undefined,{method:'PUT',body:'{}'})).status,415);assert.equal((await call(undefined,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,428);const p=put(0,'operation-1',{});p.body=JSON.stringify({sections:{},account:'b'});assert.equal((await call(undefined,p)).status,422)});
test('concurrent writes produce one winner',async t=>{const {call}=await fixture(t);const r=await Promise.all([call(undefined,put(0,'operation-a',{})),call(undefined,put(0,'operation-b',{}))]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409])});
test('database restart retains revisions and idempotency',()=>{const dir=mkdtempSync(join(tmpdir(),'course-'));try{const path=join(dir,'test.sqlite');let s=new Store(path);s.put('a','op',0,{[section]:{}});s.close();s=new Store(path);assert.equal(s.get('a').revision,1);assert.equal(s.put('a','op',0,{[section]:{}}).revision,1);s.close()}finally{rmSync(dir,{recursive:true})}});
function signed(at=Date.now(),id=123){const p=new URLSearchParams({auth_date:String(Math.floor(at/1000)),user:JSON.stringify({id})});const text=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');const secret=createHmac('sha256','WebAppData').update('test-token').digest();p.set('hash',createHmac('sha256',secret).update(text).digest('hex'));return p.toString()}
test('Telegram signature, expiry, tampering, replay and account reassignment',()=>{const raw=signed(),v=verify(raw,'test-token');assert.equal(v.user,'123');assert.throws(()=>verify(raw+'x','test-token'));assert.throws(()=>verify(signed(Date.now()-600000),'test-token'));assert.throws(()=>verify(signed(Date.now()+600000),'test-token'));assert.throws(()=>verify(raw+'&user=x','test-token'));const s=new Store();s.link('a',v.user,v.hash,v.expires);assert.throws(()=>s.link('a',v.user,v.hash,v.expires));assert.throws(()=>s.link('b',v.user,'another',v.expires));s.close()});
test('SQLite failure rolls back all writes',()=>{const s=new Store();s.db.exec("CREATE TRIGGER fail_version BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT, 'test failure'); END;");assert.throws(()=>s.put('a','op',0,{[section]:{}}));assert.equal(s.get('a').revision,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM operations').get().n,0);s.close()});
test('HTTP size cap and malformed JSON',async t=>{const {call}=await fixture(t);const p=put(0,'operation-1',{});assert.equal((await call(undefined,{...p,body:'{'})).status,400);assert.equal((await call(undefined,{...p,body:'x'.repeat(1024*1024+1)})).status,413)});
test('expired and revoked sessions cannot access progress',async t=>{const {store,call}=await fixture(t);store.db.prepare('UPDATE sessions SET expires=0 WHERE account=?').run('a');assert.equal((await call()).status,401);store.db.prepare('DELETE FROM sessions WHERE account=?').run('b');assert.equal((await call(undefined,{headers:{Authorization:'Bearer '+tokenB}})).status,401)});
test('authentication storage failure returns sanitized 500 and service recovers',async t=>{const {store,call}=await fixture(t);const auth=store.authenticate.bind(store);store.authenticate=()=>{throw Error('private database path')};const result=await call();assert.equal(result.status,500);assert.deepEqual(result.body,{error:'storage_failure'});store.authenticate=auth;assert.equal((await call()).status,200)});

test('trusted server issues unpredictable hashed sessions and revokes all devices',()=>{
 const s=new Store();
 try{
  const one=s.issueSession('accountA',60000),two=s.issueSession('accountA',60000);
  assert.notEqual(one.token,two.token);
  assert.match(one.token,/^[A-Za-z0-9_-]{32,256}$/);
  assert.equal(s.authenticate(one.token),'accountA');
  const stored=s.db.prepare('SELECT token FROM sessions').all().map(x=>x.token);
  assert(!stored.includes(one.token));assert(!stored.includes(two.token));
  assert.equal(s.revokeAll('accountA'),2);
  assert.equal(s.authenticate(one.token),undefined);
  assert.equal(s.authenticate(two.token),undefined);
  assert.throws(()=>s.issueSession('bad/account'),/Invalid account/);
  assert.throws(()=>s.issueSession('accountA',1000),/Invalid session lifetime/);
 }finally{s.close()}
});
