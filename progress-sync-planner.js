/* Pure preflight for explicit account migration. No network or storage writes.
 * Differs from direct PUT: verifies remote snapshot and never silently discards
 * the sections or partial progress already saved in the account.
 */
(function(root){'use strict';
function prepare(localSections,serverRecord){
 if(!serverRecord||!Number.isSafeInteger(serverRecord.revision)||serverRecord.revision<0)throw Error('Invalid server revision');
 const remote=root.CourseSyncModel.makeEnvelope(serverRecord.sections,{deviceId:'planner-remote'}).sections;
 const local=root.CourseSyncModel.makeEnvelope(localSections,{deviceId:'planner-local'}).sections;
 const plan=root.CourseMergeRules.audit(remote,local);
 return {status:plan.safe?'ready':'conflicts',revision:serverRecord.revision,
  conflicts:plan.conflicts.map(x=>({key:x.key,field:x.field,reason:x.reason})),
  proposed:plan.safe?JSON.parse(JSON.stringify(plan.proposed)):null,
  summary:plan.summary};
}
function queueIfSafe(outbox,plan){
 if(!outbox||typeof outbox.enqueue!=='function')throw Error('Outbox required');
 if(!plan||plan.status!=='ready'||!plan.proposed)throw Error('Manual conflict resolution required');
 return outbox.enqueue(plan.proposed,plan.revision);
}
root.CourseSyncPlanner=Object.freeze({prepare,queueIfSafe});
})(typeof window!=='undefined'?window:globalThis);
