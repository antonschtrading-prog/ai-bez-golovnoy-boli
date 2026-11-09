'use strict';
const $=id=>document.getElementById(id);
let versions=[],expected=null;
function run(fn){try{fn()}catch(e){$('status').textContent=e.message}}
function preview(){const v=versions.find(v=>v.id===$('versions').value);$('preview').textContent=v?JSON.stringify(JSON.parse(v.raw),null,2):'Сохранённых версий пока нет';expected=v?localStorage.getItem(v.section):null;$('restore').disabled=!v}
function refresh(){versions=CourseStorage.list(localStorage).reverse();$('versions').replaceChildren();for(const v of versions){const o=document.createElement('option');o.value=v.id;o.textContent=v.at+' · '+v.section+' · '+v.reason;$('versions').append(o)}preview()}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('refresh').onclick=()=>run(refresh);$('versions').onchange=()=>run(preview);
$('restore').onclick=()=>run(()=>{if(!confirm('Заменить весь раздел выбранной версией? Текущий вариант останется в истории.'))return;CourseStorage.restore(localStorage,$('versions').value,expected);refresh();$('status').textContent='Версия восстановлена. Заново открой страницу занятия.'});
$('export').onclick=()=>run(()=>download({format:'ai-course-history-export-v1',versions:CourseStorage.list(localStorage)},'course-history.json'));
$('migrate').onclick=()=>run(()=>{const snapshot=CourseProgressCore.collect(localStorage);if(snapshot.errors.length)throw Error('Есть повреждённые разделы; миграция отменена');CourseMigrations.stage(localStorage,snapshot,'local-migration');$('status').textContent='Отдельная копия v2 подготовлена. Исходный прогресс сохранён.'});
$('exportMigration').onclick=()=>run(()=>{const raw=localStorage.getItem(CourseMigrations.KEY);if(!raw)throw Error('Сначала подготовь копию');download(JSON.parse(raw),'course-migration-v2.json')});
run(refresh);

$('migrationFile').onchange=async event=>{
 const file=event.target.files?.[0];if(!file)return;
 try{if(file.size>4000000)throw Error('Файл превышает 4 МБ');const source=JSON.parse(await file.text());CourseMigrations.stage(localStorage,source,'file-migration');$('status').textContent='Файл проверен и сохранён отдельной копией v2. Прогресс не заменён.'}catch(e){$('status').textContent=e.message}finally{event.target.value=''}
};
