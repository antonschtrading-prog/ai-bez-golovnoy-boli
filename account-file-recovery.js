/* Explicit recovery from downloaded cloud-restore backup.
 * Validate account, file, and every section before any write. No network.
 */
(function(root){'use strict';
 const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const copy=x=>JSON.parse(JSON.stringify(x));
 const F='ai-course-cloud-restore-backup-v1';
 const validAccount=x=>typeof x==='string'&&/^tg_[A-Za-z0-9_-]{8,125}$/.test(x);
 function validateBackup(raw,accountId){
  if(!validAccount(accountId)||typeof raw!=='string'||raw.length>3000000)throw Error('Invalid backup file or account');
  let record;
  try{record=JSON.parse(raw)}catch(_){throw Error('Backup file is not valid JSON')}
  if(!record||record.format!==F||record.accountId!==accountId||
   !Number.isSafeInteger(record.cloudRevision)||record.cloudRevision<0||
   typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||
   !record.values||typeof record.values!=='object'||Array.isArray(record.values))throw Error('Invalid backup format or account');
  const values=record.values;
  if(Object.keys(values).length!==root.CourseSyncModel.KEYS.length)throw Error('Backup sections incomplete');
  const sections={};
  for(const key of root.CourseSyncModel.KEYS){
   if(!Object.prototype.hasOwnProperty.call(values,key))throw Error('Backup section missing');
   const value=values[key];
   if(value===null)continue;
   if(typeof value!=='string'||value.length>2000000)throw Error('Invalid backup section');
   let parsed;
   try{parsed=JSON.parse(value)}catch(_){throw Error('Invalid section JSON')}
   sections[key]=root.CourseSyncModel.makeEnvelope({[key]:parsed},{deviceId:'backup-file-check'}).sections[key];
  }
  return {record,sections};
 }
 function create({storage,accountId,locks,uuid,hasPending}){
  if(!storage||!validAccount(accountId)||!locks||typeof locks.request!=='function'||
   typeof uuid!=='function'||typeof hasPending!=='function')throw Error('Verified account and cross-tab lock required');
  let proposal=null;
  const lock=fn=>locks.request('course-cloud-restore:'+accountId,{mode:'exclusive'},fn);
  const before=()=>Object.fromEntries(root.CourseSyncModel.KEYS.map(key=>[key,storage.getItem(key)]));
  function guard(){if(hasPending())throw Error('Resolve pending cloud upload before importing backup')}
  async function inspect(raw){
   proposal=null;
   return lock(async()=>{
    guard();
    const parsed=validateBackup(raw,accountId);
    const state=before();
    const plan=root.CourseAccountPreview.plan(storage,{revision:parsed.record.cloudRevision,sections:parsed.sections});
    if(!eq(before(),state))throw Error('Local progress changed while inspecting');
    if(plan.status!=='ready')return {status:'conflicts',count:plan.conflicts.length,conflicts:copy(plan.conflicts)};
    const ticket=uuid();
    if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(ticket))throw Error('Invalid approval ID');
    proposal={ticket,raw,state,proposed:copy(plan.proposed)};
    return {status:'ready',ticket,sections:Object.keys(parsed.sections).length,
     changes:Object.keys(plan.proposed).filter(k=>JSON.stringify(plan.proposed[k])!==state[k]).length};
   });
  }
  async function apply(ticket,confirmed){
   return lock(async()=>{
    if(!confirmed||!proposal||proposal.ticket!==ticket)throw Error('Explicit approval required');
    const selected=proposal;proposal=null;
    guard();
    if(!eq(before(),selected.state))throw Error('Local data changed: inspect again');
    const parsed=validateBackup(selected.raw,accountId);
    const plan=root.CourseAccountPreview.plan(storage,{revision:parsed.record.cloudRevision,sections:parsed.sections});
    if(plan.status!=='ready'||!eq(plan.proposed,selected.proposed)||!eq(before(),selected.state))
     throw Error('Import plan changed: inspect again');
    const id=uuid();
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(id))throw Error('Invalid backup ID');
    const backupKey='ai-course-cloud-restore-backup-v1:'+id;
    if(storage.getItem(backupKey)!==null)throw Error('Backup ID collision');
    const current={format:F,accountId,createdAt:new Date().toISOString(),cloudRevision:0,values:selected.state};
    const raw=JSON.stringify(current);
    if(raw.length>3000000)throw Error('Current backup too large');
    storage.setItem(backupKey,raw);
    if(storage.getItem(backupKey)!==raw)throw Error('Could not verify current-data backup');
    const changes=[];
    try{
     for(const key of root.CourseSyncModel.KEYS){
      if(!Object.prototype.hasOwnProperty.call(plan.proposed,key))continue;
      const previous=selected.state[key],next=JSON.stringify(plan.proposed[key]);
      if(previous===next)continue;
      if(storage.getItem(key)!==previous)throw Error('Concurrent change during file import');
      root.CourseStorage.write(storage,key,next,{expected:previous,reason:'file-backup-recovery'});
      changes.push({key,before:previous,after:next});
     }
    }catch(error){
     const rollback=root.CourseStorage.rollbackBatch(storage,changes);
     if(!rollback.complete)throw Error('Partial rollback; backup retained: '+backupKey+
      ' (failed sections: '+rollback.failures.join(', ')+')');
     throw Error('Import rolled back: '+error.message+'. Current-data backup retained: '+backupKey);
    }
    return {status:'restored',written:changes.length,backupKey};
   });
  }
  function cancel(){proposal=null}
  return Object.freeze({inspect,apply,cancel});
 }
 root.CourseFileRecovery=Object.freeze({create,validateBackup});
})(typeof window!=='undefined'?window:globalThis);
