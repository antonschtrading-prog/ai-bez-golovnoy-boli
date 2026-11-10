/* Local-only account preview UI. All file contents are untrusted data.
 * Never writes progress or makes network requests.
 */
(function(root){'use strict';
const $=id=>root.document.getElementById(id);
const MAX=root.CourseAccountPreview.MAX;
let candidate=null,result=null;
function status(message,isError=false){$('previewStatus').textContent=message;$('previewStatus').className='status'+(isError?' danger':'')}
function reset(){
 candidate=null;result=null;$('cloudFile').value='';$('inspect').disabled=true;
 $('comparison').hidden=true;$('conflictArea').hidden=true;$('safeArea').hidden=true;
 $('conflicts').replaceChildren();$('technical').textContent='';
 status('Сначала выбери файл для просмотра.');
}
function updateLocal(){
 try{$('localCount').textContent=String(Object.keys(root.CourseAccountPreview.local(root.localStorage).sections).length)}
 catch(e){$('localCount').textContent='Есть ошибки: '+e.message}
}
async function choose(){
 candidate=null;result=null;
 $('comparison').hidden=true;$('conflictArea').hidden=true;$('safeArea').hidden=true;
 $('inspect').disabled=true;
 const file=$('cloudFile').files?.[0];
 if(!file){status('Файл не выбран');return}
 if(file.size>MAX){status('Файл превышает ограничение 1 МБ.',true);return}
 try{
  const raw=await file.text();
  if(raw.length>MAX)throw Error('Файл превышает ограничение 1 МБ');
  const parsed=JSON.parse(raw);
  candidate=root.CourseAccountPreview.remote(parsed);
  $('inspect').disabled=false;
  status('Файл прочитан и проверен. Нажми «Сравнить две копии».');
 }catch(e){status('Не удалось прочитать файл: '+e.message,true)}
}
function inspect(){
 if(!candidate){status('Нет проверенного файла',true);return}
 try{
  result=root.CourseAccountPreview.plan(root.localStorage,candidate);
  $('comparison').hidden=false;
  $('localMetric').textContent=String(result.localCount);
  $('cloudMetric').textContent=String(result.serverCount);
  $('revisionMetric').textContent=String(result.revision);
  $('conflictMetric').textContent=String(result.conflicts.length);
  $('conflictArea').hidden=result.conflicts.length===0;
  $('safeArea').hidden=result.status!=='ready';
  $('conflicts').replaceChildren();
  for(const item of result.conflicts){
   const li=root.document.createElement('li');
   li.textContent=(item.key||'Раздел')+(item.field?' · '+item.field:'')+': '+item.reason;
   $('conflicts').append(li);
  }
  $('technical').textContent=JSON.stringify({status:result.status,summary:result.summary,
   localMissing:result.localMissing},null,2);
  status(result.status==='ready'?'Совместимый предварительный план готов. Никаких данных не изменено.':'Найдены конфликты: автоматический перенос остановлен.');
 }catch(e){result=null;$('comparison').hidden=true;status('Сравнение остановлено: '+e.message,true)}
}
function download(){
 try{
  const text=root.CourseAccountPreview.exportPlan(result);
  const blob=new Blob([text],{type:'application/json'});
  const url=URL.createObjectURL(blob);const anchor=root.document.createElement('a');
  anchor.href=url;anchor.download='course-sync-preview.json';anchor.click();
  root.setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Предварительный снимок скачан. На сервер ничего не отправлено.');
 }catch(e){status('Экспорт не выполнен: '+e.message,true)}
}
$('cloudFile').addEventListener('change',choose);
$('inspect').addEventListener('click',inspect);
$('clear').addEventListener('click',reset);
$('export').addEventListener('click',download);
updateLocal();reset();
})(typeof window!=='undefined'?window:globalThis);
