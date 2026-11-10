const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {readFileSync}=require('node:fs');
const {createHmac,generateKeyPairSync,sign}=require('node:crypto');
const path=require('node:path');
require('../progress-sync-model.js');
const migrationPath=path.join(__dirname,'../cloudflare/migrations/');
const sql=[1,2,3].map((n)=>readFileSync(migrationPath+('000'+n)+(n===1?'_schema.sql':n===2?'_replay_expiry.sql':'_oidc_challenges.sql'),'utf8')).join('\n');
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
function memoryD1(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(sql);
 const prepared=(query,args=[])=>({
  bind(...values){return prepared(query,values)},
  async first(){return sqlite.prepare(query).get(...args)||null},
  async all(){return{results:sqlite.prepare(query).all(...args)}},
  async run(){const x=sqlite.prepare(query).run(...args);return{meta:{changes:x.changes}}}
 });
 return{prepare:prepared,async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE');
  try{const result=[];for(const x of statements)result.push(await x.run());sqlite.exec('COMMIT');return result}
  catch(e){sqlite.exec('ROLLBACK');throw e}
 },close:()=>sqlite.close()};
}
function signedInitData(id=987654321){
 const x=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),query_id:'qid1',user:JSON.stringify({id})});
 const text=[...x].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update('fake-bot-token').digest();
 x.set('hash',createHmac('sha256',secret).update(text).digest('hex'));return x.toString();
}
async function fixture(t){
 const db=memoryD1();t.after(()=>db.close());
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk=publicKey.export({format:'jwk'});jwk.kid='test-rsa';jwk.alg='RS256';jwk.use='sig';
 const {createHandler}=await import('../cloudflare/api.mjs');
 const origin='https://antonschtrading-prog.github.io',clientId='123456';
 const handler=createHandler({db,origins:[origin],botToken:'fake-bot-token',oidcClientId:clientId,
  jwksFetch:async(url)=>{assert.equal(url,'https://oauth.telegram.org/.well-known/jwks.json');return{ok:true,json:async()=>({keys:[jwk]})}}});
 const post=async(route,data,headers={})=>{
  const response=await handler(new Request('https://api.test'+route,{method:'POST',
   headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)}));
  return{status:response.status,body:await response.json()};
 };
 function jwt(nonce,overrides={}){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:'https://oauth.telegram.org',aud:clientId,sub:'1234123412341234123',id:987654321,nonce,iat:now,exp:now+300,...overrides};
  const text=b64({alg:'RS256',typ:'JWT',kid:'test-rsa'})+'.'+b64(claims);
  return text+'.'+sign('RSA-SHA256',Buffer.from(text),privateKey).toString('base64url');
 }
 return{handler,post,jwt,origin};
}
test('Mini App and browser OIDC resolve to exactly one account',async t=>{
 const f=await fixture(t);
 const mini=await f.post('/v1/auth/telegram',{initData:signedInitData()});
 assert.equal(mini.status,200);
 const challenge=await f.post('/v1/auth/browser/challenge',{});
 assert.equal(challenge.status,200);
 assert.match(challenge.body.nonce,/^[A-Za-z0-9_-]{32,128}$/);
 const browser=await f.post('/v1/auth/browser',{idToken:f.jwt(challenge.body.nonce),nonce:challenge.body.nonce});
 assert.equal(browser.status,200);assert.equal(browser.body.accountId,mini.body.accountId);
 const bearer=await f.handler(new Request('https://api.test/v1/session',{headers:{Authorization:'Bearer '+browser.body.token}}));
 assert.equal((await bearer.json()).accountId,mini.body.accountId);
 const replay=await f.post('/v1/auth/browser',{idToken:f.jwt(challenge.body.nonce),nonce:challenge.body.nonce});
 assert.equal(replay.status,401);
});
test('browser OIDC denies mismatched signature, issuer, audience, nonce and altered subject',async t=>{
 const f=await fixture(t),c=await f.post('/v1/auth/browser/challenge',{});
 for(const claims of [{aud:'wrong'},{iss:'https://attacker.example'},{nonce:'not-the-real-challenge'},{sub:'-1'},{id:undefined},{id:0},{exp:0},{iat:Math.floor(Date.now()/1000)+1000}]){
  const response=await f.post('/v1/auth/browser',{idToken:f.jwt(c.body.nonce,claims),nonce:c.body.nonce});
  assert.equal(response.status,401);
 }
 const valid=f.jwt(c.body.nonce);
 const changed=valid.slice(0,-3)+'abc';
 assert.equal((await f.post('/v1/auth/browser',{idToken:changed,nonce:c.body.nonce})).status,401);
 assert.equal((await f.post('/v1/auth/browser',{idToken:valid,nonce:c.body.nonce})).status,200);
});
test('browser OIDC refuses requests without configured client, origin or matching challenge',async t=>{
 const f=await fixture(t);
 const noOrigin=await f.handler(new Request('https://api.test/v1/auth/browser/challenge',{method:'POST'}));
 assert.equal(noOrigin.status,403);
 const c=await f.post('/v1/auth/browser/challenge',{});
 assert.equal((await f.post('/v1/auth/browser',{idToken:f.jwt(c.body.nonce),nonce:'x'.repeat(43)})).status,401);
 const noClient=(await import('../cloudflare/api.mjs')).createHandler({db:memoryD1(),origins:[f.origin]});
 const inactive=await noClient(new Request('https://api.test/v1/auth/browser/challenge',{method:'POST',headers:{Origin:f.origin}}));
 assert.equal(inactive.status,503);
});
