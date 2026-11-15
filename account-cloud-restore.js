/* Explicit cloud-to-local restoration. Never starts on login or page load.
 * Backs up ALL existing section values before any local writes; refuses unresolved
 * outbox, stale previews, corrupt data and missing cross-tab locking.
 */
(function(root){'use strict';
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const clone=x=>JSON.parse(JSON.stringify(x));
 function create({storage,client,locks,accountId,uuid,hasPending}){
  if(!storage||!client||typeof client.read!=='function'||!locks||typeof locks.request!=='function'||
   typeof uuid!=='function'||typeof hasPending!=='function'||!/^tg_[A-Za-z0-9_-]{8,125}$/.test(accountId||''))
   throw Error('Verified account, storage, client and Web Locks required');
  if(!root.CourseStorage||typeof root.CourseStorage.write!=='function'||typeof root.CourseStorage.rollbackBatch!=='function')
   throw Error('Safe local version storage unavailable');
  let draft=null;
  const lockName='course-cloud-restore:'+accountId;
  const withLock=fn=>locks.request(lockName,{mode:'exclusive'},fn);
  function rawState(){
   const state={};
   for(const key of root.CourseSyncModel.KEYS)state[key]=storage.getItem(key);
   return state;
  }
  function ensureNoPending(){if(hasPending())throw Error('Pending upload must be resolved before restore')}
  async function inspect(){
   draft=null;
   return withLock(async()=>{
    ensureNoPending();
    const before=rawState(),current=root.CourseAccountPreview.local(storage);
    const remote=root.CourseAccountPreview.remote(await client.read());
    const plan=root.CourseAccountPreview.plan(storage,remote);
    if(!equal(rawState(),before)||!equal(root.CourseAccountPreview.local(storage),current))
     throw Error('Local progress changed during comparison');
    if(plan.status!=='ready')return {status:'conflicts',conflicts:clone(plan.conflicts)};
    const ticket=uuid();
    if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(ticket))throw Error('Invalid restore ticket');
    draft={ticket,before,remote:clone(remote),proposed:clone(plan.proposed)};
    const changed=Object.keys(plan.proposed).filter(k=>!equal(before[k],JSON.stringify(plan.proposed[k])));
    return {status:'ready',ticket,revision:remote.revision,changed:changed.length,sections:Object.keys(plan.proposed).length};
   });
  }
  async function apply(ticket,confirmed){
   return withLock(async()=>{
    if(!confirmed||!draft||draft.ticket!==ticket)throw Error('Current restore proposal requires explicit consent');
    const selected=draft;draft=null;
    ensureNoPending();
    if(!equal(rawState(),selected.before))throw Error('Local progress changed: compare again');
    const remote=root.CourseAccountPreview.remote(await client.read());
    if(!equal(remote,selected.remote))throw Error('Cloud progress changed: compare again');
    const plan=root.CourseAccountPreview.plan(storage,remote);
    if(plan.status!=='ready'||!equal(plan.proposed,selected.proposed)||!equal(rawState(),selected.before))
     throw Error('Restore plan changed: compare again');
    const backupId=uuid();
    if(typeof backupId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(backupId))throw Error('Invalid backup ID');
    const backupKey='ai-course-cloud-restore-backup-v1:'+backupId;
    if(storage.getItem(backupKey)!==null)throw Error('Backup ID already exists');
    const backup={format:'ai-course-cloud-restore-backup-v1',accountId,createdAt:new Date().toISOString(),
     cloudRevision:remote.revision,values:selected.before};
    const serialized=JSON.stringify(backup);
    if(serialized.length>3000000)throw Error('Backup exceeds safe storage limit');
    storage.setItem(backupKey,serialized);
    if(storage.getItem(backupKey)!==serialized)throw Error('Backup write could not be verified');
    // Verify full backup BEFORE the first section update.
    const verified=JSON.parse(storage.getItem(backupKey));
    if(!equal(verified,backup))throw Error('Backup verification failed');
    const changes=[];
    let written=0;
    try{
     for(const key of root.CourseSyncModel.KEYS){
      if(!Object.prototype.hasOwnProperty.call(plan.proposed,key))continue;
      const after=JSON.stringify(plan.proposed[key]),before=selected.before[key];
      if(after===before)continue;
      if(storage.getItem(key)!==before)throw Error('Concurrent local edit: restore halted');
      // Version history captures the old AND new draft. Do not bypass it.
      root.CourseStorage.write(storage,key,after,{expected:before,reason:'cloud-restore'});
      changes.push({key,before,after});
      written++;
     }
    }catch(error){
     const rollback=root.CourseStorage.rollbackBatch(storage,changes);
     if(!rollback.complete)throw Error('Restore failed; partial rollback. Backup preserved at '+backupKey+
       '. Recheck sections: '+rollback.failures.join(', '));
     throw Error('Restore cancelled and rolled back: '+error.message+'. Backup preserved at '+backupKey);
    }
    return {status:'restored',backupKey,written,cloudRevision:remote.revision};
   });
  }
  function cancel(){draft=null}
  return Object.freeze({inspect,apply,cancel});
 }
 root.CourseCloudRestore=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
