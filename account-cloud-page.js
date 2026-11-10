/* Account page: explicit cloud reads only; no automatic sync or storage. */
(function(root){'use strict';
 const $=id=>root.document.getElementById(id);
 const status=(message,error=false)=>{$('cloudStatus').textContent=message;$('cloudStatus').className='status'+(error?' danger':'')};
 let client=null,busy=false;
 function controls(){
  $('cloudLogin').disabled=busy||!client||client.isSignedIn();
  $('cloudRead').disabled=busy||!client||!client.isSignedIn();
  $('cloudLogout').disabled=busy||!client||!client.isSignedIn();
  $('accountState').textContent=client&&client.isSignedIn()?'Telegram: вход выполнен':'Не выполнен';
  $('syncState').textContent='Автоматическая синхронизация выключена';
 }
 async function run(action){
  if(busy||!client)return;
  busy=true;controls();
  try{await action()}catch(error){
   status('Операция не выполнена: '+(error&&error.message?error.message:'неизвестная ошибка'),true);
  }finally{busy=false;controls()}
 }
 try{
  const url=root.CourseCloudConfig&&root.CourseCloudConfig.apiBaseURL;
  const initData=root.Telegram&&root.Telegram.WebApp&&root.Telegram.WebApp.initData;
  if(!url){status('Адрес облачного API не настроен. Локальное сравнение JSON доступно.');controls();return}
  // Do not send Telegram credentials to an arbitrary URL entered by a user.
  client=root.CourseCloudAccount.create({baseURL:url,fetchImpl:root.fetch.bind(root),initData});
  if(!initData)status('Для входа открой эту страницу через Telegram Mini App. Локальные данные доступны.');
  else status('Можно войти через Telegram. Никакие учебные данные при входе не отправляются.');
  $('cloudLogin').addEventListener('click',()=>run(async()=>{
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
  root.addEventListener('pagehide',()=>client.clear(),{once:true});
  controls();
 }catch(error){status('Облачный вход недоступен: '+error.message,true);controls()}
})(typeof window!=='undefined'?window:globalThis);
