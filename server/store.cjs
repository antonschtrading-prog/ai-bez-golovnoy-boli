'use strict';
const {DatabaseSync}=require('node:sqlite');
const {createHash,randomBytes}=require('node:crypto');
const digest=x=>createHash('sha256').update(x).digest('hex');
class Store{
 constructor(path=':memory:'){
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS progress(account TEXT PRIMARY KEY, revision INTEGER NOT NULL, sections TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS versions(account TEXT NOT NULL, revision INTEGER NOT NULL, sections TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(account,revision));
   CREATE TABLE IF NOT EXISTS operations(account TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(account,id));
   CREATE TABLE IF NOT EXISTS telegram(user TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL);
   CREATE TABLE IF NOT EXISTS replays(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
 }
 provision(account,token,expires){this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),account,expires)}
 /* Only trusted backend code may call this after a verified identity exchange.
  * Deliberately no public endpoint for issuing an arbitrary account's token.
  */
 issueSession(account,ttlMs=7*24*60*60*1000){
  if(typeof account!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(account))throw Error('Invalid account id');
  if(!Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>30*24*60*60*1000)throw Error('Invalid session lifetime');
  const token=randomBytes(32).toString('base64url');
  const expires=Date.now()+ttlMs;
  this.provision(account,token,expires);
  return {token,expires};
 }
 revokeAll(account){
  if(typeof account!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(account))throw Error('Invalid account id');
  return this.db.prepare('DELETE FROM sessions WHERE account=?').run(account).changes;
 }

 authenticate(token){return this.db.prepare('SELECT account FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now())?.account}
 revoke(token){return this.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token)).changes===1}
 get(account){const r=this.db.prepare('SELECT revision,sections FROM progress WHERE account=?').get(account);return r?{revision:r.revision,sections:JSON.parse(r.sections)}:{revision:0,sections:{}}}
 history(account){return this.db.prepare('SELECT revision,sections,at FROM versions WHERE account=? ORDER BY revision DESC LIMIT 50').all(account).map(x=>({...x,sections:JSON.parse(x.sections)}))}
 put(account,id,base,sections){
  const payload=JSON.stringify({base,sections});
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const op=this.db.prepare('SELECT payload,response FROM operations WHERE account=? AND id=?').get(account,id);
   if(op){this.db.exec('COMMIT');return op.payload===payload?{status:200,...JSON.parse(op.response)}:{status:409,error:'operation_id_reused'}}
   const current=this.get(account);
   if(current.revision!==base){this.db.exec('COMMIT');return{status:409,error:'revision_conflict',current}}
   const result={revision:base+1,sections},raw=JSON.stringify(sections);
   this.db.prepare('INSERT INTO progress VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET revision=excluded.revision,sections=excluded.sections').run(account,result.revision,raw);
   this.db.prepare('INSERT INTO versions VALUES(?,?,?,?)').run(account,result.revision,raw,new Date().toISOString());
   this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(account,id,payload,JSON.stringify(result));
   this.db.prepare('DELETE FROM operations WHERE account=? AND rowid NOT IN (SELECT rowid FROM operations WHERE account=? ORDER BY rowid DESC LIMIT 500)').run(account,account);
   this.db.prepare('DELETE FROM versions WHERE account=? AND revision<=?').run(account,result.revision-50);
   this.db.exec('COMMIT');return{status:200,...result};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 link(account,user,hash,expires){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('DELETE FROM replays WHERE expires<?').run(Date.now());
   this.db.prepare('INSERT INTO replays VALUES(?,?)').run(hash,expires);
   const existing=this.db.prepare('SELECT account FROM telegram WHERE user=?').get(user);
   if(existing&&existing.account!==account)throw Error('already_linked');
   this.db.prepare('INSERT INTO telegram VALUES(?,?) ON CONFLICT(user) DO NOTHING').run(user,account);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 close(){this.db.close()}
}
module.exports={Store};
