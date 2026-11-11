/* Durable, explicit, single-operation outbox.
 * No implicit network access, background sends, local progress writes or last-write-wins.
 * Only use through an authenticated, account-scoped UI after explicit consent.
 */
(function(root){'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const maxBytes=950000;
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x);
const validAccount=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function create({storage,progressStorage,client,accountId,uuid}){
 if(!validAccount(accountId)||!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||
    !progressStorage||!client||typeof client.read!=='function'||typeof client.save!=='function'||
    typeof uuid!=='function')throw Error('Invalid outbox dependencies');
 const key='ai-course-sync-outbox-v1:'+accountId;
 let preview=null,busy=false;
 const local=()=>root.CourseAccountPreview.local(progressStorage);
 const remote=async()=>root.CourseAccountPreview.remote(await client.read());
 function decode(value){
  if(!value)return null;
  if(value.length>maxBytes)throw Error('Saved operation exceeds size limit');
  let item;
  try{item=JSON.parse(value)}catch(_){throw Error('Saved operation is corrupted: export it before repairs')}
  if(!item||item.format!=='ai-course-outbox-v1'||item.accountId!==accountId||
    !validId(item.id)||!Number.isSafeInteger(item.base)||item.base<0||
    !item.sections||typeof item.sections!=='object'||Array.isArray(item.sections)||
    typeof item.createdAt!=='string')throw Error('Invalid saved operation: export it before repairs');
  item.sections=root.CourseSyncModel.makeEnvelope(item.sections,{deviceId:'outbox-validation'}).sections;
  return item;
 }
 function pending(){return decode(storage.getItem(key))}
 function store(item){
  const serialized=JSON.stringify(item);
  if(serialized.length>maxBytes)throw Error('Operation too large for outbox');
  if(storage.getItem(key)!==null)throw Error('Unresolved cloud operation already exists');
  storage.setItem(key,serialized);
  if(storage.getItem(key)!==serialized)throw Error('Outbox write could not be verified');
 }
 function clearExact(item){
  const existing=pending();
  if(!existing||!same(existing,item))throw Error('Pending operation changed; manual review required');
  storage.removeItem(key);
  if(storage.getItem(key)!==null)throw Error('Outbox cleanup failed');
 }
 async function prepare(){
  if(busy)throw Error('Operation already in progress');
  busy=true;
  try{
   preview=null;
   if(pending())throw Error('Resolve existing pending operation before preparing another');
   const before=local(),cloud=await remote();
   const plan=root.CourseAccountPreview.plan(progressStorage,cloud);
   if(!same(local(),before))throw Error('Local data changed during inspection');
   if(plan.status!=='ready')return {status:'conflicts',conflicts:clone(plan.conflicts)};
   const id=uuid();
   if(!validId(id))throw Error('Invalid secure operation ID');
   preview={id,local:clone(before),cloud:clone(cloud),sections:clone(plan.proposed)};
   return {status:'ready',ticket:id,revision:cloud.revision,sectionCount:Object.keys(plan.proposed).length};
  }finally{busy=false}
 }
 async function approve(ticket,confirmed){
  if(busy)throw Error('Operation already in progress');
  busy=true;
  try{
   if(!confirmed||!preview||preview.id!==ticket)throw Error('Explicit approval of the current proposal required');
   const saved=preview;preview=null;
   if(pending())throw Error('An operation is already pending');
   if(!same(local(),saved.local))throw Error('Local progress changed: compare again');
   const cloud=await remote();
   if(!same(cloud,saved.cloud))throw Error('Cloud progress changed: compare again');
   const rechecked=root.CourseAccountPreview.plan(progressStorage,cloud);
   if(rechecked.status!=='ready'||!same(rechecked.proposed,saved.sections)||
      !same(local(),saved.local))throw Error('Merge plan changed: compare again');
   const item={format:'ai-course-outbox-v1',accountId,id:saved.id,
    base:cloud.revision,sections:clone(saved.sections),createdAt:new Date().toISOString()};
   store(item);return {status:'queued',id:item.id};
  }finally{busy=false}
 }
 async function sendPending(){
  if(busy)throw Error('Operation already in progress');
  busy=true;
  try{
   preview=null;
   const item=pending();
   if(!item)return {status:'empty'};
   const cloud=await remote();
   // The server may have committed the operation before the connection failed.
   if(cloud.revision>item.base){
    if(same(cloud.sections,item.sections)){clearExact(item);return {status:'confirmed',revision:cloud.revision};}
    return {status:'conflicts',reason:'Cloud advanced: retain pending operation for manual review'};
   }
   if(cloud.revision!==item.base)return {status:'conflicts',reason:'Cloud revision differs'};
   // Same persisted id + payload on every retry. A network error retains the record.
   const reply=await client.save(clone(item.sections),item.base,item.id);
   if(reply?.conflict)return {status:'conflicts',reason:'Server revision conflict'};
   // Do NOT clear on an unverified HTTP response.
   const verified=await remote();
   if(verified.revision>item.base&&same(verified.sections,item.sections)){
    clearExact(item);return {status:'confirmed',revision:verified.revision};
   }
   return {status:'uncertain',reason:'Cloud response not verified; operation retained'};
  }finally{busy=false}
 }
 function cancelPreview(){preview=null}
 return Object.freeze({prepare,approve,pending,sendPending,cancelPreview});
}
root.CourseDurableOutbox=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
