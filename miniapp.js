(async function(){'use strict';
 const status=document.getElementById('status'),frame=document.getElementById('course');let engine,client,timer;
 const local=()=>CourseAccountPreview.local(localStorage).sections;
 function write(sections,before){
  // Restore only before mounting lessons. During editing remote changes wait for reopening.
  if(!frame.hidden&&JSON.stringify(sections)!==JSON.stringify(before))throw Error('Облако изменилось на другом устройстве. Закрой и открой курс для переноса.');
  const backup={};for(const k of CourseSyncModel.KEYS)backup[k]=localStorage.getItem(k);
  const changes=[];
  if(Object.keys(before).some(k=>!Object.hasOwn(sections,k)))throw Error('Удаление разделов требует ручного сравнения.');
  if(JSON.stringify(sections)===JSON.stringify(before))return;
  localStorage.setItem('ai-course-auto-backup:'+crypto.randomUUID(),JSON.stringify(backup));
  try{for(const [key,value] of Object.entries(sections)){
   const raw=JSON.stringify(value);if(raw===backup[key])continue;
   CourseStorage.write(localStorage,key,raw,{expected:backup[key],reason:'automatic-cloud-restore'});
   changes.push({key,before:backup[key],after:raw});
  }}catch(e){CourseStorage.rollbackBatch(localStorage,changes);throw e}
 }
 async function sync(){try{
  const result=await engine.tick();
  if(result.status==='saved')status.textContent='Сохранено в облаке · '+new Date().toLocaleTimeString();
  else if(result.status==='conflicts')status.textContent='Разные правки одного ответа. Обе копии сохранены; требуется сравнение.';
  return result.status==='saved';
 }catch(e){status.textContent=navigator.onLine?e.message:'Нет сети. Ответы сохранены на устройстве; отправим после подключения.';return false}}
 function mount(){if(!frame.hidden)return;frame.src='./index.html';frame.hidden=false;timer=setInterval(sync,3000)}
 async function start(){try{
  if(engine){if(await sync())mount();return}
  const data=window.Telegram?.WebApp?.initData;
  if(!data)throw Error('Открой курс кнопкой внутри Telegram-бота.');
  client=CourseCloudAccount.create({baseURL:CourseCloudConfig.apiBaseURL,fetchImpl:fetch.bind(window),initData:data});
  await client.login();
  const owner=localStorage.getItem('ai-course-auto-owner');
  if(owner&&owner!==client.account())throw Error('На устройстве есть прогресс другого аккаунта. Сначала экспортируй его и выполни ручное сравнение.');
  localStorage.setItem('ai-course-auto-owner',client.account());
  const key='ai-course-auto-base:'+client.account();
  engine=CourseAutoSync.create({client,readLocal:local,writeLocal:write,loadBase:()=>JSON.parse(localStorage.getItem(key)||'null'),saveBase:x=>localStorage.setItem(key,JSON.stringify(x)),uuid:()=>crypto.randomUUID()});
  window.CourseMiniAppAccount=()=>client?.isSignedIn()?CourseCloudAccount.borrow(client):null;
  if(await sync())mount();
 }catch(e){status.textContent=e.message+' Закрой и заново открой Mini App.'}}
 document.getElementById('retry').onclick=start;window.addEventListener('online',()=>engine&&sync());
 window.addEventListener('pagehide',()=>{clearInterval(timer);engine?.stop();client?.clear()});await start();
})();
