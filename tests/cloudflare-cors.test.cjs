const {test}=require('node:test'),assert=require('node:assert/strict');
test('browser login preflight permits POST only for the course origin',async()=>{
 const {createHandler}=await import('../cloudflare/api.mjs');
 const handler=createHandler({db:{prepare(){},batch(){}},origins:['https://antonschtrading-prog.github.io']});
 for(const path of ['/v1/auth/telegram','/v1/auth/browser','/v1/auth/browser/challenge']){
  const r=await handler(new Request('https://api.example'+path,{method:'OPTIONS',headers:{Origin:'https://antonschtrading-prog.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}));
  assert.equal(r.status,204);assert(r.headers.get('Access-Control-Allow-Methods').split(',').includes('POST'));
  assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://antonschtrading-prog.github.io');
 }
 const denied=await handler(new Request('https://api.example/v1/auth/browser',{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'POST'}}));
 assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
});
