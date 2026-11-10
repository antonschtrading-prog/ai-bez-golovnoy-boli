/* Cloudflare D1 adapter. Trusted server operations only; no public login provision.
 * D1 batch is transactional; the conditional upsert wins one revision and
 * SQLite changes() gates history and idempotency receipt in the same batch.
 */
const MAX_AGE=30*24*60*60*1000;
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
export async function tokenDigest(token){
 return hex(await crypto.subtle.digest('SHA-256',encoder.encode(token)));
}
function stmt(db,sql,...args){return db.prepare(sql).bind(...args)}
export function createD1Store(db){
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')throw Error('D1 database required');
 return Object.freeze({
  async authenticate(token){
   const hashed=await tokenDigest(token);
   const record=await stmt(db,'SELECT account FROM sessions WHERE token=? AND expires>?',hashed,Date.now()).first();
   return record?.account||null;
  },
  async revoke(token){
   const hashed=await tokenDigest(token);
   const r=await stmt(db,'DELETE FROM sessions WHERE token=?',hashed).run();
   return r.meta.changes===1;
  },
  async read(account){
   const row=await stmt(db,'SELECT revision,sections FROM progress WHERE account=?',account).first();
   return row?{revision:row.revision,sections:JSON.parse(row.sections)}:{revision:0,sections:{}};
  },
  async history(account){
   const rows=await stmt(db,'SELECT revision,sections,at FROM versions WHERE account=? ORDER BY revision DESC LIMIT 50',account).all();
   return rows.results.map(row=>({...row,sections:JSON.parse(row.sections)}));
  },
  async put(account,id,base,sections){
   const payload=JSON.stringify({base,sections});
   const old=await stmt(db,'SELECT payload,response FROM operations WHERE account=? AND id=?',account,id).first();
   if(old)return old.payload===payload?{status:200,...JSON.parse(old.response)}:{status:409,error:'operation_id_reused'};
   const current=await this.read(account);
   if(current.revision!==base)return{status:409,error:'revision_conflict',current};
   const raw=JSON.stringify(sections),revision=base+1;
   const response=JSON.stringify({revision,sections});
   const results=await db.batch([
    // Revision CAS: if another request has advanced revision, changes() is 0.
    stmt(db,'INSERT INTO progress(account,revision,sections) VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET revision=excluded.revision, sections=excluded.sections WHERE progress.revision=?',account,revision,raw,base),
    stmt(db,"INSERT INTO versions(account,revision,sections,at) SELECT ?,?,?,? WHERE changes()=1",account,revision,raw,new Date().toISOString()),
    stmt(db,"INSERT INTO operations(account,id,payload,response) SELECT ?,?,?,? WHERE changes()=1",account,id,payload,response)
   ]);
   if(results[0]?.meta?.changes!==1){
    const retry=await stmt(db,'SELECT payload,response FROM operations WHERE account=? AND id=?',account,id).first();
    if(retry)return retry.payload===payload?{status:200,...JSON.parse(retry.response)}:{status:409,error:'operation_id_reused'};
    return{status:409,error:'revision_conflict',current:await this.read(account)};
   }
   if(results[1]?.meta?.changes!==1||results[2]?.meta?.changes!==1)throw Error('D1 atomic audit failure');
   return{status:200,revision,sections};
  },
  async createOidcChallenge(){
   const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
   const nonce=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const expires=Date.now()+5*60*1000;
   await stmt(db,'INSERT INTO oidc_challenges(nonce,expires) VALUES(?,?)',nonce,expires).run();
   // Opportunistic cleanup: no paid cron/scheduler.
   try{await stmt(db,'DELETE FROM oidc_challenges WHERE expires<?',Date.now()).run()}catch(_){}
   return{nonce,expires};
  },
  async challengeIsValid(nonce){
   if(typeof nonce!=='string'||! /^[A-Za-z0-9_-]{32,128}$/.test(nonce))return false;
   const row=await stmt(db,'SELECT nonce FROM oidc_challenges WHERE nonce=? AND expires>?',nonce,Date.now()).first();
   return !!row;
  },
  async consumeOidcChallenge(nonce){
   if(typeof nonce!=='string'||! /^[A-Za-z0-9_-]{32,128}$/.test(nonce))throw Error('invalid_oidc_challenge');
   const result=await stmt(db,'DELETE FROM oidc_challenges WHERE nonce=? AND expires>?',nonce,Date.now()).run();
   if(result.meta.changes!==1)throw Error('used_or_expired_challenge');
  },
  async oidcAccountForVerifiedTelegram(telegramId){
   if(typeof telegramId!=='string'||! /^[1-9][0-9]{0,15}$/.test(telegramId))throw Error('invalid_telegram_subject');
   const generated='tg_'+crypto.randomUUID().replace(/-/g,'');
   await stmt(db,'INSERT INTO telegram(user,account) VALUES(?,?) ON CONFLICT(user) DO NOTHING',telegramId,generated).run();
   const row=await stmt(db,'SELECT account FROM telegram WHERE user=?',telegramId).first();
   if(!row?.account)throw Error('telegram_mapping_failed');
   return row.account;
  },
  async verifiedTelegramAccount(telegramId,replay,expires){
   if(typeof telegramId!=='string'||!/^[1-9][0-9]{0,15}$/.test(telegramId)||!Number.isSafeInteger(expires)||expires<=Date.now())throw Error('Invalid verified Telegram identity');
   if(typeof replay!=='string'||! /^[a-f0-9]{64}$/.test(replay))throw Error('Invalid Telegram replay fingerprint');
   if(await stmt(db,'SELECT hash FROM replays WHERE hash=?',replay).first())throw Error('replayed_init_data');
   // Random account ID prevents takeover of a separately provisioned account.
   const account='tg_'+crypto.randomUUID().replace(/-/g,'');
   try{
    await db.batch([
     stmt(db,'INSERT INTO replays(hash,expires) VALUES(?,?)',replay,expires),
     stmt(db,'INSERT INTO telegram(user,account) VALUES(?,?) ON CONFLICT(user) DO NOTHING',telegramId,account)
    ]);
   }catch(e){
    if(await stmt(db,'SELECT hash FROM replays WHERE hash=?',replay).first())throw Error('replayed_init_data');
    throw e;
   }
   const linked=await stmt(db,'SELECT account FROM telegram WHERE user=?',telegramId).first();
   if(!linked?.account)throw Error('Missing Telegram identity mapping');
   // Safe maintenance: keep the replay table bounded without paying for a scheduler.
   try{await stmt(db,'DELETE FROM replays WHERE expires<?',Date.now()).run()}catch(_){}
   return linked.account;
  },
  // Trusted integration only: issued after external identity proof and consent.
  async issueSession(account,ttlMs=7*24*60*60*1000){
   if(typeof account!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(account))throw Error('Invalid account');
   if(!Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>MAX_AGE)throw Error('Invalid lifetime');
   const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
   // base64url without Buffer (Workers runtime)
   const token=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const expires=Date.now()+ttlMs;
   await stmt(db,'INSERT INTO sessions(token,account,expires) VALUES(?,?,?)',await tokenDigest(token),account,expires).run();
   return{token,expires};
  }
 });
}
