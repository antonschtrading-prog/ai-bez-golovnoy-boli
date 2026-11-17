const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../miniapp.js'),'utf8');
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
function environment({login,tick,fetchImpl}={}){
 const status={textContent:''},frame={hidden:true,src:''},retry={disabled:false,onclick:null};
 let poll;
 const data=new Map();
 const localStorage={getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const account={isSignedIn:()=>true,account:()=> 'tg_test123456789',login:login||(async()=>({accountId:'tg_test123456789'})),clear:()=>{}};
 const root={document:{getElementById:id=>({status,course:frame,retry})[id]},
  window:null,CourseAccountPreview:{local:()=>({sections:{}})},localStorage,
  CourseSyncModel:{KEYS:[]},CourseStorage:{write(){},rollbackBatch(){}},
  CourseAutoSync:{create:()=>({tick:tick||(async()=>({status:'saved'})),stop(){}})},
  CourseCloudConfig:{apiBaseURL:'https://api.example'},
  CourseCloudAccount:{create:options=>{account.login=login||(()=>options.fetchImpl('https://api.example/v1/auth/telegram'));return account},borrow:a=>a},
  fetch:fetchImpl||(()=>Promise.resolve({ok:true})),
  AbortController,crypto:{randomUUID:()=> 'uuid-123'},navigator:{onLine:true},
  setTimeout:(cb,delay)=>{if(delay===12000)queueMicrotask(cb);return 1},
  clearTimeout:()=>{},setInterval:cb=>{poll=cb;return 7},clearInterval:()=>{},
  addEventListener:()=>{},Date,JSON,Error,Promise,URL,
  Telegram:{WebApp:{initData:'valid-signed-init-data'}},
 };
 root.window=root;
 return {root,status,frame,retry,getPoll:()=>poll,run:()=>vm.runInNewContext(source,root)};
}
test('Android hanging network request displays timeout, does not silently remain on loading screen',async()=>{
 const e=environment({fetchImpl:()=>new Promise(()=>{})});
 await e.run();await flush();
 assert.match(e.status.textContent,/Превышено время ответа сервера/);
 assert.equal(e.retry.disabled,false);
 assert.equal(e.frame.hidden,true,'Do not expose lessons until safe initial sync');
});
test('Initial transient sync result retries before iframe mount instead of leaving a blank Mini App',async()=>{
 let calls=0;
 const e=environment({login:async()=>({accountId:'tg_test123456789'}),tick:async()=>({status:++calls===1?'changed':'saved'})});
 await e.run();await flush();
 assert.equal(e.frame.hidden,true);
 assert.match(e.status.textContent,/Повторяем подключение/);
 assert.equal(typeof e.getPoll(),'function','Bootstrap must schedule retries before mount');
 await e.getPoll();await flush();
 assert.equal(e.frame.hidden,false,JSON.stringify({calls,status:e.status.textContent,frame:e.frame}));
 assert.match(e.frame.src,/index\.html/);
 assert.match(e.status.textContent,/Сохранено в облаке/);
});
test('API rejection shows recoverable error and leaves retry enabled',async()=>{
 const e=environment({login:async()=>{throw Error('invalid_telegram_identity')}});
 await e.run();await flush();
 assert.match(e.status.textContent,/invalid_telegram_identity/);
 assert.equal(e.retry.disabled,false);
 assert.equal(e.frame.hidden,true);
});
