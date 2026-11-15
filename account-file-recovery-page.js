/* Manual file-backup recovery UI. No automatic reads, imports or server writes. */
(function(root){'use strict';
 const $=id=>root.document.getElementById(id);
 let recovery=null,fileData=null,ticket=null,busy=false;
 const status=(msg,error=false)=>{$('fileRecoveryStatus').textContent=msg;$('fileRecoveryStatus').className='status'+(error?' danger':'')};
 function discard(){
  if(recovery)recovery.cancel();
  ticket=null;$('fileRecoveryApproval').hidden=true;$('fileRecoveryConsent').checked=false;
 }
 function controls(){
  $('recoveryFile').disabled=busy||!recovery;
  $('fileRecoveryInspect').disabled=busy||!recovery||!fileData;
  $('fileRecoveryApply').disabled=busy||!recovery||!ticket||!$('fileRecoveryConsent').checked;
 }
 function clear(){
  discard();recovery=null;fileData=null;$('recoveryFile').value='';
  status('После авторизации можно проверить файл.');controls();
 }
 function setClient(client){
  clear();
  if(!client||!client.isSignedIn()||!client.account())throw Error('Verified account required');
  recovery=root.CourseFileRecovery.create({storage:root.localStorage,accountId:client.account(),
   locks:root.navigator&&root.navigator.locks,uuid:()=>root.crypto.randomUUID(),
   hasPending:()=>root.CourseAccountQueuePage.hasPending()});
  status('Выбери скачанную резервную копию этого аккаунта.');controls();
 }
 async function run(task){
  if(busy||!recovery)return;
  busy=true;controls();
  try{await task()}catch(e){discard();status('Восстановление остановлено: '+e.message,true)}
  finally{busy=false;controls()}
 }
 $('recoveryFile').addEventListener('change',()=>run(async()=>{
  discard();fileData=null;
  const file=$('recoveryFile').files?.[0];
  if(!file){status('Файл не выбран.');return}
  if(file.size>3000000)throw Error('Файл слишком большой');
  fileData=await file.text();
  if(fileData.length>3000000)throw Error('Файл слишком большой');
  root.CourseFileRecovery.validateBackup(fileData,recoveryAccount());
  status('Файл проверен. Нажми «Проверить выбранный файл», чтобы сравнить ответы.');
 }));
 let account=null;
 function recoveryAccount(){return account}
 // Bind the verified identity separately from untrusted file metadata.
 const originalSetClient=setClient;
 function setVerifiedClient(client){account=client&&client.account();originalSetClient(client)}
 $('fileRecoveryInspect').addEventListener('click',()=>run(async()=>{
  discard();
  const result=await recovery.inspect(fileData);
  if(result.status!=='ready'){
   status('Конфликтующих записей: '+result.count+'. Нужно сохранить и разрешить различия вручную.',true);return;
  }
  ticket=result.ticket;
  $('fileRecoveryPlan').textContent='Разделов в копии: '+result.sections+
   '. Будет изменено разделов: '+result.changes+'. Перед записью создадим новую резервную копию.';
  $('fileRecoveryApproval').hidden=false;
  status('План проверен. Восстановление требует отдельного подтверждения.');
 }));
 $('fileRecoveryConsent').addEventListener('change',controls);
 $('fileRecoveryCancel').addEventListener('click',()=>{discard();status('Восстановление из файла отменено.');controls()});
 $('fileRecoveryApply').addEventListener('click',()=>run(async()=>{
  const saved=ticket,confirmed=$('fileRecoveryConsent').checked;
  // Consume the visible approval without cancelling the coordinator proposal.
  ticket=null;$('fileRecoveryApproval').hidden=true;$('fileRecoveryConsent').checked=false;
  const result=await recovery.apply(saved,confirmed);
  if(result.status!=='restored')throw Error('Неожиданный результат');
  status('Восстановлено разделов: '+result.written+'. Резервная копия прежних данных: '+result.backupKey+'. Открой занятие заново.');
  root.CourseAccountBackupsPage.refresh();
  $('localCount').textContent=String(Object.keys(root.CourseAccountPreview.local(root.localStorage).sections).length);
 }));
 clear();
 root.CourseFileRecoveryPage=Object.freeze({setClient:setVerifiedClient,clear:()=>{account=null;clear()}});
})(typeof window!=='undefined'?window:globalThis);
