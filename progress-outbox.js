/* Explicit, account-scoped offline outbox for future authenticated sync.
 * No automatic network, no tokens in storage, no local progress mutation.
 * One pending whole-snapshot operation per account; later changes must be resolved
 * explicitly instead of silently replacing an unsent snapshot.
 */
(function(root){'use strict';
const PREFIX='ai-course-outbox-v1:', FORMAT='ai-course-outbox-v1',MAX=900000;
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
const clone=x=>JSON.parse(JSON.stringify(x));
function create({storage,accountId,randomUUID=()=>root.crypto.randomUUID()}){
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('Storage required');
 if(!validId(accountId))throw Error('Opaque account identifier required');
 const key=PREFIX+accountId;
 function read(){
  const raw=storage.getItem(key);
  if(raw===null)return{format:FORMAT,accountId,pending:null,conflict:null};
  if(raw.length>MAX)throw Error('Outbox size limit exceeded');
  const state=JSON.parse(raw);
  if(!state||state.format!==FORMAT||state.accountId!==accountId||!Object.prototype.hasOwnProperty.call(state,'pending')||!Object.prototype.hasOwnProperty.call(state,'conflict'))throw Error('Invalid outbox');
  if(state.pending){
   const p=state.pending;
   if(!validId(p.id)||!Number.isSafeInteger(p.baseRevision)||p.baseRevision<0||!p.sections)throw Error('Invalid pending operation');
   root.CourseSyncModel.makeEnvelope(p.sections,{deviceId:'outbox-validation'});
  }
  if(state.conflict&&(!state.pending||typeof state.conflict.reason!=='string'))throw Error('Invalid conflict');
  return clone(state);
 }
 function write(state){
  const raw=JSON.stringify(state);
  if(raw.length>MAX)throw Error('Outbox size limit exceeded');
  storage.setItem(key,raw);
  if(storage.getItem(key)!==raw)throw Error('Outbox write could not be verified');
  return clone(state);
 }
 function enqueue(sections,baseRevision){
  if(!Number.isSafeInteger(baseRevision)||baseRevision<0)throw Error('Invalid base revision');
  const current=read();
  if(current.pending)throw Error('Pending changes must be resolved first');
  const safe=root.CourseSyncModel.makeEnvelope(sections,{deviceId:'outbox-validation'}).sections;
  const id=randomUUID();
  if(!validId(id)||id.length<8)throw Error('Invalid operation id');
  const candidate={id,baseRevision,sections:safe};
  return write({...current,pending:candidate,conflict:null});
 }
 async function flush(client){
  if(!client||typeof client.save!=='function')throw Error('Client required');
  const current=read();
  if(!current.pending)return{status:'idle'};
  if(current.conflict)return{status:'conflict',reason:current.conflict.reason};
  const p=current.pending;
  let result;
  try{result=await client.save(clone(p.sections),p.baseRevision,p.id)}
  catch(e){return{status:'retry',reason:'network_or_server_error'};}
  // An asynchronous request may have overlapped an edit in another tab.
  const latest=read();
  if(JSON.stringify(latest.pending)!==JSON.stringify(p))return{status:'changed',reason:'outbox_modified'};
  if(result&&result.conflict){
   write({...latest,conflict:{reason:'server_revision_conflict',serverRevision:result.current?.revision??null}});
   return{status:'conflict',reason:'server_revision_conflict'};
  }
  if(!result||result.revision!==p.baseRevision+1||JSON.stringify(result.sections)!==JSON.stringify(p.sections))
   return{status:'retry',reason:'unexpected_ack'};
  write({...latest,pending:null,conflict:null});
  return{status:'synced',revision:result.revision};
 }
 function discard(){
  const state=read();
  if(!state.pending)return state;
  return write({...state,pending:null,conflict:null});
 }
 return Object.freeze({key,read,enqueue,flush,discard});
}
root.CourseOutbox=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
