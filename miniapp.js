(async function(){'use strict';
 const status=document.getElementById('status'),frame=document.getElementById('course'),retry=document.getElementById('retry');
 let engine,client,timer,starting=false;
 const local=()=>CourseAccountPreview.local(localStorage).sections;
 const TIMEOUT_MS=12000;
 function fetchBounded(url,options={}){
  // A stalled mobile WebView must not leave the course on its loading screen indefinitely.
  const controller=new AbortController();
  let timeout;
  const timeoutError=Error('Превышено время ответа сервера. Проверь интернет и нажми «Повторить».');
  const timeoutPromise=new Promise((_,reject)=>{
   timeout=setTimeout(()=>{controller.abort();reject(timeoutError)},TIMEOUT_MS);
  });
  return Promise.race([fetch(url,{...options,signal:controller.signal}),timeoutPromise])
   .finally(()=>clearTimeout(timeout));
 }
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
 async function sync(){
  try{
   const result=await engine.tick();
   if(result.status==='saved')status.textContent='Сохранено в облаке · '+new Date().toLocaleTimeString();
   else if(result.status==='conflicts')status.textContent='Конфликт ответов. Обе версии сохранены. Требуется ручное сравнение.';
   else if(!frame.hidden&&result.status==='changed')status.textContent='Есть новые изменения. Повторяем синхронизацию…';
   else if(frame.hidden&&['changed','retry','busy'].includes(result.status))status.textContent='Проверяем новые данные. Повторяем подключение…';
   return result.status==='saved';
  }catch(e){
   status.textContent=navigator.onLine?'Не удалось подключиться: '+(e?.message||'ошибка сети'):'Нет сети. Ответы на устройстве сохранены.';
   return false;
  }
 }
 function mount(){if(!frame.hidden)return;frame.src='./index.html?v=20261117-session2';frame.hidden=false}
 function startPolling(){
  // Previously polling only started AFTER mount; any transient initial result left a blank screen forever.
  if(timer)return;
  timer=setInterval(async()=>{if(!engine)return;const saved=await sync();if(saved)mount()},3000);
 }
 async function start(){
  if(starting)return;
  starting=true;retry.disabled=true;
  try{
   status.textContent=engine?'Повторяем синхронизацию…':'Подключаем аккаунт…';
   if(engine){if(await sync())mount();return}
   const data=window.Telegram?.WebApp?.initData;
   if(!data)throw Error('Открой курс кнопкой внутри Telegram-бота.');
   client=CourseCloudAccount.create({baseURL:CourseCloudConfig.apiBaseURL,fetchImpl:fetchBounded,initData:data});
   await client.login();
   const owner=localStorage.getItem('ai-course-auto-owner');
   if(owner&&owner!==client.account())throw Error('На устройстве есть прогресс другого аккаунта. Сначала экспортируй его и выполни ручное сравнение.');
   localStorage.setItem('ai-course-auto-owner',client.account());
   const key='ai-course-auto-base:'+client.account();
   engine=CourseAutoSync.create({client,readLocal:local,writeLocal:write,loadBase:()=>JSON.parse(localStorage.getItem(key)||'null'),saveBase:x=>localStorage.setItem(key,JSON.stringify(x)),uuid:()=>crypto.randomUUID()});
   window.CourseMiniAppAccount=()=>client?.isSignedIn()?CourseCloudAccount.borrow(client):null;
   startPolling();
   if(await sync())mount();
  }catch(e){
   status.textContent='Ошибка подключения: '+(e?.message||'неизвестная ошибка')+' Нажми «Повторить».';
  }finally{starting=false;retry.disabled=false}
 }
 retry.onclick=start;
 window.addEventListener('online',()=>start());
 window.addEventListener('pagehide',()=>{clearInterval(timer);engine?.stop();client?.clear()});
 await start();
})();
