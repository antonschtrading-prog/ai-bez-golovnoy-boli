/* Explicit outbox controller. No background requests or local course mutations.
 * Web Locks serialize account queue operations across tabs on this origin.
 */
(function(root){'use strict';
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const copy=x=>JSON.parse(JSON.stringify(x));
 function create({storage,client,accountId,locks,randomUUID}){
  if(!client||typeof client.read!=='function'||typeof client.save!=='function'||
    !storage||!locks||typeof locks.request!=='function'||typeof randomUUID!=='function')
   throw Error('Account-scoped storage, secure lock and client required');
  if(typeof accountId!=='string'||!/^tg_[A-Za-z0-9_-]{8,125}$/.test(accountId))throw Error('Verified Telegram account required');
  const queue=root.CourseOutbox.create({storage,accountId,randomUUID});
  const lockName='course-sync-outbox:'+accountId;
  let proposal=null;
  const locked=callback=>locks.request(lockName,{mode:'exclusive'},callback);
  async function inspect(){
   proposal=null;
   return locked(async()=>{
    if(queue.read().pending)return {status:'pending'};
    const before=root.CourseAccountPreview.local(storage);
    const server=root.CourseAccountPreview.remote(await client.read());
    const plan=root.CourseAccountPreview.plan(storage,server);
    if(!same(root.CourseAccountPreview.local(storage),before))throw Error('Local changed during inspection');
    if(plan.status!=='ready')return {status:'conflicts',conflicts:copy(plan.conflicts)};
    const ticket=randomUUID();
    if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(ticket))throw Error('Invalid ticket');
    proposal={ticket,before:copy(before),server:copy(server),proposed:copy(plan.proposed)};
    return {status:'ready',ticket,revision:server.revision,sectionCount:Object.keys(plan.proposed).length};
   });
  }
  async function approve(ticket,consent){
   return locked(async()=>{
    if(!consent||!proposal||ticket!==proposal.ticket)throw Error('Current proposal requires explicit approval');
    const approved=proposal;proposal=null;
    if(queue.read().pending)throw Error('Existing unsent operation must be handled first');
    if(!same(root.CourseAccountPreview.local(storage),approved.before))throw Error('Local data changed; inspect again');
    const server=root.CourseAccountPreview.remote(await client.read());
    if(!same(server,approved.server))throw Error('Cloud data changed; inspect again');
    const plan=root.CourseAccountPreview.plan(storage,server);
    if(plan.status!=='ready'||!same(plan.proposed,approved.proposed)||
       !same(root.CourseAccountPreview.local(storage),approved.before))throw Error('Merge changed; inspect again');
    const state=queue.enqueue(copy(plan.proposed),server.revision);
    return {status:'queued',id:state.pending.id,revision:state.pending.baseRevision};
   });
  }
  function cancel(){proposal=null}
  function pending(){return queue.read().pending}
  async function retry(){proposal=null;return locked(()=>queue.flushVerified(client))}
  return Object.freeze({inspect,approve,cancel,pending,retry});
 }
 root.CourseAccountOutboxController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
