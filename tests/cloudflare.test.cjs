const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{readFileSync}=require('node:fs');
const path=require('node:path');
require('../progress-sync-model.js');
const migrations=['0001_schema.sql','0002_oidc_challenges.sql'];
const schema=migrations.map(name=>readFileSync(path.join(__dirname,'../cloudflare/migrations',name),'utf8')).join('\n');
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
test('D1 OIDC schema creates expiring, single-use login challenges',async t=>{
 const db=mockD1();t.after(db.close);
 const {createD1Store}=await import('../cloudflare/d1-store.mjs');
 const store=createD1Store(db);
 const created=await store.createOidcChallenge();
 assert.match(created.nonce,/^[A-Za-z0-9_-]{32,128}$/);
 assert(created.expires>Date.now());
 assert.equal(await store.challengeIsValid(created.nonce),true);
 assert.equal(await store.challengeIsValid('not-a-valid-nonce'),false);
 await store.consumeOidcChallenge(created.nonce);
 assert.equal(await store.challengeIsValid(created.nonce),false);
 await assert.rejects(store.consumeOidcChallenge(created.nonce),/used_or_expired_challenge/);
 const expired=await store.createOidcChallenge();
 await db.prepare('UPDATE oidc_challenges SET expires=0 WHERE nonce=?').bind(expired.nonce).run();
 assert.equal(await store.challengeIsValid(expired.nonce),false);
 await assert.rejects(store.consumeOidcChallenge(expired.nonce),/used_or_expired_challenge/);
});
test('Browser login requires a configured client and a permitted browser origin',async t=>{
 const db=mockD1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const noClient=createHandler({db,origins:['https://course.example']});
 const request=(origin)=>new Request('https://api.example/v1/auth/browser/challenge',{method:'POST',headers:origin?{Origin:origin}:{}});
 assert.equal((await noClient(request('https://course.example'))).status,503);
 const handler=createHandler({db,origins:['https://course.example'],oidcClientId:'123456'});
 assert.equal((await handler(request('https://other.example'))).status,403);
 assert.equal((await handler(request(null))).status,403);
 const issued=await handler(request('https://course.example'));
 assert.equal(issued.status,200);
 const data=await issued.json();
 assert.match(data.nonce,/^[A-Za-z0-9_-]{32,128}$/);
 const stored=await db.prepare('SELECT nonce FROM oidc_challenges WHERE nonce=?').bind(data.nonce).first();
 assert.equal(stored.nonce,data.nonce);
});
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

function signedTelegram({botToken='test-bot-secret',userId=345,now=Date.now(),nonce='A'}={}){
 const {createHmac}=require('node:crypto');
 const fields=new URLSearchParams({auth_date:String(Math.floor(now/1000)),query_id:nonce,user:JSON.stringify({id:userId,first_name:'Test'})});
 const check=[...fields].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest();
 fields.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
 return fields.toString();
}
test('verified Telegram Mini App login issues revocable free account session',async t=>{
 const db=mockD1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const handler=createHandler({db,botToken:'test-bot-secret',origins:['https://antonschtrading-prog.github.io']});
 const post=async raw=>{const r=await handler(new Request('https://api.example/v1/auth/telegram',{method:'POST',
  headers:{'Content-Type':'application/json',Origin:'https://antonschtrading-prog.github.io'},
  body:JSON.stringify({initData:raw})}));return{status:r.status,body:await r.json()}};
 const raw=signedTelegram();
 const login=await post(raw);
 assert.equal(login.status,200);assert.match(login.body.token,/^[A-Za-z0-9_-]{32,256}$/);
 assert.match(login.body.accountId,/^tg_[a-f0-9]{32}$/);
 assert.equal((await post(raw)).status,409);
 const repeat=await post(signedTelegram({nonce:'B'}));
 assert.equal(repeat.status,200);assert.equal(repeat.body.accountId,login.body.accountId);
 const session=await handler(new Request('https://api.example/v1/session',{headers:{Authorization:'Bearer '+login.body.token}}));
 assert.equal((await session.json()).accountId,login.body.accountId);
});
test('Telegram Mini App rejects tampering, expired data, duplicate fields and чужой user ID',async t=>{
 const db=mockD1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const handler=createHandler({db,botToken:'test-bot-secret',origins:['https://course.example']});
 const call=async initData=>{
  const r=await handler(new Request('https://api.example/v1/auth/telegram',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData})
  }));return r.status;
 };
 const valid=signedTelegram();
 assert.equal(await call(valid.replace('345','777')),401);
 assert.equal(await call(signedTelegram({now:Date.now()-900000})),401);
 assert.equal(await call(valid+'&user=%7B%22id%22%3A999%7D'),401);
 assert.equal(await call(signedTelegram({userId:-2})),401);
 assert.equal(await call(signedTelegram({nonce:'wrong',botToken:'other-secret'})),401);
});
test('Telegram login unavailable without configured token',async t=>{
 const db=mockD1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const handler=createHandler({db});
 const r=await handler(new Request('https://api.example/v1/auth/telegram',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:signedTelegram()})
 }));
 assert.equal(r.status,503);
});

