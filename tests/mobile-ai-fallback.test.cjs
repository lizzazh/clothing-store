const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
const env={TRAVEL_PWA_PASSCODE:"test-session-key",PWA_GEMINI_API_KEY:"gemini-key",PWA_OPENROUTER_API_KEY:"free-key"};
const imageData="data:image/jpeg;base64,AAAA";
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function load(pathName,fetchMock){
 const ctx={Response,URL,AbortController,fetch:fetchMock,setTimeout,clearTimeout,
  JSON,Math,Number,Object,String,Date,Set,Array,Map,console,
  authenticated:async()=>true,sameOrigin:()=>true};
 const helpers=vm.runInNewContext(read("functions/_lib/mobile-ai-fallback.js").replace(/^export /gm,"")+"\n({tryPwaFallback,pwaFallbackEnabled})",ctx);
 Object.assign(ctx,helpers);
 return vm.runInNewContext(read(pathName).replace(/^import .*$/gm,"").replace(/^export /gm,"")+"\n({onRequestPost})",ctx).onRequestPost;
}
function request(endpoint,body){
 return {url:"https://app.example/api/"+endpoint,
  headers:{get(name){return name==="Origin"?"https://app.example":name==="Cookie"?"signed-session":null}},
  text:async()=>JSON.stringify(body)};
}
test("vision falls back to free router after 429; photo and secrets not echoed in response",async()=>{
 const seen=[];
 const call=load("functions/api/mobile-vision.js",async(url,options)=>{
  seen.push({url,options});
  if(url.includes("generativelanguage"))return response({error:"quota"},429);
  assert.equal(url,"https://openrouter.ai/api/v1/chat/completions");
  const payload=JSON.parse(options.body);
  assert.equal(payload.model,"openrouter/free");
  assert.equal(payload.messages[0].content[1].image_url.url,imageData);
  return response({choices:[{message:{content:JSON.stringify({
   name:"Голубые джинсы",category:"Брюки / Спідниця",color:"голубой",
   season:["all-season"],style:["streetwear"],formality:0.55,confidence:0.85,warning:""
  })}}]});
 });
 const res=await call({request:request("mobile-vision",{imageData}),env});
 assert.equal(res.status,200);const data=await res.json();
 assert.equal(data.item.category,"Брюки / Спідниця");
 assert.equal(data.provider,"OpenRouter Free");
 assert.equal(data.fallback,true);
 assert.equal(seen.length,2);
 assert.doesNotMatch(JSON.stringify(data),/AAAA|free-key|gemini-key/);
});
test("capsule falls back to OpenRouter Free and filters fake item IDs",async()=>{
 const call=load("functions/api/mobile-capsule.js",async(url,options)=>{
  if(url.includes("generativelanguage"))return response({},429);
  const payload=JSON.parse(options.body);
  assert.equal(payload.model,"openrouter/free");
  return response({choices:[{message:{content:JSON.stringify({
   message:"Собрала образ из твоих вещей",outfits:[
     {name:"Прогулка",itemIds:["top","bottom","shoes","invented"],reason:"Сочетание для дня"}
   ],missing:[]
  })}}]});
 });
 const wardrobe=[
  {id:"top",name:"Топ",category:"Топ / Блуза"},
  {id:"bottom",name:"Брюки",category:"Брюки / Спідниця"},
  {id:"shoes",name:"Кеды",category:"Взуття"}
 ];
 const res=await call({request:request("mobile-capsule",{message:"Собери образ на прогулку",wardrobe}),env});
 assert.equal(res.status,200);const data=await res.json();
 assert.equal(data.provider,"OpenRouter Free");
 assert.equal(data.outfits.length,1);
 assert.deepEqual(Array.from(data.outfits[0].itemIds),["top","bottom","shoes"]);
 assert.equal(JSON.stringify(data).includes("invented"),false);
});
test("unauthenticated vision never sends image to ANY provider",async()=>{
 const mock=async()=>{throw Error("no remote calls expected")};
 const ctx={Response,URL,AbortController,fetch:mock,setTimeout,clearTimeout,JSON,Math,Number,Object,String,Set,Array,Map,console,
   authenticated:async()=>false,sameOrigin:()=>true};
 Object.assign(ctx,vm.runInNewContext(read("functions/_lib/mobile-ai-fallback.js").replace(/^export /gm,"")+"\n({tryPwaFallback,pwaFallbackEnabled})",ctx));
 const call=vm.runInNewContext(read("functions/api/mobile-vision.js").replace(/^import .*$/gm,"").replace(/^export /gm,"")+"\n({onRequestPost})",ctx).onRequestPost;
 const res=await call({request:request("mobile-vision",{imageData}),env});
 assert.equal(res.status,401);
});
test("no configured fallback preserves Gemini rate limit response",async()=>{
 const call=load("functions/api/mobile-vision.js",async()=>response({},429));
 const local={TRAVEL_PWA_PASSCODE:"secret",PWA_GEMINI_API_KEY:"key"};
 const res=await call({request:request("mobile-vision",{imageData}),env:local});
 assert.equal(res.status,429);
 assert.equal((await res.json()).code,"RATE_LIMIT");
});
test("Groq is strictly opt-in, never charged by default even with a key present",async()=>{
 let called=0;
 const call=load("functions/api/mobile-vision.js",async()=>{called++;return response({},429)});
 const local={...env,PWA_OPENROUTER_API_KEY:undefined,PWA_GROQ_API_KEY:"groq-key"};
 const res=await call({request:request("mobile-vision",{imageData}),env:local});
 assert.equal(res.status,429);assert.equal(called,1);
});
test("with consent and explicit opt-in, Groq vision uses supported Qwen model",async()=>{
 const local={...env,PWA_OPENROUTER_API_KEY:undefined,PWA_GROQ_API_KEY:"groq-key",PWA_ALLOW_PAID_GROQ_FALLBACK:"true"};
 const seen=[];
 const call=load("functions/api/mobile-vision.js",async(url,options)=>{
  seen.push(url);
  if(url.includes("generativelanguage"))return response({},429);
  const payload=JSON.parse(options.body);
  assert.equal(payload.model,"qwen/qwen3.8-27b");
  return response({choices:[{message:{content:JSON.stringify({
   name:"Джинсы",category:"Брюки / Спідниця",color:"синий",
   season:["spring"],style:["classic"],formality:0.4,confidence:0.7,warning:""
  })}}]});
 });
 const out=await call({request:request("mobile-vision",{imageData}),env:local});
 assert.equal(out.status,200);assert.equal((await out.json()).provider,"Groq");
 assert.equal(seen.length,2);
});
