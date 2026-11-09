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
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
