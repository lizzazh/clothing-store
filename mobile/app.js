/* Elizabeth's Elegance Pocket Stylist — browser app, no framework/build step. */
(function(){
"use strict";
const $ = id => document.getElementById(id);
const STORAGE_PLANS = "ee_mobile_capsules_v1";
const STORAGE_ACCESS = "ee_mobile_ai_passcode";
const STYLES = ["classic","minimalist","romantic","elegant","streetwear","boho"];
const state = { items:[], styleDNA:{}, selectedStyles:new Set(), plans:[], history:[], photo:null, busy:false, installPrompt:null };
let toastTimer=null;
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function clear(node){node.replaceChildren();}
function toast(message){
 const box=$("toast");box.textContent=message;box.hidden=false;
 if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>{box.hidden=true;},4300);
}
function getJSON(key,fallback){try{const x=JSON.parse(localStorage.getItem(key));return x??fallback;}catch(_){return fallback;}}
function saveJSON(key,data){try{localStorage.setItem(key,JSON.stringify(data));return true;}catch(_){toast("Недостаточно места для сохранения. Проверь хранилище браузера.");return false;}}
function itemById(id){return state.items.find(x=>String(x.id)===String(id));}
function imageIsSafe(url){return typeof url==="string"&&/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(url);}
function displayPhoto(item){
 if(item&&imageIsSafe(item.img)){const img=el("img");img.src=item.img;img.alt=item.name||"Одежда";img.loading="lazy";return img;}
 return el("span","", "✦");
}
function labelForCategory(category){
 const labels={"Топ / Блуза":"Верх","Брюки / Спідниця":"Низ","Сукня":"Платье","Взуття":"Обувь","Куртка / Пальто":"Верхняя одежда","Аксесуар":"Аксессуар"};
 return labels[category]||category||"Вещь";
}
function showTab(tab){
 for(const n of document.querySelectorAll(".screen")){const active=n.id==="screen-"+tab;n.hidden=!active;n.classList.toggle("active",active);}
 for(const b of document.querySelectorAll(".nav-tab")){const active=b.dataset.tab===tab;b.classList.toggle("active",active);if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");}
 document.title=(tab==="chat"?"Pocket Stylist":tab==="wardrobe"?"Мой гардероб":tab==="style"?"Style DNA":"Мои капсулы")+" — Elizabeth’s Elegance";
 window.scrollTo({top:0,behavior:"auto"});
}
async function refreshWardrobe(){
 state.items=await WardrobeDB.getAll();
 $("wardrobe-count").textContent=state.items.length;
 $("wardrobe-status").textContent="Гардероб: "+state.items.length+" "+(state.items.length===1?"вещь":"вещей");
 $("wardrobe-summary").textContent=state.items.length+" вещей";
 renderWardrobe();
}
function renderWardrobe(){
 const grid=$("wardrobe-grid");clear(grid);
 if(!state.items.length){grid.append(el("p","empty","Пока нет вещей. Добавь любимые, а затем попроси AI собрать капсулу."));return;}
 for(const item of [...state.items].reverse()){
  const card=el("article","wardrobe-item");
  const thumb=el("div","thumb");thumb.append(displayPhoto(item));
  const desc=el("div","description");desc.append(el("strong","",item.name||"Без названия"));
  desc.append(el("small","",labelForCategory(item.category)+(item.color?" · "+item.color:"")));
  const remove=el("button","remove-item","×");remove.type="button";remove.setAttribute("aria-label","Удалить "+(item.name||"вещь"));
  remove.addEventListener("click",async()=>{
   if(!confirm("Удалить «"+(item.name||"вещь")+"» из гардероба?"))return;
   try{await WardrobeDB.delete(item.id);await refreshWardrobe();toast("Вещь удалена.");}
   catch(err){toast("Не удалось удалить вещь.");}
  });
  card.append(thumb,desc,remove);grid.append(card);
 }
}
async function convertPhoto(file){
 if(!file)return null;
 if(file.size>32*1024*1024)throw Error("Файл слишком большой (более 32 МБ).");
 if(!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name||""))throw Error("Выбери изображение.");
 let bitmap=null,objectUrl="";
 try{
  if(typeof createImageBitmap==="function")bitmap=await createImageBitmap(file);
  else throw new Error("bitmap unavailable");
 }catch(_){
  objectUrl=URL.createObjectURL(file);
  bitmap=await new Promise((resolve,reject)=>{
   const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error("Не удалось открыть фото. Попробуй JPEG."));img.src=objectUrl;
  });
 }
 try{
  const w=bitmap.width||bitmap.naturalWidth,h=bitmap.height||bitmap.naturalHeight;
  if(!w||!h)throw Error("Изображение повреждено.");
  const max=840,scale=Math.min(1,max/Math.max(w,h)),canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const ctx=canvas.getContext("2d");if(!ctx)throw Error("Браузер не поддерживает обработку фото.");
  ctx.fillStyle="#f6f0fa";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",.72);
 }finally{
  if(bitmap&&typeof bitmap.close==="function")bitmap.close();
  if(objectUrl)URL.revokeObjectURL(objectUrl);
 }
}
async function onPhotoChange(event){
 const file=event.target.files&&event.target.files[0];if(!file)return;
 try{
  $("photo-label").textContent="Обрабатываю фото…";
  state.photo=await convertPhoto(file);
  const preview=$("photo-preview");preview.src=state.photo;preview.hidden=false;
  $("photo-label").textContent="Фото готово";
 }catch(err){state.photo=null;$("photo-preview").hidden=true;toast(err.message||"Не удалось прочитать фото.");$("photo-label").textContent="Выбрать фото";}
}
async function saveItem(event){
 event.preventDefault();
 const name=$("item-name").value.trim();if(!name){toast("Укажи название вещи.");return;}
 $("save-item").disabled=true;
 try{
  const item={id:Date.now()*100+Math.floor(Math.random()*100),name,category:$("item-category").value,
   color:$("item-color").value.trim(),season:[$("item-season").value],style:[],formality:Number($("item-formality").value),
   img:state.photo||"",createdAt:new Date().toISOString()};
  await WardrobeDB.add(item);
  if(typeof WardrobeDB.markInitialized==="function")WardrobeDB.markInitialized();
  state.photo=null;$("add-item-form").reset();$("photo-preview").hidden=true;$("photo-preview").removeAttribute("src");
  $("photo-input").value="";$("photo-label").textContent="Выбрать фото";
  await refreshWardrobe();toast("Добавлено в гардероб!");
 }catch(err){toast("Не удалось сохранить вещь: "+(err.message||"ошибка"));}
 finally{$("save-item").disabled=false;}
}
function readStyles(){
 const profile=getJSON("ai_profile",{});
 state.styleDNA=profile.styleDNA&&typeof profile.styleDNA==="object"?profile.styleDNA:{};
 const entries=Object.entries(state.styleDNA).filter(([k,v])=>STYLES.includes(k)&&Number(v)>0).sort((a,b)=>Number(b[1])-Number(a[1]));
 // If an existing quiz has all six nonzero, highlight meaningful top styles.
 const top=entries.filter(([,v])=>Number(v)>=18);
 state.selectedStyles=new Set((top.length?top:entries.slice(0,2)).map(([k])=>k));
 renderStyles();
}
function renderStyles(){
 for(const button of document.querySelectorAll(".style-card")){
  const active=state.selectedStyles.has(button.dataset.style);button.classList.toggle("selected",active);
  button.setAttribute("aria-pressed",String(active));
 }
}
function saveStyles(){
 if(!state.selectedStyles.size){toast("Выбери хотя бы один стиль.");return;}
 const weight=100/state.selectedStyles.size,dna={};
 for(const style of STYLES)dna[style]=state.selectedStyles.has(style)?Math.round(weight*100)/100:0;
 const profile=getJSON("ai_profile",{});profile.styleDNA=dna;
 if(saveJSON("ai_profile",profile)){state.styleDNA=dna;$("style-notice").textContent="Style DNA сохранён. Можно изменить в любой момент.";toast("Сохранено!");}
}
function addBubble(kind,text){
 const box=el("article","bubble "+kind);
 const label=el("div","bubble-label",kind==="user"?"ТЫ":kind==="local"?"ЛОКАЛЬНАЯ КАПСУЛА":"ELEGANCE AI");
 box.append(label,document.createTextNode(text));$("messages").append(box);scrollMessages();
 return box;
}
function scrollMessages(){const box=$("messages");box.scrollTop=box.scrollHeight;}
function setBusy(b){state.busy=b;$("send-button").disabled=b;$("prompt").disabled=b;$("send-button").textContent=b?"…":"➤";}
function getAccessCode(){try{return sessionStorage.getItem(STORAGE_ACCESS)||"";}catch(_){return "";}}
function saveAccess(){
 const code=$("access-code").value.trim();if(!code){toast("Введи код доступа.");return;}
 try{sessionStorage.setItem(STORAGE_ACCESS,code);$("access-code").value="";$("access-feedback").textContent="Код сохранён на время сессии.";$("access-panel").open=false;toast("AI-код сохранён.");}
 catch(_){toast("Не удалось сохранить код. Проверь настройки браузера.");}
}
function cleanWardrobeForAI(){
 return state.items.slice(0,180).map(item=>({id:String(item.id),name:item.name||"",category:item.category||"Інше",
 color:item.color||"",style:item.style||[],season:item.season||[],formality:item.formality}));
}
function createPiece(item){
 const box=el("div","mini-piece");const view=imageIsSafe(item.img)?displayPhoto(item):el("div","mini-placeholder","✦");
 box.append(view,el("small","",item.name||"Вещь"));return box;
}
function addResponse(result,source){
 const wrapper=el("article","capsule-response");
 wrapper.append(el("div","response-head",source==="ai"?"✦ ELEGANCE AI":"✦ ЛОКАЛЬНЫЙ ПОДБОР"));
 if(result.message)wrapper.append(el("p","",result.message));
 for(const outfit of result.outfits||[]){
  const card=el("div","outfit-card");card.append(el("h3","",outfit.name||"Образ"));
  const pieceRow=el("div","mini-pieces");const valid=[];
  for(const id of outfit.itemIds||[]){const item=itemById(id);if(item){valid.push(item);pieceRow.append(createPiece(item));}}
  if(valid.length)card.append(pieceRow);
  if(outfit.reason)card.append(el("p","",outfit.reason));
  const categories=valid.map(i=>i.category);
  const isFull=categories.includes("Взуття")&&(categories.includes("Сукня")||(categories.includes("Топ / Блуза")&&categories.includes("Брюки / Спідниця")));
  if(!isFull)card.append(el("p","needs","Комплект неполный: проверь наличие верха, низа или обуви."));
  wrapper.append(card);
 }
 if(result.packingIds&&result.packingIds.length){
  const items=result.packingIds.map(itemById).filter(Boolean);
  if(items.length)wrapper.append(el("div","packing-inline","Капсула: "+items.map(i=>i.name).join(" · ")));
 }
 if(result.missing&&result.missing.length)wrapper.append(el("div","needs","Дополнить гардероб: "+result.missing.join(", ")));
 $("messages").append(wrapper);scrollMessages();
}
function localCapsule(query){
 const match=query.match(/(\d{1,2})\s*(?:дн(?:ей|я|и|ь)|days)/i);
 const isTrip=/поездк|еду|лечу|путешеств|рейс|ручн|чемодан|чемод|турист|travel/i.test(query);
 const dinner=/свидан|ресторан|ужин|вечер|свадьб|торжеств|праздник/i.test(query);
 const count=match&&isTrip?Math.min(14,Math.max(1,Number(match[1]))):1;
 const now=new Date(),today=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));
 const days=[];
 for(let i=0;i<count;i++){
  const date=new Date(today.getTime()+i*86400000).toISOString().slice(0,10);
  days.push({date,occasions:[dinner?"dinner":"walk"],temperature:null});
 }
 const plan=TravelCapsule.plan({items:state.items,profile:{styleDNA:state.styleDNA},days,maxItems:isTrip?12:8,maxShoes:isTrip?2:1,laundry:false});
 const outfits=plan.days.map((d,i)=>({name:(count>1?"День "+(i+1):"Образ")+(dinner?" · вечер":""),
  itemIds:d.occasions[0].itemIds||[],reason:d.occasions[0].complete?"Из вещей твоего гардероба":"Не хватает подходящей одежды или обуви."}))
  .filter(o=>o.itemIds.length).slice(0,9);
 const message=isTrip?"Это пример локальной капсулы на "+count+" дн. без проверки прогноза и точных дат. Для полноценного планирования укажи даты поездки и подключи AI.":"Это предварительный локальный подбор по категориям, сезону и нарядности. AI-советы доступны после настройки кода.";
 const missing=plan.covered?[]:["Для части событий нет полного подходящего комплекта"];
 return {message,outfits,packingIds:plan.packingIds,missing};
}
function sanitizeResponse(result){
 if(!result||typeof result!=="object")throw Error("AI вернул неверный ответ.");
 const set=new Set(state.items.map(i=>String(i.id)));
 const outfits=(Array.isArray(result.outfits)?result.outfits:[]).slice(0,8).map(o=>({
  name:String(o.name||"Образ").slice(0,80),reason:String(o.reason||"").slice(0,280),
  itemIds:[...new Set((Array.isArray(o.itemIds)?o.itemIds:[]).map(String).filter(x=>set.has(x)))].slice(0,7)
 })).filter(o=>o.itemIds.length);
 return {message:String(result.message||"").slice(0,1600),outfits,packingIds:[...new Set(outfits.flatMap(o=>o.itemIds))],
 missing:(Array.isArray(result.missing)?result.missing:[]).slice(0,6).map(x=>String(x).slice(0,100))};
}
function savePlan(query,result,source){
 if(!result.outfits.length)return;
 const plan={id:Date.now(),query:query.slice(0,240),createdAt:new Date().toISOString(),source,
  message:result.message,outfits:result.outfits,packingIds:result.packingIds,missing:result.missing};
 state.plans.unshift(plan);state.plans=state.plans.slice(0,15);saveJSON(STORAGE_PLANS,state.plans);renderPlans();
}
async function askStylist(){
 if(state.busy)return;
 const query=$("prompt").value.trim();if(query.length<3){toast("Расскажи немного подробнее, какой образ нужен.");return;}
 $("prompt").value="";addBubble("user",query);setBusy(true);
 try{
  if(!state.items.length){addBubble("assistant","Сначала добавь несколько вещей в «Мой гардероб», чтобы я могла составлять реальные комплекты.");return;}
  const passcode=getAccessCode();
  if(!passcode){
   const local=localCapsule(query);addResponse(local,"local");savePlan(query,local,"local");
   $("access-panel").open=true;toast("Локальная капсула готова. Для AI подключи код доступа.");
   return;
  }
  const history=state.history.slice(-4);
  let res;
  try{
   const response=await fetch("/api/mobile-capsule",{method:"POST",headers:{"Content-Type":"application/json","X-Travel-Passcode":passcode},
    body:JSON.stringify({message:query,history,styleDNA:state.styleDNA,wardrobe:cleanWardrobeForAI()})});
   res=await response.json();
   if(!response.ok)throw Error(res.error||"Сервис недоступен.");
   const result=sanitizeResponse(res);addResponse(result,"ai");savePlan(query,result,"ai");
   state.history.push({role:"user",text:query},{role:"assistant",text:result.message});state.history=state.history.slice(-8);
  }catch(error){
   const local=localCapsule(query);local.message="AI сейчас недоступен ("+(error.message||"ошибка")+"). "+local.message;
   addResponse(local,"local");savePlan(query,local,"local");
   if(res&&res.code==="ACCESS_DENIED"){$("access-panel").open=true;try{sessionStorage.removeItem(STORAGE_ACCESS);}catch(_){}}
  }
 }catch(error){addBubble("assistant","Не удалось собрать капсулу: "+(error.message||"ошибка"));}
 finally{setBusy(false);}
}
function renderPlans(){
 const list=$("capsules-list");clear(list);
 if(!state.plans.length){list.append(el("p","empty","Пока нет сохранённых капсул. Начни с запроса AI-стилисту."));return;}
 for(const plan of state.plans){
  const card=el("article","saved-card");card.append(el("strong","",plan.query));
  let date="";try{date=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",year:"numeric"}).format(new Date(plan.createdAt));}catch(_){}
  card.append(el("small","",(date?date+" · ":"")+plan.outfits.length+" образов · "+(plan.source==="ai"?"AI":"Локальный подбор")));
  const open=el("button","soft-button","Открыть");open.type="button";open.onclick=()=>{
   showTab("chat");
   const result={message:plan.message,outfits:plan.outfits,packingIds:plan.packingIds,missing:plan.missing};
   addResponse(result,plan.source);
   if((plan.packingIds||[]).some(id=>!itemById(id)))toast("В гардеробе уже нет части вещей из этой капсулы.");
  };
  const remove=el("button","soft-button","Удалить");remove.type="button";remove.onclick=()=>{
   state.plans=state.plans.filter(x=>x.id!==plan.id);saveJSON(STORAGE_PLANS,state.plans);renderPlans();
  };
  card.append(open,remove);list.append(card);
 }
}
function connectivity(){
 const online=navigator.onLine!==false;
 $("connection-status").textContent=online?"● Онлайн":"● Офлайн";
 $("connection-status").style.color=online?"#b9d7bc":"#f3bd9b";
}
function initVoice(){
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 const mic=$("mic-button");if(!Speech)return;
 mic.hidden=false;
 let active=null;
 mic.addEventListener("click",()=>{
   if(active){active.stop();return;}
   const r=new Speech();active=r;r.lang=/^uk/i.test(navigator.language)?"uk-UA":"ru-RU";
   r.interimResults=false;r.continuous=false;r.maxAlternatives=1;
   r.onresult=(event)=>{
     const result=event.results&&event.results[0]&&event.results[0][0];
     if(result&&result.transcript){$("prompt").value=($("prompt").value.trim()+" "+result.transcript).trim();$("prompt").focus();}
   };
   r.onerror=()=>toast("Голосовой ввод недоступен. Напиши запрос текстом.");
   r.onend=()=>{active=null;mic.classList.remove("recording");mic.setAttribute("aria-label","Надиктовать запрос");};
   try{r.start();mic.classList.add("recording");mic.setAttribute("aria-label","Остановить диктовку");}
   catch(_){active=null;mic.classList.remove("recording");toast("Не получилось включить микрофон.");}
 });
}
function initInstall(){
 let deferred=null;
 window.addEventListener("beforeinstallprompt",ev=>{ev.preventDefault();deferred=ev;$("install-button").title="Установить приложение";});
 $("install-button").onclick=async()=>{
  if(deferred){deferred.prompt();try{await deferred.userChoice;}catch(_){}deferred=null;return;}
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
  if(ios)$("ios-install-hint").hidden=false;
  else toast("В меню браузера выбери «Установить приложение» или «Добавить на главный экран».");
 };
 $("dismiss-install").onclick=()=>$("ios-install-hint").hidden=true;
 if("serviceWorker" in navigator)window.addEventListener("load",()=>{
  navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
 });
}
async function boot(){
 for(const tab of document.querySelectorAll(".nav-tab"))tab.addEventListener("click",()=>showTab(tab.dataset.tab));
 for(const sample of document.querySelectorAll(".suggestion"))sample.addEventListener("click",()=>{$("prompt").value=sample.dataset.prompt;$("prompt").focus();});
 $("send-button").addEventListener("click",askStylist);
 $("prompt").addEventListener("keydown",event=>{if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();askStylist();}});
 $("save-access").addEventListener("click",saveAccess);
 $("photo-input").addEventListener("change",onPhotoChange);
 $("add-item-form").addEventListener("submit",saveItem);
 for(const button of document.querySelectorAll(".style-card"))button.addEventListener("click",()=>{
  const s=button.dataset.style;if(state.selectedStyles.has(s))state.selectedStyles.delete(s);else state.selectedStyles.add(s);renderStyles();
 });
 $("save-style").addEventListener("click",saveStyles);
 window.addEventListener("online",connectivity);window.addEventListener("offline",connectivity);connectivity();initInstall();initVoice();
 state.plans=getJSON(STORAGE_PLANS,[]);if(!Array.isArray(state.plans))state.plans=[];
 readStyles();renderPlans();
 try{await refreshWardrobe();}catch(error){toast("Ошибка гардероба: "+(error.message||"IndexedDB недоступна"));}
 if(getAccessCode())$("access-feedback").textContent="Код AI уже сохранён на время сессии.";
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();