/* Telegram Mini App initData verification using WebCrypto, no third-party service.
 * Raw initDataUnsafe and client-supplied user IDs are NEVER authentication.
 * Implements official HMAC-SHA256 validation with a narrow timestamp window.
 */
const encoder=new TextEncoder();
async function hmac(key,message){
 const cryptoKey=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,encoder.encode(message)));
}
function hexBytes(value){if(!/^[a-f0-9]{64}$/.test(value))throw Error('invalid_hash');return Uint8Array.from(value.match(/.{2}/g),x=>parseInt(x,16))}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0}
export async function verifyTelegramMiniApp(initData,botToken,now=Date.now()){
 if(typeof botToken!=='string'||!botToken||typeof initData!=='string'||initData.length>16384)throw Error('invalid_init_data');
 const params=new URLSearchParams(initData),seen=new Set();
 for(const [key] of params){if(seen.has(key))throw Error('duplicate_field');seen.add(key)}
 const signature=hexBytes(params.get('hash')||'');params.delete('hash');
 const data=[...params].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const secret=await hmac(encoder.encode('WebAppData'),botToken);
 const calculated=await hmac(secret,data);
 if(!equal(signature,calculated))throw Error('invalid_signature');
 const at=Number(params.get('auth_date'));
 if(!Number.isSafeInteger(at)||at*1000>now+30000||now-at*1000>300000)throw Error('expired_init_data');
 let user;
 try{user=JSON.parse(params.get('user')||'null')}catch(_){throw Error('invalid_user')}
 if(!Number.isSafeInteger(user?.id)||user.id<=0)throw Error('invalid_user');
 const replayBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(initData)));
 const replay=Array.from(replayBytes,b=>b.toString(16).padStart(2,'0')).join('');
 return{telegramId:String(user.id),replay,expires:at*1000+330000};
}
