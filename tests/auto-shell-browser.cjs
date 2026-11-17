const {chromium}=require('playwright');const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const {expect}=require('playwright/test');
(async()=>{const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{const f=path.join(root,req.url.split('?')[0]);fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{'Content-Type':f.endsWith('.js')?'text/javascript':'text/html'});res.end(e?'missing':b)})});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true});
try{let cloud={revision:0,sections:{}},offline=false;async function device(){const context=await browser.newContext();
await context.route('https://telegram.org/**',r=>r.fulfill({contentType:'text/javascript',body:'window.Telegram={WebApp:{initData:"test-launch"}}'}));
await context.route('https://ai-course-progress.antonschtrading.workers.dev/**',async r=>{if(offline)return r.abort();const req=r.request();let body;
if(req.url().endsWith('/auth/telegram'))body={token:'x'.repeat(40),accountId:'tg_testaccount123'};
else if(req.method()==='PUT'){cloud={revision:cloud.revision+1,sections:req.postDataJSON().sections};body=cloud}else body=cloud;
await r.fulfill({contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*'}})});
return context;}
const context=await device();const page=await context.newPage();await page.goto(origin+'/miniapp.html');const lesson=page.frameLocator('#course');await lesson.getByRole('button',{name:'Отчёт о практике',exact:true}).click();await lesson.getByRole('textbox',{name:'1. Какую задачу ты поставил?',exact:true}).fill('Черновик для проверки облака');
await expect.poll(()=>cloud.sections['ai-no-headache-v1']?.report?.task,{timeout:15000}).toBe('Черновик для проверки облака');
offline=true;await lesson.getByRole('textbox',{name:'1. Какую задачу ты поставил?',exact:true}).fill('Ответ без сети');await page.waitForTimeout(3500);offline=false;await expect.poll(()=>cloud.sections['ai-no-headache-v1']?.report?.task,{timeout:15000}).toBe('Ответ без сети');
const second=await device();const secondPage=await second.newPage();await secondPage.goto(origin+'/miniapp.html');const restored=secondPage.frameLocator('#course');await restored.getByRole('button',{name:'Отчёт о практике',exact:true}).click();await expect(restored.getByRole('textbox',{name:'1. Какую задачу ты поставил?',exact:true})).toHaveValue('Ответ без сети');console.log('Automatic Mini App draft, offline retry and restore passed');
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);process.exitCode=1});
