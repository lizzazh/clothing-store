const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.join(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("manifest describes an installable standalone PWA",()=>{
 const m=JSON.parse(read("mobile/manifest.webmanifest"));
 assert.equal(m.display,"standalone");assert.equal(m.start_url,"/mobile/");
 assert.ok(m.icons.some(x=>x.sizes==="192x192"));assert.ok(m.icons.some(x=>x.sizes==="512x512"));
 for(const icon of ["mobile/icon-192.png","mobile/icon-512.png"]){
  const p=fs.readFileSync(path.join(root,icon));assert.equal(p.subarray(1,4).toString(),"PNG");
 }
});
test("HTML has mobile features and the PWA is scoped",()=>{
 const h=read("mobile/index.html");
 for(const id of ["screen-chat","screen-wardrobe","screen-style","screen-capsules","photo-input","style-grid","prompt","save-access"])
  assert.match(h,new RegExp('id="'+id+'"'));
 assert.match(h,/viewport-fit=cover/);
 assert.match(h,/<link rel="manifest"/);
});
test("SW caches only the shell and excludes private API calls",()=>{
 const sw=read("mobile/sw.js");
 assert.match(sw,/ASSETS/);assert.match(sw,/\/api\//);assert.match(sw,/req.method!=="GET"/);
});
test("AI endpoint requires signed browser session and checks wardrobe IDs",async()=>{
 const code=read("functions/api/mobile-capsule.js");
 assert.match(code,/env.PWA_GEMINI_API_KEY/);
 assert.doesNotMatch(code,/env.GEMINI_API_KEY/);
 assert.doesNotMatch(code,/X-Travel-Passcode/);
 let calls=0,payload="";
 const fetch=async(url,options)=>{
  calls++;payload=options.body;
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({
   message:"Образ готов",outfits:[{name:"Капсула",itemIds:["1","999"],reason:""}],missing:[]
  })}]}}]})};
 };
 const fakeAuth=async req=>req.headers.get("Cookie")==="signed-session";
 const api=vm.runInNewContext(
  code.replace(/^import .*$/gm,"").replace(/^export /gm,"")+"\n({onRequestPost})",
  {Response,URL,fetch,AbortController,setTimeout,clearTimeout,Date,JSON,Number,Math,Array,Set,RegExp,String,Object,
   authenticated:fakeAuth,sameOrigin:()=>true});
 const request=async(cookie,env)=>{
  const body={message:"Подбери одежду для поездки",wardrobe:[
   {id:1,name:"Сукня",category:"Сукня",img:"data:image/png;base64,secret-photo"}
  ],styleDNA:{classic:100}};
  return api.onRequestPost({request:{url:"https://example.com/api/mobile-capsule",
   headers:{get:k=>k==="Cookie"?cookie:k==="Origin"?"https://example.com":null},
   text:async()=>JSON.stringify(body)},env});
 };
 let r=await request(null,{TRAVEL_PWA_PASSCODE:"correct",PWA_GEMINI_API_KEY:"testkey"});
 assert.equal(r.status,401);assert.equal(calls,0);
 r=await request("signed-session",{TRAVEL_PWA_PASSCODE:"correct",PWA_GEMINI_API_KEY:"testkey"});
 assert.equal(r.status,200);
 const data=await r.json();assert.deepEqual([...data.packingIds],["1"]);
 assert.equal(payload.includes("secret-photo"),false);
 r=await request("signed-session",{TRAVEL_PWA_PASSCODE:"correct"});
 assert.equal(r.status,503);
});
test("mobile scripts parse as JavaScript without build tooling",()=>{
 new (require("node:vm").Script)(read("mobile/app.js"));
 new (require("node:vm").Script)(read("js/travel-capsule.js"));
});
