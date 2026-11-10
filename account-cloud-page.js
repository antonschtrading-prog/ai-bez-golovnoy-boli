/* Account page: explicit cloud reads only; no automatic sync or storage. */
(function(root){'use strict';
 const $=id=>root.document.getElementById(id);
 const status=(message,error=false)=>{$('cloudStatus').textContent=message;$('cloudStatus').className='status'+(error?' danger':'')};
 const baseURL=root.CourseCloudConfig&&root.CourseCloudConfig.apiBaseURL;
 let client=null,busy=false,enabled=false,writer=null,proposalId=null,browserNonce=null,browserExpires=0;
 const browserClientId=root.CourseCloudConfig&&root.CourseCloudConfig.telegramClientId;
 const writeStatus=(message,error=false)=>{$('cloudWriteStatus').textContent=message;$('cloudWriteStatus').className='status'+(error?' danger':'')};
 function clearBrowserAttempt(){browserNonce=null;browserExpires=0}
 function discardProposal(){if(writer)writer.cancel();proposalId=null;$('cloudApproval').hidden=true;$('cloudConfirmed').checked=false;$('cloudCommit').disabled=true;}
 function controls(){
  $('cloudLogin').disabled=busy||!enabled||(client&&client.isSignedIn());
  $('browserPrepare').disabled=busy||!enabled||!Number.isSafeInteger(browserClientId)||browserClientId<=0||(client&&client.isSignedIn());
  $('browserAuthorize').disabled=busy||!browserNonce||Date.now()>=browserExpires||(client&&client.isSignedIn());
  $('browserAuthorize').hidden=!browserNonce;
  $('cloudRead').disabled=busy||!client||!client.isSignedIn();
  $('cloudLogout').disabled=busy||!client||!client.isSignedIn();
  $('cloudPrepare').disabled=busy||!client||!client.isSignedIn();
  $('cloudCommit').disabled=busy||!client||!client.isSignedIn()||!proposalId||!$('cloudConfirmed').checked;
  $('accountState').textContent=client&&client.isSignedIn()?'Telegram: вход выполнен':'Не выполнен';
  $('syncState').textContent='Автоматическая синхронизация выключена';
 }
 async function run(action){
  if(busy||!enabled)return;
  busy=true;controls();
  try{await action()}catch(error){
   if(proposalId)discardProposal();
   const message='Операция не выполнена: '+(error&&error.message?error.message:'неизвестная ошибка');
   status(message,true);writeStatus(message+' Повторное сравнение обязательно.',true);
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
   discardProposal();clearBrowserAttempt();
   await client.login();
   writer=root.CourseSyncCommit.create({storage:root.localStorage,client,uuid:()=>root.crypto.randomUUID()});
   status('Вход выполнен. Нажми «Получить облачную копию» для чтения данных.');
  }));
  $('cloudRead').addEventListener('click',()=>run(async()=>{
   discardProposal();
   const data=await client.read();
   root.CourseAccountPreviewPage.loadRemoteSnapshot(data);
   status('Облачная копия проверена. Для сравнения нажми «Сравнить две копии» ниже.');
  }));
  $('cloudLogout').addEventListener('click',()=>run(async()=>{
   discardProposal();clearBrowserAttempt();
   try{await client.logout();status('Выход выполнен. Локальный прогресс не изменён.')}
   finally{root.CourseAccountPreviewPage.reset()}
  }));
  async function loadBrowserLoginSdk(){
   if(root.Telegram&&root.Telegram.Login&&typeof root.Telegram.Login.auth==='function')return;
   await new Promise((resolve,reject)=>{
    const script=root.document.createElement('script');
    script.src='https://telegram.org/js/telegram-login.js';
    script.onload=resolve;script.onerror=()=>reject(Error('Telegram Login SDK недоступен'));
    root.document.head.append(script);
   });
   if(!root.Telegram||!root.Telegram.Login||typeof root.Telegram.Login.auth!=='function')throw Error('Telegram Login SDK не инициализирован');
  }
  $('browserPrepare').addEventListener('click',()=>run(async()=>{
   discardProposal();clearBrowserAttempt();
   if(!Number.isSafeInteger(browserClientId)||browserClientId<=0)throw Error('Telegram client ID не настроен');
   await loadBrowserLoginSdk();
   client=root.CourseCloudAccount.create({baseURL,fetchImpl:root.fetch.bind(root),initData:''});
   const challenge=await client.browserChallenge();
   browserNonce=challenge.nonce;browserExpires=challenge.expires;
   status('Запрос подготовлен. Нажми «Подтвердить вход через Telegram» до истечения срока.');
  }));
  $('browserAuthorize').addEventListener('click',()=>run(async()=>{
   if(!browserNonce||browserExpires<=Date.now())throw Error('Срок входа истёк. Подготовь новый запрос');
   const nonce=browserNonce;
   clearBrowserAttempt();
   // The popup is opened immediately inside the user click, not after a network await.
   const idToken=await new Promise((resolve,reject)=>{
    let settled=false;
    const timeout=root.setTimeout(()=>finish(Error('Telegram не ответил. Подготовь вход заново.')),120000);
    function finish(error,value){
     if(settled)return;
     settled=true;root.clearTimeout(timeout);
     if(error)reject(error);else resolve(value);
    }
    try{
     root.Telegram.Login.auth({client_id:browserClientId,scope:['profile'],nonce},data=>{
      if(!data||typeof data.id_token!=='string')return finish(Error(data&&data.error||'Вход отменён'));
      finish(null,data.id_token);
     });
    }catch(e){finish(e)}
   });
   await client.browserComplete(idToken,nonce);
   writer=root.CourseSyncCommit.create({storage:root.localStorage,client,uuid:()=>root.crypto.randomUUID()});
   status('Вход через браузер выполнен. Теперь можно прочитать облачную копию.');
  }));
  $('cloudConfirmed').addEventListener('change',controls);
  $('cloudCancel').addEventListener('click',()=>{discardProposal();writeStatus('Подготовка отправки отменена. Данные не отправлены.');controls()});
  $('cloudPrepare').addEventListener('click',()=>run(async()=>{
   discardProposal();
   if(!writer)throw Error('Войди в Telegram заново');
   const result=await writer.inspect();
   if(result.status!=='ready'){
    writeStatus('Конфликтов: '+result.conflicts.length+'. Отправка заблокирована; сохрани и сравни обе копии.',true);
    return;
   }
   proposalId=result.id;
   $('cloudProposalDetails').textContent='К отправке подготовлено разделов: '+result.sectionCount+
    '. Текущая ревизия облака: '+result.revision+
    '. Это только подготовка, записи ещё не было.';
   $('cloudApproval').hidden=false;
   writeStatus('Подготовлено. Прежде чем подтверждать, проверь резервную копию.');
  }));
  $('cloudCommit').addEventListener('click',()=>run(async()=>{
   const id=proposalId;
   if(!id||!$('cloudConfirmed').checked)throw Error('Не подтверждена текущая версия');
   // Confirmations are one-use, including network failure or an uncertain server response.
   proposalId=null;$('cloudApproval').hidden=true;$('cloudConfirmed').checked=false;
   const result=await writer.commit(id,true);
   if(result.status!=='saved'){
    writeStatus('Серверная копия изменилась. Требуется новое сравнение.',true);
    return;
   }
   root.CourseAccountPreviewPage.reset();
   writeStatus('Облачная копия сохранена, ревизия '+result.revision+'. Локальный прогресс не изменён.');
  }));
  root.addEventListener('pagehide',()=>{discardProposal();clearBrowserAttempt();if(client)client.clear()},{once:true});
  controls();
 }catch(error){status('Облачный вход недоступен: '+error.message,true);controls()}
})(typeof window!=='undefined'?window:globalThis);
