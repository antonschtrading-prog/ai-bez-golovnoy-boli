(function(root){'use strict';
function create({client,readLocal,writeLocal,loadBase,saveBase,uuid}){
 let busy=false,stopped=false;
 async function tick(){
  if(busy||stopped)return {status:'busy'};busy=true;
  try{
   const local=readLocal(),remote=await client.read(),base=loadBase()||{};
   if(stopped)return {status:'stopped'};
   if(Object.keys(base).some(k=>!Object.hasOwn(local,k)||!Object.hasOwn(remote.sections,k)))return {status:'conflicts',conflicts:['removed-section']};
   const plan=root.CourseAutoMerge.merge(base,local,remote.sections);
   if(plan.status!=='ready')return plan;
   if(stopped)return {status:'stopped'};
   if(JSON.stringify(readLocal())!==JSON.stringify(local))return {status:'changed'};
   let revision=remote.revision;
   if(JSON.stringify(plan.proposed)!==JSON.stringify(remote.sections)){
    const result=await client.save(plan.proposed,revision,uuid());
    if(result.conflict)return {status:'retry'};
    if(!Number.isSafeInteger(result.revision)||result.revision<=revision)throw Error('Unconfirmed save');
    revision=result.revision;
   }
   // Keep the original baseline if a user typed while the request was in flight.
   if(stopped)return {status:'stopped'};
   if(JSON.stringify(readLocal())!==JSON.stringify(local))return {status:'changed'};
   writeLocal(plan.proposed,local);saveBase(plan.proposed);
   return {status:'saved',revision};
  }finally{busy=false}
 }
 return {tick,stop(){stopped=true}};
}
root.CourseAutoSync={create};
})(typeof window!=='undefined'?window:globalThis);
