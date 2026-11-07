/* Signed, persistent HttpOnly session for Elizabeth's Elegance Pocket Stylist.
 * Uses the existing Cloudflare TRAVEL_PWA_PASSCODE secret as a signing key.
 * Rotating that secret invalidates all active sessions.
 */
export const COOKIE_NAME="__Host-ee_pocket_session";
export const SESSION_SECONDS=30*24*60*60;
const encode=new TextEncoder();
const KEY_CACHE=new Map();
async function keyFor(secret){
  if(!secret)return null;
  if(KEY_CACHE.has(secret))return KEY_CACHE.get(secret);
  const key=await crypto.subtle.importKey("raw",encode.encode("EE-PWA-SESSION-v1:"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  KEY_CACHE.set(secret,key);
  return key;
}
function hex(array){return Array.from(array,x=>x.toString(16).padStart(2,"0")).join("");}
function unhex(value){if(!/^(?:[0-9a-f]{2})+$/i.test(value))return null;return new Uint8Array(value.match(/.{2}/g).map(v=>parseInt(v,16)));}
export function sameOrigin(request){
  try{
    const site=request.headers.get("Sec-Fetch-Site");
    if(site==="cross-site")return false;
    const origin=request.headers.get("Origin");
    return !origin||new URL(origin).origin===new URL(request.url).origin;
  }catch(_){return false;}
}
export async function sessionCookie(secret){
  if(!secret)throw Error("Session secret not configured");
  const expires=Date.now()+SESSION_SECONDS*1000;
  const nonce=new Uint8Array(16);crypto.getRandomValues(nonce);
  const payload="v1."+expires+"."+hex(nonce);
  const key=await keyFor(secret);
  const digest=await crypto.subtle.sign("HMAC",key,encode.encode(payload));
  return COOKIE_NAME+"="+payload+"."+hex(new Uint8Array(digest))+"; Path=/; Max-Age="+SESSION_SECONDS+"; HttpOnly; Secure; SameSite=Strict";
}
export const removeSessionCookie=()=>COOKIE_NAME+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
export async function authenticated(request,secret){
  if(!secret||!sameOrigin(request))return false;
  const cookies=request.headers.get("Cookie")||"";
  const value=cookies.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+"="))?.slice(COOKIE_NAME.length+1);
  if(!value||value.length>256)return false;
  const match=/^(v1\.[0-9]{13}\.[0-9a-f]{32})\.([0-9a-f]{64})$/i.exec(value);
  if(!match)return false;
  const payload=match[1],expiry=Number(payload.split(".")[1]),now=Date.now();
  if(!Number.isFinite(expiry)||expiry<=now||expiry>now+SESSION_SECONDS*1000+300000)return false;
  const signature=unhex(match[2]);
  if(!signature)return false;
  const key=await keyFor(secret);
  return crypto.subtle.verify("HMAC",key,signature,encode.encode(payload));
}