test('Cloudflare browser OIDC and Mini App share one verified account, reject replay, and isolate users',async t=>{
 const db=mockD1();t.after(db.close);
 const {createHandler}=await import('../cloudflare/api.mjs');
 const {subtle}=require('node:crypto').webcrypto;
 const keypair=await subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await subtle.exportKey('jwk',keypair.publicKey);
 const keyId='test-key-2026';
 const handler=createHandler({db,origins:['https://course.example'],botToken:'test-bot-secret',oidcClientId:'123456',
  jwksFetch:async()=>new Response(JSON.stringify({keys:[{...jwk,kid:keyId,alg:'RS256',use:'sig'}]}),{status:200,headers:{'Content-Type':'application/json'}})
 });
 const makeRequest=async(path,body,origin='https://course.example')=>{
  const resp=await handler(new Request('https://api.example'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return {status:resp.status,body:await resp.json()};
 };
 const mini=await makeRequest('/v1/auth/telegram',{initData:signedTelegram({nonce:'cross-device'})});
 assert.equal(mini.status,200);
 const challenge=await makeRequest('/v1/auth/browser/challenge',{});
 assert.equal(challenge.status,200);
 const now=Math.floor(Date.now()/1000);
 const b64=x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
 const jwt=async claims=>{
  const unsigned=b64({alg:'RS256',kid:keyId,typ:'JWT'})+'.'+b64(claims);
  const signature=await subtle.sign('RSASSA-PKCS1-v1_5',keypair.privateKey,Buffer.from(unsigned));
  return unsigned+'.'+Buffer.from(signature).toString('base64url');
 };
 const claims={iss:'https://oauth.telegram.org',aud:'123456',sub:'345',id:345,nonce:challenge.body.nonce,iat:now,exp:now+120};
 const fake=await makeRequest('/v1/auth/browser',{idToken:await jwt({...claims,id:789}),nonce:challenge.body.nonce});
 assert.equal(fake.status,200,'A valid signed different Telegram ID has its own account');
 assert.notEqual(fake.body.accountId,mini.body.accountId);
 const used=await makeRequest('/v1/auth/browser',{idToken:await jwt(claims),nonce:challenge.body.nonce});
 assert.equal(used.status,401,'Used OIDC challenge must never authenticate another user');
 const next=await makeRequest('/v1/auth/browser/challenge',{});
 const wrongIssuer=await makeRequest('/v1/auth/browser',{idToken:await jwt({...claims,nonce:next.body.nonce,iss:'https://evil.example'}),nonce:next.body.nonce});
 assert.equal(wrongIssuer.status,401,'Invalid signed issuer must not consume the nonce');
 const browser=await makeRequest('/v1/auth/browser',{idToken:await jwt({...claims,nonce:next.body.nonce}),nonce:next.body.nonce});
 assert.equal(browser.status,200);
 assert.equal(browser.body.accountId,mini.body.accountId);
 assert.notEqual(browser.body.token,mini.body.token);
 const session=await handler(new Request('https://api.example/v1/session',{headers:{Authorization:'Bearer '+browser.body.token}}));
 assert.equal((await session.json()).accountId,mini.body.accountId);
 const save=await handler(new Request('https://api.example/v1/progress',{method:'PUT',headers:{
  Authorization:'Bearer '+mini.body.token,'Content-Type':'application/json','If-Match':'"0"','Idempotency-Key':'cross-device-01'
 },body:JSON.stringify({sections:{[section]:{deepNotes:{fromMini:'hello'}}}})}));
 assert.equal(save.status,200);
 const read=await handler(new Request('https://api.example/v1/progress',{headers:{Authorization:'Bearer '+browser.body.token}}));
 assert.equal((await read.json()).sections[section].deepNotes.fromMini,'hello');
 const foreign=await handler(new Request('https://api.example/v1/progress',{headers:{Authorization:'Bearer '+fake.body.token}}));
 assert.deepEqual((await foreign.json()).sections,{});
 const again=await makeRequest('/v1/auth/browser',{idToken:await jwt({...claims,nonce:next.body.nonce}),nonce:next.body.nonce});
 assert.equal(again.status,401);
});
