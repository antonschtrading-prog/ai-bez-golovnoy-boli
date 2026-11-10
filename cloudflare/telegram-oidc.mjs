/* Telegram OIDC ID token verifier for browser login. Strict RS256 only.
 * JWKS is retrieved only from Telegram's fixed HTTPS endpoint, never from JWT.
 * A server-issued one-time nonce is mandatory for all accepted ID tokens.
 */
const ISSUER='https://oauth.telegram.org';
const JWKS='https://oauth.telegram.org/.well-known/jwks.json';
const enc=new TextEncoder();
function decode(input){
 if(typeof input!=='string'||!/^[A-Za-z0-9_-]+$/.test(input)||input.length>12000)throw Error('invalid_jwt');
 const binary=atob(input.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-input.length%4)%4));
 return Uint8Array.from(binary,x=>x.charCodeAt(0));
}
function json(input){
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(input)));
}
export async function verifyTelegramOidc(idToken,{clientId,nonce,fetchImpl=fetch,now=Date.now()}){
 if(typeof idToken!=='string'||idToken.length>12000||typeof clientId!=='string'||! /^[0-9]{1,24}$/.test(clientId)||typeof nonce!=='string'||! /^[A-Za-z0-9_-]{32,128}$/.test(nonce))throw Error('invalid_auth_request');
 const parts=idToken.split('.');
 if(parts.length!==3)throw Error('invalid_jwt');
 let header,claims;
 try{header=json(parts[0]);claims=json(parts[1])}catch(_){throw Error('invalid_jwt')}
 if(header?.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>160||! /^[A-Za-z0-9_-]+$/.test(header.kid)||header.typ&&header.typ!=='JWT')throw Error('invalid_jwt_header');
 if(claims?.iss!==ISSUER||claims.aud!==clientId||claims.nonce!==nonce)throw Error('invalid_claims');
 if(typeof claims.sub!=='string'||! /^[1-9][0-9]{0,15}$/.test(claims.sub))throw Error('invalid_subject');
 if(claims.id!==undefined&&String(claims.id)!==claims.sub)throw Error('mismatched_subject');
 const nowSeconds=Math.floor(now/1000);
 if(!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat>nowSeconds+30||claims.exp<=nowSeconds||claims.exp-claims.iat>3600||nowSeconds-claims.iat>300)throw Error('expired_identity');
 let keysResponse;
 try{keysResponse=await fetchImpl(JWKS,{method:'GET',redirect:'error',headers:{Accept:'application/json'}})}
 catch(_){throw Error('jwks_unavailable')}
 if(!keysResponse?.ok)throw Error('jwks_unavailable');
 const jwks=await keysResponse.json();
 if(!Array.isArray(jwks?.keys)||jwks.keys.length>50)throw Error('invalid_jwks');
 const jwk=jwks.keys.find(x=>x?.kid===header.kid&&x.kty==='RSA'&&(x.alg===undefined||x.alg==='RS256')&&(x.use===undefined||x.use==='sig')&&typeof x.n==='string'&&typeof x.e==='string');
 if(!jwk)throw Error('key_not_found');
 let valid=false;
 try{
  const key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:jwk.n,e:jwk.e,ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),enc.encode(parts[0]+'.'+parts[1]));
 }catch(_){throw Error('invalid_signature')}
 if(!valid)throw Error('invalid_signature');
 return{telegramId:claims.sub};
}
