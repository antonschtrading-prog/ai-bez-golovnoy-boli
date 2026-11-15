/* User-triggered cloud-to-local restore only. No reads on page load.
 * Zero storage writes until user confirms and a recoverable backup is verified.
 */
(function(root){'use strict';
const $=id=>root.document.getElementById(id);
let restore=null,ticket=null,busy=false;
const status=(message,error=false)=>{$('restoreStatus').textContent=message;$('restoreStatus').className='status'+(error?' danger':'')};
function render(){
 $('restoreInspect').disabled=busy||!restore;
 $('restoreApply').disabled=busy||!restore||!ticket||!$('restoreConsent').checked;
}
function clear(){
 if(restore)restore.cancel();
 restore=null;ticket=null;$('restoreApproval').hidden=true;$('restoreConsent').checked=false;
 status('Восстановление доступно после входа.');render();
}
function setClient(client){
 clear();
 if(!client||!client.isSignedIn()||!client.account())throw Error('Verified account required');
 restore=root.CourseCloudRestore.create({
  storage:root.localStorage,client,locks:root.navigator&&root.navigator.locks,
  accountId:client.account(),uuid:()=>root.crypto.randomUUID(),
  hasPending:()=>root.CourseAccountQueuePage.hasPending()
 });
 status('Можно сравнить локальный прогресс с облачным. Запись начнётся только после согласия.');
 render();
}
async function run(task){
 if(busy||!restore)return;
 busy=true;render();
 try{await task()}
 catch(error){
  if(restore)restore.cancel();ticket=null;$('restoreApproval').hidden=true;$('restoreConsent').checked=false;
  status('Восстановление остановлено: '+error.message,true);
 }finally{busy=false;render()}
}
$('restoreConsent').addEventListener('change',render);
$('restoreCancel').addEventListener('click',()=>{
 if(restore)restore.cancel();ticket=null;$('restoreApproval').hidden=true;$('restoreConsent').checked=false;
 status('Восстановление отменено. Прогресс не изменён.');render();
});
$('restoreInspect').addEventListener('click',()=>run(async()=>{
 if(restore)restore.cancel();ticket=null;$('restoreApproval').hidden=true;$('restoreConsent').checked=false;
 const result=await restore.inspect();
 if(result.status!=='ready'){
  status('Обнаружены несовместимые ответы: '+result.conflicts.length+'. Восстановление запрещено, пока различия не разрешены.',true);
  return;
 }
 ticket=result.ticket;
 $('restorePlan').textContent='Облачная ревизия '+result.revision+
  '. Проверено разделов: '+result.sections+'. Изменится разделов: '+result.changed+
  '. Перед первой записью будет сохранена локальная резервная копия.';
 $('restoreApproval').hidden=false;
 status('План готов. Для переноса нужно отдельно подтвердить восстановление.');
}));
$('restoreApply').addEventListener('click',()=>run(async()=>{
 const selected=ticket,consent=$('restoreConsent').checked;
 ticket=null;$('restoreApproval').hidden=true;$('restoreConsent').checked=false;
 const result=await restore.apply(selected,consent);
 if(result.status!=='restored')throw Error('Неожиданный результат восстановления');
 status('Восстановлено разделов: '+result.written+
  '. Резервная копия сохранена: '+result.backupKey+
  '. Открой незавершённый урок для продолжения.');
 const count=$('localCount');
 if(count)count.textContent=String(Object.keys(root.CourseAccountPreview.local(root.localStorage).sections).length);
}));
clear();
root.CourseAccountRestorePage=Object.freeze({setClient,clear});
})(typeof window!=='undefined'?window:globalThis);
