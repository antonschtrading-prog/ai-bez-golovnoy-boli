/* Manual account outbox UI. Network writes happen ONLY on explicit retry click. */
(function(root){'use strict';
const $=id=>root.document.getElementById(id);
let controller=null,task=null,busy=false;
const report=(message,error=false)=>{$('queueStatus').textContent=message;$('queueStatus').className='status'+(error?' danger':'')};
function pending(){if(!controller)return null;return controller.pending()}
function readyForDirectSave(){
 try{return !!controller&&!pending()}catch(_){return false}
}
function render(){
 let existing=null,error=null;
 try{existing=pending()}catch(e){error=e}
 $('queueInspect').disabled=busy||!controller||!!existing||!!error;
 $('queueRetry').disabled=busy||!controller||!existing||!!error;
 $('queueExport').disabled=busy||!controller||!existing||!!error;
 $('queueApprove').disabled=busy||!controller||!task||!$('queueConsent').checked;
 if(!controller)report('Очередь доступна после подтверждённого входа через Telegram.');
 else if(error)report('Очередь повреждена: '+error.message+'. Не очищай данные браузера; требуется восстановление.',true);
 else if(existing)report('Ожидает отправки операция '+existing.id+'. После перезапуска можно проверить её повторно.');
 else if(!task)report('Ожидающих операций нет. Отправка начинается только по нажатию.');
}
async function run(action){
 if(busy||!controller)return;
 busy=true;render();
 try{await action()}catch(e){task=null;$('queueApproval').hidden=true;report('Операция остановлена: '+e.message,true)}
 finally{busy=false;render()}
}
function forget(){
 if(controller)controller.cancel();
 controller=null;task=null;$('queueApproval').hidden=true;$('queueConsent').checked=false;render();
}
function setClient(client){
 forget();
 if(!client||!client.isSignedIn()||!client.account())throw Error('Verified account required');
 controller=root.CourseAccountOutboxController.create({
  storage:root.localStorage,client,accountId:client.account(),
  locks:root.navigator&&root.navigator.locks,randomUUID:()=>root.crypto.randomUUID()
 });
 render();
}
$('queueConsent').addEventListener('change',render);
$('queueCancel').addEventListener('click',()=>{
 if(controller)controller.cancel();task=null;$('queueApproval').hidden=true;
 $('queueConsent').checked=false;report('Подготовка отменена.');render();
});
$('queueInspect').addEventListener('click',()=>run(async()=>{
 task=null;$('queueApproval').hidden=true;$('queueConsent').checked=false;
 const p=await controller.inspect();
 if(p.status==='pending'){report('Есть несохранённая на сервере операция, сначала обработай её.',true);return}
 if(p.status!=='ready'){report('Конфликтов: '+p.conflicts.length+'. Очередь не создана.',true);return}
 task=p.ticket;
 $('queueProposal').textContent='Разделов: '+p.sectionCount+'; ревизия облака: '+p.revision+'. Данные будут сохранены только на этом устройстве.';
 $('queueApproval').hidden=false;
 report('Проверь резервные копии и подтверди постановку в очередь.');
}));
$('queueApprove').addEventListener('click',()=>run(async()=>{
 const ticket=task,consent=$('queueConsent').checked;
 task=null;$('queueApproval').hidden=true;$('queueConsent').checked=false;
 const result=await controller.approve(ticket,consent);
 report('Операция '+result.id+' сохранена локально. Отправки на сервер не было.');
}));
$('queueRetry').addEventListener('click',()=>run(async()=>{
 const result=await controller.retry();
 if(result.status==='synced')report('Облако проверено, операция подтверждена. Ревизия: '+result.revision+'.');
 else if(result.status==='conflict')report('Обнаружен конфликт. Копия сохранена в очереди; автоматическое объединение запрещено.',true);
 else if(result.status==='retry')report('Нет подтверждения от сервера ('+result.reason+'). Операция сохранена, повтор возможен позже.',true);
 else report('Результат проверки: '+result.status+'. Данные очереди сохранены.');
}));
$('queueExport').addEventListener('click',()=>{
 try{
  const item=pending();if(!item)throw Error('Нет ожидающей операции');
  const file=new Blob([JSON.stringify({format:'ai-course-pending-manual-export-v1',pending:item},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(file);
  const a=root.document.createElement('a');a.href=url;a.download='ai-course-pending-progress.json';a.click();
  root.setTimeout(()=>URL.revokeObjectURL(url),1000);
  report('Сохранена копия ожидающей операции. Она содержит твои учебные ответы.');
 }catch(e){report('Экспорт не выполнен: '+e.message,true)}
});
render();
root.CourseAccountQueuePage=Object.freeze({setClient,forget,hasPending:()=>!!pending(),readyForDirectSave});
})(typeof window!=='undefined'?window:globalThis);
