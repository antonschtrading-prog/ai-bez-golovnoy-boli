/* Explicit, guarded cloud commit. No automatic writes or local replacement.
 * A proposal is valid only for the exact local and remote snapshots inspected.
 */
(function(root){'use strict';
 const deep=x=>JSON.parse(JSON.stringify(x));
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function create({storage,client,uuid}){
  if(!storage||!client||typeof client.read!=='function'||typeof client.save!=='function')throw Error('Storage and API client required');
  if(typeof uuid!=='function')throw Error('Secure operation ID generator required');
  let proposal=null,used=false;
  async function inspect(){
   proposal=null;used=false;
   const remote=root.CourseAccountPreview.remote(await client.read());
   const local=root.CourseAccountPreview.local(storage);
   const plan=root.CourseAccountPreview.plan(storage,remote);
   if(!same(local,root.CourseAccountPreview.local(storage)))throw Error('Local data changed during inspection');
   if(plan.status!=='ready')return {status:'conflicts',conflicts:deep(plan.conflicts),revision:remote.revision};
   const id=uuid();
   if(typeof id!=='string'||!(/^[A-Za-z0-9_-]{8,128}$/).test(id))throw Error('Invalid secure operation ID');
   proposal={id,local:deep(local),remote:deep(remote),plan:deep(plan)};
   return {status:'ready',id,revision:remote.revision,sectionCount:Object.keys(plan.proposed).length,summary:deep(plan.summary)};
  }
  async function commit(id,confirmed){
   if(!confirmed||!proposal||used||id!==proposal.id)throw Error('Explicit confirmation for current proposal required');
   used=true;
   const selected=proposal;proposal=null;
   if(!same(root.CourseAccountPreview.local(storage),selected.local))throw Error('Local progress changed: compare again');
   const remote=root.CourseAccountPreview.remote(await client.read());
   if(!same(remote,selected.remote))throw Error('Cloud progress changed: compare again');
   const plan=root.CourseAccountPreview.plan(storage,remote);
   if(plan.status!=='ready'||!same(plan.proposed,selected.plan.proposed))throw Error('Merge plan changed: compare again');
   if(!same(root.CourseAccountPreview.local(storage),selected.local))throw Error('Local progress changed: compare again');
   // Server requires If-Match revision and idempotency key; never use blind replacement.
   const result=await client.save(deep(plan.proposed),remote.revision,id);
   if(result&&result.conflict)return {status:'conflicts',reason:'Server revision changed; compare again'};
   if(!result||!Number.isSafeInteger(result.revision)||result.revision<=remote.revision)throw Error('Unconfirmed server response: retain local data and verify cloud');
   return {status:'saved',revision:result.revision};
  }
  function cancel(){proposal=null;used=true}
  return Object.freeze({inspect,commit,cancel});
 }
 root.CourseSyncCommit=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
