const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../functions/api/mobile-vision.js"),"utf8");
function apiWith(fetchMock){
 const context={Response,URL,fetch:fetchMock,AbortController,setTimeout,clearTimeout,JSON,Number,Math,String,Set,Array,Date,Object,
  authenticated:async req=>req.headers.get("Cookie")==="signed-session",
  sameOrigin:()=>true};
 return vm.runInNewContext(source.replace(/^import .*$/gm,"").replace(/^export /gm,"")+"\n({onRequestPost})",context);
}
const imageData="data:image/jpeg;base64,AAAA";
function request({cookie="signed-session",data=imageData,origin="https://app.example",extra={}}={}){
 return {url:"https://app.example/api/mobile-vision",
  headers:{get(name){return name==="Origin"?origin:name==="Cookie"?cookie:extra[name]||null;}},
  text:async()=>JSON.stringify({imageData:data})};
}
const env={TRAVEL_PWA_PASSCODE:"correct",PWA_GEMINI_API_KEY:"secret"};
const response=(obj,status=200)=>({ok:status>=200&&status<300,status,json:async()=>obj});
test("requires separate API secret and signed session before image leaves server",async()=>{
 let calls=0;
 const api=apiWith(async()=>{calls++;throw Error("must not call")});
 assert.equal((await api.onRequestPost({request:request({cookie:"invalid"}),env})).status,401);
 assert.equal((await api.onRequestPost({request:request(),env:{TRAVEL_PWA_PASSCODE:"correct"}})).status,503);
 assert.equal(calls,0);
});
test("rejects other origins and non-JPEG payloads",async()=>{
 const api=apiWith(async()=>{throw Error("must not call")});
 assert.equal((await api.onRequestPost({request:request({origin:"https://other.example"}),env})).status,403);
 assert.equal((await api.onRequestPost({request:request({data:"data:image/png;base64,AAAA"}),env})).status,400);
});
test("Gemini receives only photo and instruction, returns validated garment metadata",async()=>{
 let payload,headers;
 const api=apiWith(async(url,options)=>{
  assert.match(url,/generateContent/);payload=JSON.parse(options.body);headers=options.headers;
  return response({candidates:[{content:{parts:[{text:JSON.stringify({
   name:"Нежная юбка",category:"Брюки / Спідниця",color:"бордовый",season:["spring","autumn","incorrect"],
   style:["romantic","elegant","invalid"],formality:0.76,confidence:0.82,warning:""
  })}]}}]});
 });
 const out=await api.onRequestPost({request:request(),env});
 assert.equal(out.status,200);
 const result=await out.json();
 assert.equal(result.item.name,"Нежная юбка");assert.equal(result.item.category,"Брюки / Спідниця");
 assert.equal(result.item.color,"бордовый");assert.equal(result.item.formality,0.76);
 assert.deepEqual(Array.from(result.item.season),["spring","autumn"]);
 assert.deepEqual(Array.from(result.item.style),["romantic","elegant"]);
 assert.equal(headers["X-goog-api-key"],"secret");
 assert.equal(payload.contents[0].parts[1].inline_data.data,"AAAA");
 assert.equal(payload.contents[0].parts[1].inline_data.mime_type,"image/jpeg");
 assert.equal(JSON.stringify(result).includes("AAAA"),false);
});
test("partial or malformed upstream answers never invent garment data",async()=>{
 const api=apiWith(async()=>response({candidates:[{content:{parts:[{text:"nonsense"}]}}]}));
 const out=await api.onRequestPost({request:request(),env});
 assert.equal(out.status,502);
});

test("gemini Flash disables thinking and requests schema with sufficient output budget",async()=>{
 let config;
 const api=apiWith(async(_url,options)=>{
  const payload=JSON.parse(options.body);
  config=payload.generationConfig;
  return response({candidates:[{content:{parts:[{text:JSON.stringify({
   name:"Голубые джинсы",category:"Брюки / Спідниця",color:"голубой",
   season:["all-season"],style:["streetwear"],formality:0.5,confidence:0.9,warning:""
  })}]}}]});
 });
 const out=await api.onRequestPost({request:request(),env});
 assert.equal(out.status,200);
 assert.equal(config.responseMimeType,"application/json");
 assert.equal(config.maxOutputTokens,1536);
 assert.equal(config.thinkingConfig.thinkingBudget,0);
 assert.equal(config.responseSchema.type,"OBJECT");
 assert.ok(config.responseSchema.required.includes("category"));
});
test("truncated Gemini JSON is reported as recoverable output error",async()=>{
 const api=apiWith(async()=>response({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[]}}],usageMetadata:{thoughtsTokenCount:500}}));
 const out=await api.onRequestPost({request:request(),env});
 assert.equal(out.status,502);
 assert.equal((await out.json()).code,"OUTPUT_TRUNCATED");
});
test("Gemini returning empty or incomplete metadata is not saved",async()=>{
 const api=apiWith(async()=>response({candidates:[{finishReason:"STOP",content:{parts:[{text:'{"foo":"bar"}'}]}}]}));
 const out=await api.onRequestPost({request:request(),env});
 assert.equal(out.status,502);
 assert.equal((await out.json()).code,"INVALID_DESCRIPTION");
});
