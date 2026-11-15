/* Read-only inspection and export of verified cloud-restore local backups.
 * Never sends or edits course data. Account-scoped to the authenticated user.
 */
(function(root){'use strict';
 const PREFIX='ai-course-cloud-restore-backup-v1:',FORMAT='ai-course-cloud-restore-backup-v1';
 function create({storage,accountId}){
  if(!storage||typeof storage.getItem!=='function'||typeof storage.key!=='function'||
    !/^tg_[A-Za-z0-9_-]{8,125}$/.test(accountId||''))throw Error('Verified account and storage required');
  function validate(key){
   if(typeof key!=='string'||!key.startsWith(PREFIX))throw Error('Invalid backup identifier');
   const raw=storage.getItem(key);
   if(typeof raw!=='string'||raw.length>3000000)throw Error('Backup unavailable or oversized');
   let value;
   try{value=JSON.parse(raw)}catch(_){throw Error('Backup damaged: export raw data before repair')}
   if(!value||value.format!==FORMAT||value.accountId!==accountId||
      typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||
      !Number.isSafeInteger(value.cloudRevision)||value.cloudRevision<0||
      !value.values||typeof value.values!=='object'||Array.isArray(value.values))throw Error('Invalid account backup');
   const keys=root.CourseSyncModel.KEYS;
   if(Object.keys(value.values).length!==keys.length)throw Error('Incomplete backup');
   for(const section of keys){
    if(!Object.prototype.hasOwnProperty.call(value.values,section))throw Error('Incomplete backup section');
    const sectionRaw=value.values[section];
    if(sectionRaw===null)continue;
    if(typeof sectionRaw!=='string')throw Error('Invalid backup section');
    let data;
    try{data=JSON.parse(sectionRaw)}catch(_){throw Error('Invalid saved JSON section')}
    root.CourseSyncModel.makeEnvelope({[section]:data},{deviceId:'backup-verification'});
   }
   return value;
  }
  function list(){
   const result=[];
   for(let i=0;i<storage.length;i++){
    const key=storage.key(i);
    if(typeof key!=='string'||!key.startsWith(PREFIX))continue;
    // Other accounts' backups remain private, even though on the same origin.
    const raw=storage.getItem(key);
    if(typeof raw!=='string'||raw.length>3000000)continue;
    let record;
    try{record=JSON.parse(raw)}catch(_){continue}
    if(record?.accountId!==accountId)continue;
    const safe=validate(key);
    result.push({key,createdAt:safe.createdAt,revision:safe.cloudRevision,
      sections:Object.values(safe.values).filter(x=>x!==null).length});
   }
   return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  function exportBackup(key){
   const record=validate(key);
   return JSON.stringify(record,null,2);
  }
  return Object.freeze({list,exportBackup});
 }
 root.CourseCloudBackups=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
