/* Explicit authenticated sync coordinator (no automatic upload, no sign-in UI).
 * Real identity must be established by the server's authenticated /v1/session.
 * Account IDs come from the server, never from a user-selected local string.
 */
(function(root){'use strict';
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const clone=value=>JSON.parse(JSON.stringify(value));
function create({client,storage,forgetCredentials,randomUUID=()=>root.crypto.randomUUID()}){
 if(!client||!['session','read','save','logout'].every(name=>typeof client[name]==='function'))throw Error('Authenticated client required');
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('Storage required');
 if(typeof forgetCredentials!=='function')throw Error('Credential clearing callback required');
 let active=null,generation=0;
 function requireActive(){
  if(!active)throw Error('Connect to account before synchronizing');
  return active;
 }
 function state(){return active?{connected:true,accountId:active.accountId,pending:active.outbox.read().pending!==null}:{connected:false}}
 async function connect(){
  if(active)throw Error('Already connected; sign out first');
  const sequence=++generation;
  const identity=await client.session();
  if(sequence!==generation)throw Error('Session request was cancelled');
  if(!identity?.authenticated||!valid(identity.accountId))throw Error('Server identity not verified');
  const outbox=root.CourseOutbox.create({storage,accountId:identity.accountId,randomUUID});
  outbox.read(); // Fail closed on corrupted account state.
  active={accountId:identity.accountId,outbox};
  return state();
 }
 async function preview(localSections){
  const session=requireActive(),seq=generation;
  const remote=await client.read();
  if(seq!==generation||session!==active)throw Error('Session changed while reading');
  const plan=root.CourseSyncPlanner.prepare(localSections,remote);
  return {status:plan.status,conflicts:plan.conflicts,summary:plan.summary,revision:plan.revision,proposed:plan.proposed?clone(plan.proposed):null};
 }
 async function queue(localSections,options={}){
  if(options.confirmed!==true)throw Error('Explicit consent to transfer local progress required');
  const session=requireActive();
  if(session.outbox.read().pending)throw Error('Pending copy must be resolved first');
  const plan=await preview(localSections);
  if(session!==active)throw Error('Session changed before queueing');
  if(plan.status!=='ready')return{status:'conflicts',conflicts:plan.conflicts};
  const saved=root.CourseSyncPlanner.queueIfSafe(session.outbox,plan);
  return {status:'queued',operationId:saved.pending.id,baseRevision:saved.pending.baseRevision};
 }
 async function send(){
  const session=requireActive();
  return session.outbox.flush(client);
 }
 function pending(){return clone(requireActive().outbox.read())}
 function discardPending(){
  // No automatic discards. UI must explicitly confirm this destructive operation.
  return requireActive().outbox.discard();
 }
 async function signOut(){
  ++generation;active=null;
  let serverRevoked=false,serverError=null,localCleared=false,clearError=null;
  try{const answer=await client.logout();serverRevoked=answer?.signedOut===true}catch(e){serverError='server_revocation_unconfirmed'}
  try{await forgetCredentials();localCleared=true}catch(e){clearError='credential_clear_failed'}
  return{signedOut:localCleared,serverRevoked,serverError,clearError,
   note:localCleared?'Account outbox retained for later authenticated recovery':'Credentials could not be cleared; retry or close the session'};
 }
 return Object.freeze({connect,state,preview,queue,send,pending,discardPending,signOut});
}
root.CourseSyncCoordinator=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
