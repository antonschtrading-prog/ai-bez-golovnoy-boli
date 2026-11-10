/* Account page: explicit cloud reads only; no automatic sync or storage. */
(function(root){'use strict';
 const $=id=>root.document.getElementById(id);
 const status=(message,error=false)=>{$('cloudStatus').textContent=message;$('cloudStatus').className='status'+(error?' danger':'')};
 const baseURL=root.CourseCloudConfig&&root.CourseCloudConfig.apiBaseURL;
 let client=null,busy=false,enabled=false;
 function controls(){
  $('cloudLogin').disabled=busy||!enabled||(client&&client.isSignedIn());
  $('cloudRead').disabled=busy||!client||!client.isSignedIn();
  $('cloudLogout').disabled=busy||!client||!client.isSignedIn();
  $('accountState').textContent=client&&client.isSignedIn()?'Telegram: вход выполнен':'Не выполнен';
  $('syncState').textContent='Автоматическая синхронизация выключена';
 }
 async function run(action){
  if(busy||!enabled)return;
  busy=true;controls();
  try{await action()}catch(error){
   status('Операция не выполнена: '+(error&&error.message?error.message:'неизвестная ошибка'),true);
  }finally{busy=false;controls()}
 }
 function telegramData(){
  return root.Telegram&&root.Telegram.WebApp&&root.Telegram.WebApp.initData||'';
 }
 async function loadTelegramSdk(){
  if(telegramData())return;
  // Only load the external SDK following explicit sign-in click.
  await new Promise((resolve,reject)=>{
   const script=root.document.createElement('script');
   script.src='https://telegram.org/js/telegram-web-app.js';
   script.onload=resolve;script.onerror=()=>reject(Error('Telegram SDK unavailable'));
   root.document.head.append(script);
  });
 }
 try{
  if(!baseURL){status('Адрес облачного API не настроен. Локальное сравнение JSON доступно.');controls();return}
  // Validate fixed, public deployment configuration before any external request.
  root.CourseCloudAccount.create({baseURL,fetchImpl:root.fetch.bind(root),initData:''});
  enabled=true;
  status('Для входа открой эту страницу внутри Telegram Mini App и нажми кнопку. Данные уроков не отправляются.');
  $('cloudLogin').addEventListener('click',()=>run(async()=>{
   await loadTelegramSdk();
   client=root.CourseCloudAccount.create({baseURL,fetchImpl:root.fetch.bind(root),initData:telegramData()});
   await client.login();
   status('Вход выполнен. Нажми «Получить облачную копию» для чтения данных.');
  }));
  $('cloudRead').addEventListener('click',()=>run(async()=>{
   const data=await client.read();
   root.CourseAccountPreviewPage.loadRemoteSnapshot(data);
   status('Облачная копия проверена. Для сравнения нажми «Сравнить две копии» ниже.');
  }));
  $('cloudLogout').addEventListener('click',()=>run(async()=>{
   try{await client.logout();status('Выход выполнен. Локальный прогресс не изменён.')}
   finally{root.CourseAccountPreviewPage.reset()}
  }));
  root.addEventListener('pagehide',()=>{if(client)client.clear()},{once:true});
  controls();
 }catch(error){status('Облачный вход недоступен: '+error.message,true);controls()}
})(typeof window!=='undefined'?window:globalThis);
