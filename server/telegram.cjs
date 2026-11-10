'use strict';
const {createHmac,timingSafeEqual,createHash}=require('node:crypto');
function verify(initData,botToken,now=Date.now()){
 if(!botToken||typeof initData!=='string'||initData.length>16384)throw Error('invalid_telegram');
 const params=new URLSearchParams(initData),seen=new Set();
 for(const [key] of params){if(seen.has(key))throw Error('duplicate_field');seen.add(key)}
 const hash=params.get('hash');if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('invalid_hash');
 params.delete('hash');
 const text=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest();
 const expected=createHmac('sha256',secret).update(text).digest();
 if(!timingSafeEqual(expected,Buffer.from(hash,'hex')))throw Error('invalid_signature');
 const date=Number(params.get('auth_date'));
 if(!Number.isSafeInteger(date)||date*1000>now+30000||now-date*1000>300000)throw Error('expired');
 const user=JSON.parse(params.get('user'));
 if(!Number.isSafeInteger(user?.id)||user.id<=0)throw Error('invalid_user');
 return{user:String(user.id),hash:createHash('sha256').update(initData).digest('hex'),expires:date*1000+330000};
}
module.exports={verify};
