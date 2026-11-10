const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),errors=[];
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'});res.end(e?'missing':data)})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let browser;try{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath()),headless:true,args:['--no-sandbox']});}catch(e){server.close();throw e}
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.html'))){await page.goto(base+'/'+name);await page.waitForLoadState('load');assert(await page.locator('body').innerText(),name);}
 // Spaced repetition: an early review may show the definition but cannot give credit.
 await page.goto(base+'/study-lab.html');
 await page.evaluate(()=>localStorage.clear());
 await page.reload();
 await page.locator('#reveal').click();
 await page.locator('#known').click();
 const firstTerm=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-course-study-lab-v1')).terms[0]);
 assert.equal(firstTerm.level,1);
 assert.equal(firstTerm.count,1);
 assert(firstTerm.next>Date.now(),'First successful term should be scheduled in the future');
 await page.evaluate(()=>{
  const value=JSON.parse(localStorage.getItem('ai-course-study-lab-v1'));
  for(let i=1;i<300;i++)value.terms[i]={level:1,count:1,next:Date.now()+14*86400000};
  localStorage.setItem('ai-course-study-lab-v1',JSON.stringify(value));
 });
 await page.reload();
 await page.locator('#reveal').click();
 assert.equal(await page.locator('#known').count(),0,'Early study must not offer repeated credit');
 assert.match(await page.locator('#app').innerText(),/досрочная отметка не повысит уровень/);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-course-study-lab-v1')).terms[0].count),1);
 await page.evaluate(()=>{
  const value=JSON.parse(localStorage.getItem('ai-course-study-lab-v1'));
  value.terms[0].next=Date.now()-1000;
  localStorage.setItem('ai-course-study-lab-v1',JSON.stringify(value));
 });
 await page.reload();
 await page.locator('#reveal').click();
 assert.equal(await page.locator('#known').count(),1,'Due term can be credited');
 await page.locator('#known').click();
 const secondTerm=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-course-study-lab-v1')).terms[0]);
 assert.equal(secondTerm.count,2);
 assert.equal(secondTerm.level,2);
 await page.evaluate(()=>localStorage.clear());
 // A corrected first-answer mistake stays visible as history, not as an unresolved error.
 await page.goto(base+'/assessment.html');
 await page.evaluate(()=>localStorage.clear());
 await page.reload();
 await page.locator('#nav [data-level="A1"]').click();
 await page.locator('[data-answer="0:0"]').click();
 let record=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-course-assessment-v1')).results.A1);
 assert.deepEqual(record.errors,[0]);
 assert.equal(record.firstAnswers['0'],0);
 await page.goto(base+'/adaptive-route.html');
 assert.match(await page.locator('#headline').innerText(),/Повтори контрольную работу A1/);
 await page.goto(base+'/review.html');
 assert.match(await page.locator('#stats').innerText(),/Незакрытые ошибки экзамена: A1/);
 await page.goto(base+'/assessment.html');
 await page.locator('[data-answer="0:1"]').click();
 record=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-course-assessment-v1')).results.A1);
 assert.deepEqual(record.errors,[]);
 assert.equal(record.firstAnswers['0'],0,'First incorrect choice must remain intact');
 await page.goto(base+'/review.html');
 assert.match(await page.locator('#stats').innerText(),/Незакрытые ошибки экзамена: нет/);
 assert.match(await page.locator('#stats').innerText(),/исправленные при повторной попытке: A1/);
 await page.goto(base+'/adaptive-route.html');
 assert.match(await page.locator('#recommendations').innerText(),/Закрепи исправленные ошибки A1/);
 assert.doesNotMatch(await page.locator('#recommendations').innerText(),/Повтори контрольную работу A1/);
 await page.evaluate(()=>localStorage.clear());
 // Adaptive recommendations must not forget an assessment just because work is blank.
 await page.goto(base+'/adaptive-route.html');
 await page.evaluate(()=>{
  localStorage.clear();
  localStorage.setItem('ai-course-assessment-v1',JSON.stringify({selected:'A1',results:{A1:{answers:{0:1},work:'',rubric:[],errors:[]}}}));
  localStorage.setItem('ai-course-deep-workshop-v1',JSON.stringify({progress:{0:{work:'Краткий черновик'}},selected:0}));
 });
 await page.reload();
 let recommendations=await page.locator('#recommendations').innerText();
 assert.match(recommendations,/Заверши контрольную работу A1/,'Partial A1 assessment must be recommended');
 assert.match(recommendations,/Продолжи начатую практику/,'Short deep practice draft must be recommended');
 assert.match(recommendations,/не означает автоматического зачёта/,'Long text must not imply a passed exercise');
 await page.evaluate(()=>{
  const a=JSON.parse(localStorage.getItem('ai-course-assessment-v1'));
  a.results.A1.errors=[0];localStorage.setItem('ai-course-assessment-v1',JSON.stringify(a));
 });
 await page.reload();
 recommendations=await page.locator('#recommendations').innerText();
 assert.match(recommendations,/Повтори контрольную работу A1/);
 assert.match(await page.locator('#headline').innerText(),/Повтори контрольную работу A1/);
 await page.evaluate(()=>localStorage.clear());
 await page.reload();
 assert.match(await page.locator('#recommendations').innerText(),/Проверь текущий уровень/);
 // Multi-section mobile navigation: selecting a topic must display its content.
 for(const scenario of [
  {file:'deep-practice.html',button:'#nav [data-go="1"]'},
  {file:'assessment.html',button:'#nav [data-level="A2"]'},
  {file:'review.html',button:'#list [data-go="1"]'},
  {file:'any-ai.html',button:'#nav [data-task="1"]'}
 ]){
  await page.goto(base+'/'+scenario.file);
  const before=await page.locator('#content').innerText();
  await page.locator(scenario.button).click();
  const after=await page.locator('#content').innerText();
  assert.notEqual(after,before,scenario.file+' should change the active lesson');
  const p=await page.evaluate(()=>{
   const e=document.querySelector('#content'),r=e.getBoundingClientRect();
   return {top:r.top,scrollY:window.scrollY,focused:document.activeElement===e};
  });
  assert(p.top>=-4&&p.top<190,scenario.file+' lesson is not visible on mobile: '+JSON.stringify(p));
  assert(p.focused,scenario.file+' selected lesson should receive focus');
 }
 // Keep partially completed work after changing topics and reloading.
 await page.goto(base+'/assessment.html');
 await page.locator('#nav [data-level="A1"]').click();
 await page.locator('#work').fill('Черновик ответа для оценки, не удалять');
 await page.locator('#nav [data-level="A2"]').click();
 await page.reload();
 await page.locator('#nav [data-level="A1"]').click();
 assert.equal(await page.locator('#work').inputValue(),'Черновик ответа для оценки, не удалять');
 await page.goto(base+'/review.html');
 await page.locator('#list [data-go="0"]').click();
 await page.locator('#work').fill('Черновик повторения');
 await page.locator('#list [data-go="1"]').click();
 await page.reload();
 await page.locator('#list [data-go="0"]').click();
 assert.equal(await page.locator('#work').inputValue(),'Черновик повторения');
 // Regression: hero button must visibly move to the lesson on a narrow mobile screen.
 await page.goto(base+'/index.html');
 // A previously saved overview must never make Continue reopen the overview.
 await page.evaluate(()=>localStorage.setItem('ai-no-headache-v1',JSON.stringify({completed:[],answers:{},report:{task:'',result:'',verification:'',reflection:''},lastView:'home'})));
 await page.reload();
 await page.locator('#continueBtn').click();
 await page.waitForTimeout(80);
 assert.match(await page.locator('#main').innerText(),/A1 · Урок 1/);
 const continueViewport=await page.evaluate(()=>{
  const r=document.querySelector('#main').getBoundingClientRect();
  return{top:r.top,bottom:r.bottom,scrollY:window.scrollY};
 });
 assert(continueViewport.top>=-3&&continueViewport.top<180,'Continue must scroll lesson into mobile viewport: '+JSON.stringify(continueViewport));
 assert(continueViewport.scrollY>100,'Continue should not leave mobile page at top');
 // Full beginner workflow: every next-step button must reveal the updated panel.
 await page.locator('#continueBtn').click();
 await page.locator('[data-next="quiz"]').click();
 assert.match(await page.locator('#main').innerText(),/Три ситуации из практики/);
 // A wrong or missing answer cannot unlock the practical assignment.
 assert.equal(await page.locator('[data-next="practice"]').isDisabled(),true);
 await page.locator('[data-answer="0:0"]').click();
 assert.equal(await page.locator('[data-next="practice"]').isDisabled(),true);
 let position=await page.locator('#main').evaluate(el=>el.getBoundingClientRect().top);
 assert(position>=-4&&position<180,'Quiz not visible on iPhone: '+position);
 for(const [question,answer] of [[0,1],[1,1],[2,1]]){
  await page.locator('[data-answer="'+question+':'+answer+'"]').click();
 }
 assert.equal(await page.locator('[data-next="practice"]').isEnabled(),true);
 await page.locator('[data-next="practice"]').click();
 assert.match(await page.locator('#main').innerText(),/Поставь задачу в незнакомой области/);
 position=await page.locator('#main').evaluate(el=>el.getBoundingClientRect().top);
 assert(position>=-4&&position<180,'Practice not visible on iPhone: '+position);
 await page.locator('[data-next="report"]').click();
 assert.match(await page.locator('#main').innerText(),/Что получилось на самом деле/);
 position=await page.locator('#main').evaluate(el=>el.getBoundingClientRect().top);
 assert(position>=-4&&position<180,'Report not visible on iPhone: '+position);
 await page.locator('[data-field="task"]').fill('Задача для сохранения черновика и дальнейшего возобновления');
 await page.reload();
 await page.locator('#continueBtn').click();
 assert.match(await page.locator('#main').innerText(),/Что получилось на самом деле/);
 assert.match(await page.locator('[data-field="task"]').inputValue(),/Задача для сохранения черновика/);
 assert.match(await page.locator('#pct').innerText(),/^0\/\d+$/);
 assert.match(await page.locator('aside.panel').innerText(),/Завершено занятий/);
 await page.locator('#evaluate').click();
 assert.equal(await page.locator('#markDone').count(),0,'Incomplete report cannot be completed');
 for(const field of ['result','verification','reflection'])
  await page.locator('[data-field="'+field+'"]').fill('Подробное обоснование и проверка работы для проверки заполнения');
 await page.locator('#evaluate').click();
 assert.equal(await page.locator('#markDone').count(),1,'Complete report should offer manual completion');
 await page.locator('#markDone').click();
 assert.match(await page.locator('#pct').innerText(),/^1\/\d+$/);
 // A1 completion increments the shared lesson counter; never display 100% of the course.
 assert.match(await page.locator('aside.panel').innerText(),/Завершено занятий/);
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-no-headache-v1')).completed)).includes('a1-1'),true);
 await page.reload();
 assert.match(await page.locator('#pct').innerText(),/^1\/\d+$/);
 await page.locator('#catalogBtn').click();
 assert.match(await page.locator('#main').innerText(),/Программа|A1/);
 const catalogTop=await page.evaluate(()=>document.querySelector('#main').getBoundingClientRect().top);
 assert(catalogTop>=-3&&catalogTop<180,'Catalog must be visible: '+catalogTop);
 await page.goto(base+'/account.html');
 await page.evaluate(()=>{localStorage.clear();localStorage.setItem('ai-no-headache-v1',JSON.stringify({deepNotes:{work:'local version'}}))});
 await page.reload();
 assert.match(await page.locator('#localCount').innerText(),/1/);
 const conflictFile=JSON.stringify({revision:2,sections:{'ai-no-headache-v1':{deepNotes:{work:'remote version'}}}});
 await page.locator('#cloudFile').setInputFiles({name:'remote.json',mimeType:'application/json',buffer:Buffer.from(conflictFile)});
 await page.locator('#inspect').click();
 assert.equal(await page.locator('#conflictMetric').innerText(),'1');
 assert(await page.locator('#conflictArea').isVisible());
 assert(!(await page.locator('#safeArea').isVisible()));
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-no-headache-v1')).deepNotes.work),'local version');
 await page.locator('#clear').click();
 assert(!(await page.locator('#comparison').isVisible()));
 const safeFile=JSON.stringify({revision:2,sections:{'ai-no-headache-v1':{deepNotes:{cloud:'remote item'}}}});
 await page.locator('#cloudFile').setInputFiles({name:'safe.json',mimeType:'application/json',buffer:Buffer.from(safeFile)});
 await page.locator('#inspect').click();
 assert(await page.locator('#safeArea').isVisible());
 const exportEvent=page.waitForEvent('download');await page.locator('#export').click();
 const safeDownload=await exportEvent;
 const safePlan=JSON.parse(fs.readFileSync(await safeDownload.path(),'utf8'));
 assert.equal(safePlan.sections['ai-no-headache-v1'].deepNotes.work,'local version');
 assert.equal(safePlan.sections['ai-no-headache-v1'].deepNotes.cloud,'remote item');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-no-headache-v1')).deepNotes.work),'local version');
 // A second tab may update the course after comparison and before export.
 // The stale preview must be rejected instead of silently omitting new work.
 await page.evaluate(()=>{
  const data=JSON.parse(localStorage.getItem('ai-no-headache-v1'));
  data.deepNotes.savedLater='новая работа во второй вкладке';
  localStorage.setItem('ai-no-headache-v1',JSON.stringify(data));
 });
 await page.locator('#export').click();
 assert.match(await page.locator('#previewStatus').innerText(),/прогресс изменился после сравнения/);
 assert.equal(await page.locator('#comparison').isVisible(),false,'Stale preview must close');
 assert.equal(await page.locator('#safeArea').isVisible(),false,'Stale export action must be blocked');
 await page.locator('#inspect').click();
 assert.equal(await page.locator('#safeArea').isVisible(),true);
 const refreshedDownloadEvent=page.waitForEvent('download');await page.locator('#export').click();
 const refreshedPlan=JSON.parse(fs.readFileSync(await (await refreshedDownloadEvent).path(),'utf8'));
 assert.equal(refreshedPlan.sections['ai-no-headache-v1'].deepNotes.savedLater,'новая работа во второй вкладке');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-no-headache-v1')).deepNotes.savedLater),'новая работа во второй вкладке');
 await page.addScriptTag({url:base+'/progress-sync-model.js'});
 await page.addScriptTag({url:base+'/progress-indexeddb.js'});
 const indexedResult=await page.evaluate(async()=>{
  const a=await CourseIndexedStore.open({dbName:'course-test-atomic-v1'});
  const b=await CourseIndexedStore.open({dbName:'course-test-atomic-v1'});
  const section='ai-no-headache-v1',draft={deepNotes:{x:'offline'}};
  const results=await Promise.all([a.update('account-A',section,0,draft),b.update('account-A',section,0,draft)]);
  const current=await a.get('account-A',section);
  const other=await b.get('account-B',section);
  const stale=await b.update('account-A',section,0,draft);
  let invalid=false;
  try{await a.update('account-A',section,1,{deepNotes:[]})}catch(_){invalid=true}
  a.close();b.close();
  return{success:results.filter(x=>x?.revision===1).length,
   conflict:results.filter(x=>x?.conflict).length,
   revision:current.revision,isolated:other.revision===0,
   stale:stale.conflict===true,invalid};
 });
 assert.deepEqual(indexedResult,{success:1,conflict:1,revision:1,isolated:true,stale:true,invalid:true});
 // Actual separate tabs, same browser origin and IndexedDB database.
 const crossPage=await context.newPage();
 await crossPage.goto(base+'/deep-practice.html');
 await crossPage.addScriptTag({url:base+'/progress-indexeddb.js'});
 const crossTask=async source=>source.evaluate(async()=>{
  const db=await CourseIndexedStore.open({dbName:'course-test-cross-tab-v1'});
  const r=await db.update('account-C','ai-no-headache-v1',0,{completed:['done']});
  db.close();return r;
 });
 const crossResults=await Promise.all([crossTask(page),crossTask(crossPage)]);
 assert.equal(crossResults.filter(x=>x?.revision===1).length,1);
 assert.equal(crossResults.filter(x=>x?.conflict===true).length,1);
 await crossPage.close();

 await page.goto(base+'/deep-practice.html');await page.locator('#work').fill('Версия первая');await page.locator('#work').fill('Версия вторая');await page.reload();assert.equal(await page.locator('#work').inputValue(),'Версия вторая');
 const second=await context.newPage();await second.goto(base+'/deep-practice.html');await page.locator('#work').fill('Из первой вкладки');await second.locator('#work').fill('Конфликт второй вкладки');
 assert(await second.evaluate(()=>CourseStorage.list(localStorage).some(v=>v.raw.includes('Конфликт второй вкладки'))));
 assert(!(await second.evaluate(()=>localStorage.getItem('ai-course-deep-workshop-v1'))).includes('Конфликт второй вкладки'));
 await second.close();await page.goto(base+'/recovery.html');
 const id=await page.evaluate(()=>CourseStorage.list(localStorage).find(v=>v.raw.includes('Версия первая')).id);
 await page.locator('#versions').selectOption(id);page.on('dialog',d=>d.accept());await page.locator('#restore').click();assert.match(await page.locator('#status').innerText(),/восстановлена/);
 const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading;const downloaded=await download.path();assert(JSON.parse(fs.readFileSync(downloaded,'utf8')).versions.length>0);
 await page.locator('#migrate').click();assert.match(await page.locator('#status').innerText(),/подготовлена/);
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/recovery-mobile.png'),fullPage:true});
 await page.goto(base+'/deep-practice.html');assert.equal(await page.locator('#work').inputValue(),'Версия первая');
 // Close the page and reopen within the same persistent browser storage context.
 await page.close();const reopened=await context.newPage();await reopened.goto(base+'/deep-practice.html');assert.equal(await reopened.locator('#work').inputValue(),'Версия первая');
 assert.deepEqual(errors,[]);console.log('PASS: all pages load; mobile editing/reload; two-tab conflict; UI restore; history download; migration; page reopen; no page errors');
 await context.close();
 const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'course-browser-'));
 const launchOptions={executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath()),headless:true,args:['--no-sandbox']};
 let persistent;
 try{
  persistent=await chromium.launchPersistentContext(profile,launchOptions);
  let p=await persistent.newPage();await p.goto(base+'/deep-practice.html');await p.locator('#work').fill('После полного перезапуска');await persistent.close();persistent=null;
  persistent=await chromium.launchPersistentContext(profile,launchOptions);
  p=await persistent.newPage();await p.goto(base+'/deep-practice.html');assert.equal(await p.locator('#work').inputValue(),'После полного перезапуска');
  console.log('PASS: progress survives full Chromium shutdown and restart with persistent profile');
 }finally{if(persistent)await persistent.close();fs.rmSync(profile,{recursive:true,force:true})}

 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
