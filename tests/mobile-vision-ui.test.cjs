const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const code=fs.readFileSync(path.join(__dirname,"../mobile/app.js"),"utf8");
function setup(authState={connected:false}){
 const nodes=new Map(),store=new Map(),session=new Map(),nav=[],styles=[],screens=[],requests=[];
 let domReady,items=[];
 const pwaIds=["install-button","messages","prompt","send-button","wardrobe-status","connection-status","photo-input",
 "photo-label","photo-preview","item-name","item-category","item-color","item-season","item-formality","item-style",
 "save-item","add-item-form","wardrobe-count","wardrobe-grid","wardrobe-summary","style-grid",
 "save-style","style-notice","capsules-list","access-code","access-feedback","access-panel",
 "save-access","access-controls","disconnect-ai","vision-access-row","vision-auth-status","vision-access-code","vision-save-access","vision-auto","recognize-photo","recognition-status",
 "mic-button","ios-install-hint","dismiss-install","toast"];
 function node(name){
  const n={name,value:"",disabled:false,hidden:false,checked:false,open:false,src:"",textContent:"",
   innerHTML:"",scrollTop:0,scrollHeight:0,style:{},dataset:{},className:"",events:{},
   children:[],attributes:{},classList:{add(){},remove(){},toggle(){}},
   append(...children){this.children.push(...children);},
   replaceChildren(...children){this.children=[...children];},
   addEventListener(type,fn){this.events[type]=fn;},
   setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},
   reset(){},focus(){}
  };
  return n;
 }
 for(const id of pwaIds)nodes.set(id,node(id));
 for(const name of ["chat","wardrobe","style","capsules"]){
  const n=node("screen-"+name);n.hidden=name!=="chat";screens.push(n);
  const b=node(name);b.dataset.tab=name;nav.push(b);
 }
 for(const name of ["classic","minimalist","romantic","elegant","streetwear","boho"]){
  const n=node(name);n.dataset.style=name;styles.push(n);
 }
 const sample=[];
 const canvas=()=>({width:0,height:0,getContext(){return {fillStyle:"",fillRect(){},drawImage(){}};},toDataURL(){return "data:image/jpeg;base64,AAAA";}});
 const document={
  readyState:"loading",title:"",
  addEventListener(name,fn){if(name==="DOMContentLoaded")domReady=fn;},
  getElementById(name){if(!nodes.has(name))throw Error("Unknown element "+name);return nodes.get(name);},
  querySelectorAll(query){return {".screen":screens,".nav-tab":nav,".style-card":styles,".suggestion":sample}[query]||[];},
  createElement(tag){return tag==="canvas"?canvas():node(tag);},
  createTextNode(text){return {textContent:text};}
 };
 const localStorage={getItem:key=>store.get(key)??null,setItem:(key,val)=>store.set(key,String(val))};
 const sessionStorage={getItem:key=>session.get(key)??null,setItem:(key,val)=>session.set(key,String(val)),removeItem:key=>session.delete(key)};
 const window={addEventListener(){},scrollTo(){}};
 const navigator={onLine:true,language:"ru-RU",userAgent:"Android"};
 const WardrobeDB={
  async getAll(){return items.slice();},
  async add(item){items.push(item);},
  async delete(id){items=items.filter(i=>i.id!==id);},markInitialized(){}
 };
 const TravelCapsule={plan(){return {days:[],packingIds:[],covered:false}}};
 const fetch=async(url,options={})=>{
  requests.push({url,options});
  if(url==="/api/mobile-auth"){
   const method=options.method||"GET";
   if(method==="GET")return {ok:true,status:200,json:async()=>({connected:authState.connected,configured:true})};
   if(method==="DELETE"){authState.connected=false;return {ok:true,status:200,json:async()=>({connected:false})};}
   if(method==="POST"){
    if(JSON.parse(options.body).passcode!=="secret-passphrase")return {ok:false,status:401,json:async()=>({error:"Неверный код"})};
    authState.connected=true;return {ok:true,status:200,json:async()=>({connected:true})};
   }
  }
  if(url!=="/api/mobile-vision")throw Error("Unexpected API URL "+url);
  if(!authState.connected)return {ok:false,status:401,json:async()=>({error:"Unauthenticated",code:"ACCESS_DENIED"})};
  return {ok:true,status:200,json:async()=>({item:{name:"Бордовая юбка",category:"Брюки / Спідниця",color:"бордовый",
   season:["spring","autumn"],style:["romantic","elegant"],formality:0.8,confidence:0.88,warning:""}})};
 };
 const createImageBitmap=async()=>({width:600,height:600,close(){}});
 const ctx={document,window,navigator,WardrobeDB,TravelCapsule,localStorage,sessionStorage,
  fetch,createImageBitmap,URL:{},Date,Intl,Math,JSON,Number,Array,Set,Object,String,console,
  setTimeout:()=>1,clearTimeout:()=>{},confirm:()=>true};
 vm.runInNewContext(code,ctx,{filename:"mobile/app.js"});
 if(!domReady)throw Error("No boot handler");
 const el=id=>nodes.get(id);
 el("item-category").value="Топ / Блуза";el("item-season").value="all-season";el("item-formality").value="0.5";
 return {el,boot:()=>domReady(),items:()=>items,requests,store,session,
  photo:()=>el("photo-input").events.change({target:{files:[{name:"skirt.jpg",type:"image/jpeg",size:10000}]}})};
}
test("no consent: photo stays local, manual fields save without AI call",async()=>{
 const a=setup();await a.boot();
 await a.photo();
 assert.equal(a.requests.filter(x=>x.url==="/api/mobile-vision").length,0);
 a.el("item-name").value="Моя юбка";
 await a.el("add-item-form").events.submit({preventDefault(){}});
 assert.equal(a.items().length,1);
 assert.equal(a.items()[0].name,"Моя юбка");
 assert.match(a.items()[0].img,/^data:image\/jpeg;base64,/);
 assert.equal(a.items()[0].style.length,0);
});
test("after consent, selecting photo auto-detects name, category, colour, season and styles",async()=>{
 const a=setup();await a.boot();
 a.el("vision-access-code").value="secret-passphrase";
 await a.el("vision-save-access").events.click();
 a.el("vision-auto").checked=true;
 await a.el("vision-auto").events.change();
 await a.photo();
 assert.equal(a.requests.filter(x=>x.url==="/api/mobile-vision").length,1);
 assert.equal(a.requests.find(x=>x.url==="/api/mobile-vision").url,"/api/mobile-vision");
 assert.equal(a.requests.find(x=>x.url==="/api/mobile-vision").options.credentials,"same-origin");
 assert.equal(a.requests.find(x=>x.url==="/api/mobile-vision").options.headers["X-Travel-Passcode"],undefined);
 assert.equal(a.el("item-name").value,"Бордовая юбка");
 assert.equal(a.el("item-category").value,"Брюки / Спідниця");
 assert.equal(a.el("item-color").value,"бордовый");
 assert.equal(a.el("item-season").value,"spring");
 assert.equal(a.el("item-style").value,"romantic");
 await a.el("add-item-form").events.submit({preventDefault(){}});
 assert.equal(a.items().length,1);
 assert.deepEqual(Array.from(a.items()[0].season),["spring","autumn"]);
 assert.deepEqual(Array.from(a.items()[0].style),["romantic","elegant"]);
});
test("manual user correction overrides AI suggestions",async()=>{
 const a=setup();await a.boot();
 a.el("vision-access-code").value="secret-passphrase";
 await a.el("vision-save-access").events.click();
 a.el("vision-auto").checked=true;await a.el("vision-auto").events.change();await a.photo();
 a.el("item-color").value="синий";
 a.el("item-style").value="classic";
 a.el("item-season").value="winter";
 await a.el("add-item-form").events.submit({preventDefault(){}});
 assert.equal(a.items()[0].color,"синий");
 assert.deepEqual(Array.from(a.items()[0].style),["classic"]);
 assert.deepEqual(Array.from(a.items()[0].season),["winter"]);
});

test("AI session survives PWA restart without submitting passcode again",async()=>{
 const authState={connected:false};
 const first=setup(authState);await first.boot();
 first.el("vision-access-code").value="secret-passphrase";
 await first.el("vision-save-access").events.click();
 assert.equal(authState.connected,true);
 const second=setup(authState);await second.boot();
 second.el("vision-auto").checked=true;
 await second.photo();
 assert.equal(second.requests.filter(x=>x.url==="/api/mobile-vision").length,1);
 assert.equal(second.requests.filter(x=>x.url==="/api/mobile-auth"&&x.options.method==="POST").length,0);
 assert.equal(second.el("vision-access-row").hidden,true);
});
