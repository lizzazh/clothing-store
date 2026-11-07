// Tests for Cloudflare's signed 30-day HttpOnly cookie session.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {webcrypto}=require("node:crypto");
const ctx={crypto:webcrypto,TextEncoder,URL,Uint8Array,Date,Map,Array,Number,Math,RegExp,Object,Set,String};
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const helpers=vm.runInNewContext(read("functions/_lib/mobile-auth.js").replace(/^export /gm,"")+"\n({authenticated,sameOrigin,sessionCookie,removeSessionCookie,COOKIE_NAME})",ctx);
const source=read("functions/api/mobile-auth.js").replace(/^import .*$/gm,"").replace(/^export /gm,"");
const authApi=vm.runInNewContext(source+"\n({onRequestGet,onRequestPost,onRequestDelete})",{...ctx,Response,...helpers});
const env={TRAVEL_PWA_PASSCODE:"a-private-long-test-passphrase",PWA_GEMINI_API_KEY:"fake-ai-key"};
function request(method,body=null,cookie=null,origin="https://app.test"){
 const headers=new Headers();
 headers.set("Origin",origin);
 if(cookie)headers.set("Cookie",cookie);
 if(body!==null)headers.set("Content-Type","application/json");
 return {url:"https://app.test/api/mobile-auth",method,
  headers:{get:k=>headers.get(k)},
  text:async()=>JSON.stringify(body??{})};
}
test("one-time sign-in sets secure 30-day HttpOnly cookie",async()=>{
 const r=await authApi.onRequestPost({request:request("POST",{passcode:env.TRAVEL_PWA_PASSCODE}),env});
 assert.equal(r.status,200);
 const cookie=r.headers.get("set-cookie");
 assert.match(cookie,/__Host-ee_pocket_session=/);
 assert.match(cookie,/Max-Age=2592000/);
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
 assert.doesNotMatch(cookie,new RegExp(env.TRAVEL_PWA_PASSCODE));
 const cookieHeader=cookie.split(";")[0];
 const status=await authApi.onRequestGet({request:request("GET",null,cookieHeader),env});
 assert.deepEqual(await status.json(),{connected:true,configured:true});
});
test("invalid code and cross-origin requests cannot create session",async()=>{
 const bad=await authApi.onRequestPost({request:request("POST",{passcode:"not-it"}),env});
 assert.equal(bad.status,401);assert.equal(bad.headers.get("set-cookie"),null);
 const cross=await authApi.onRequestPost({request:request("POST",{passcode:env.TRAVEL_PWA_PASSCODE},null,"https://evil.test"),env});
 assert.equal(cross.status,403);
});
test("a forged cookie or rotated passcode invalidates the session",async()=>{
 const original=await helpers.sessionCookie(env.TRAVEL_PWA_PASSCODE);
 const cookie=original.split(";")[0];
 assert.equal(await helpers.authenticated(request("GET",null,cookie),env.TRAVEL_PWA_PASSCODE),true);
 const tampered=cookie.slice(0,-2)+(cookie.slice(-2)==="ab"?"cd":"ab");
 assert.equal(await helpers.authenticated(request("GET",null,tampered),env.TRAVEL_PWA_PASSCODE),false);
 assert.equal(await helpers.authenticated(request("GET",null,cookie),"a-different-secret"),false);
});
test("sign-out deletes cookie and returns disconnected state",async()=>{
 const r=await authApi.onRequestDelete({request:request("DELETE"),env});
 assert.equal(r.status,200);
 assert.match(r.headers.get("set-cookie"),/Max-Age=0/);
 assert.deepEqual(await r.json(),{connected:false});
});
test("Preview with no secrets reports not configured",async()=>{
 const r=await authApi.onRequestGet({request:request("GET"),env:{}});
 assert.deepEqual(await r.json(),{connected:false,configured:false});
 const login=await authApi.onRequestPost({request:request("POST",{passcode:"any"}),env:{}});
 assert.equal(login.status,503);
});
