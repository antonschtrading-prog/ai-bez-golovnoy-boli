/* Manual export of cloud-restore backups. No network and no mutation. */
(function(root){'use strict';
const $=id=>root.document.getElementById(id);
let backups=null,items=[];
const status=(message,error=false)=>{$('backupStatus').textContent=message;$('backupStatus').className='status'+(error?' danger':'')};
function reset(){
 backups=null;items=[];$('backupRefresh').disabled=true;
 $('backupSelect').disabled=true;$('backupSelect').replaceChildren();
 $('backupDownload').disabled=true;
 status('Войди в Telegram для просмотра своих копий.');
}
function refresh(){
 if(!backups)throw Error('Verified account required');
 items=backups.list();
 $('backupSelect').replaceChildren();
 for(const entry of items){
  const option=root.document.createElement('option');option.value=entry.key;
  option.textContent=entry.createdAt+' · ревизия '+entry.revision+' · разделов '+entry.sections;
  $('backupSelect').append(option);
 }
 $('backupSelect').disabled=items.length===0;$('backupDownload').disabled=items.length===0;
 status(items.length?'Найдено резервных копий: '+items.length+'. Можно скачать выбранную.':'Резервных копий пока нет.');
}
function setClient(client){
 reset();
 if(!client||!client.isSignedIn()||!client.account())throw Error('Verified account required');
 backups=root.CourseCloudBackups.create({storage:root.localStorage,accountId:client.account()});
 $('backupRefresh').disabled=false;refresh();
}
$('backupRefresh').addEventListener('click',()=>{
 try{refresh()}catch(e){status('Не удалось проверить копии: '+e.message,true);$('backupDownload').disabled=true}
});
$('backupDownload').addEventListener('click',()=>{
 try{
  if(!backups)throw Error('Account required');
  const key=$('backupSelect').value;
  if(!items.some(entry=>entry.key===key))throw Error('Select a verified backup');
  const raw=backups.exportBackup(key);
  const blob=new Blob([raw],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=root.document.createElement('a');a.href=url;
  a.download='course-cloud-restore-backup.json';a.click();
  root.setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Резервная копия скачана. Храни её отдельно от браузера.');
 }catch(e){status('Экспорт невозможен: '+e.message,true)}
});
reset();
root.CourseAccountBackupsPage=Object.freeze({setClient,reset,refresh});
})(typeof window!=='undefined'?window:globalThis);
