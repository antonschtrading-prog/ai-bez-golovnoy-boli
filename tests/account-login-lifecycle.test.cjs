const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=readFileSync(path.join(__dirname,'../account-cloud-page.js'),'utf8');
function app({mini=false}={}){
 const elements=new Map(),handlers=new Map(),hits=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',className:'',disabled:false,hidden:false,checked:false,addEventListener:(event,cb)=>handlers.set(id+':'+event,cb)});
  return elements.get(id);
 };
 const account='tg_0123456789abcdef0123456789abcdef';
 let active=false;
 const client={login:async()=>{active=true;return {accountId:account}},
  browserChallenge:async()=>({nonce:'N'.repeat(43),expires:Date.now()+120000}),
  browserComplete:async()=>{active=true;return {accountId:account}},
  read:async()=>({revision:0,sections:{}}),
  logout:async()=>{active=false},clear:()=>{active=false},
  isSignedIn:()=>active,account:()=>active?account:null};
 const tool=name=>({setClient:()=>hits.push('set:'+name),forget:()=>hits.push('clear:'+name),
  clear:()=>hits.push('clear:'+name),reset:()=>hits.push('clear:'+name),
  readyForDirectSave:()=>true});
 const root={
  document:{getElementById:el,createElement:()=>({}),head:{append:script=>{
   root.Telegram={Login:{auth:(_options,callback)=>callback({id_token:'x'.repeat(80)})}};
   script.onload();
  }}},
  CourseCloudConfig:{apiBaseURL:'https://worker.example.org/',telegramClientId:123456},
  CourseCloudAccount:{create:()=>client},
  CourseSyncCommit:{create:()=>({cancel(){},inspect:async()=>({status:'ready',id:'secure_id_12345678',sectionCount:1,revision:0})})},
  CourseAccountQueuePage:{...tool('queue'),readyForDirectSave:()=>true},
  CourseAccountRestorePage:tool('restore'),
  CourseAccountBackupsPage:tool('backups'),
  CourseFileRecoveryPage:tool('files'),
  CourseAccountPreviewPage:tool('preview'),
  crypto:{randomUUID:()=> 'secure_id_12345678'},localStorage:{},
  fetch:()=>{},setTimeout,clearTimeout,addEventListener:()=>{},
  Telegram:mini?{WebApp:{initData:'signed-init-data'}}:null,
  Date,URL
 };
 root.window=root;vm.runInNewContext(script,root);
 return {el,hits,handlers,async click(id){const cb=handlers.get(id+':click');assert(cb,'missing handler '+id);await cb()}};
}
for(const mini of [false,true]){
 test((mini?'Mini App':'browser OIDC')+' login activates all four progress tools and logout clears them',async()=>{
  const f=app({mini});
  if(!mini){await f.click('browserPrepare');await f.click('browserAuthorize')}
  else await f.click('cloudLogin');
  for(const name of ['queue','restore','backups','files'])assert.equal(f.hits.filter(s=>s==='set:'+name).length,1,name);
  assert.equal(f.el('accountState').textContent,'Telegram: вход выполнен');
  await f.click('cloudLogout');
  for(const name of ['queue','restore','backups','files'])assert(f.hits.includes('clear:'+name),name);
  assert.equal(f.el('accountState').textContent,'Не выполнен');
 });
}
