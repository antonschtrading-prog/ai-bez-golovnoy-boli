/* Explicit, single-request model feedback through the existing Mini App memory session.
 * No automatic uploads of student drafts. Raw work is sent only on click.
 */
(function(root){'use strict';
 function available(){
  try{return root.parent!==root&&typeof root.parent.CourseMiniAppAccount==='function'&&!!root.parent.CourseMiniAppAccount()}
  catch(_){return false}
 }
 async function run(input){
  if(!available())throw Error('Проверка доступна после входа через Telegram Mini App.');
  const client=root.parent.CourseMiniAppAccount();
  if(!client||typeof client.review!=='function')throw Error('Проверка недоступна в текущей версии приложения.');
  await client.login();
  try{return await client.review(input)}
  finally{await client.logout()}
 }
 function errorText(error){
  const code=String(error?.message||'');
  const codes={
   review_not_configured:'Автоматическая проверка ещё не включена на сервере. Можно использовать внешний разбор.',
   review_limit_reached:'Слишком много запросов подряд. Попробуй позже.',
   review_daily_free_quota_exhausted:'Бесплатный лимит проверок на сегодня исчерпан. Завтра он восстановится автоматически. Уроки и облачный прогресс продолжают работать.',
   review_budget_unavailable:'Контроль бесплатной квоты недоступен. Проверка временно выключена для исключения расходов.',
   review_limiter_unavailable:'Ограничитель проверок временно недоступен. Повтори позже.',
   review_unavailable:'Не удалось получить достоверный разбор. Прогресс сохранён; попробуй позже.',
   invalid_review_input:'Работа или критерии не соответствуют ограничениям проверки.',
   unauthorized:'Сессия закончилась. Закрой и заново открой Mini App.',
   origin_required:'Нужен вход из разрешённого приложения Telegram.'
  };
  return codes[code]||code||'Ошибка подключения к серверу проверки';
 }
 root.CourseReviewClient=Object.freeze({available,run,errorText});
})(typeof window!=='undefined'?window:globalThis);
