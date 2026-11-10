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
 await page.goto(base+'/account.html');
 await page.evaluate(()=>localStorage.setItem('ai-no-headache-v1',JSON.stringify({deepNotes:{work:'local version'}})));
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
