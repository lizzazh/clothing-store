/* Elizabeth's Elegance Pocket Stylist — browser app, no framework/build step. */
(function(){
"use strict";
const $ = id => document.getElementById(id);
const STORAGE_PLANS = "ee_mobile_capsules_v1";
const STORAGE_ACCESS = "ee_mobile_ai_passcode";
const STORAGE_VISION_CONSENT = "ee_mobile_vision_consent_v1";
const STYLES = ["classic","minimalist","romantic","elegant","streetwear","boho"];
const state = { items:[], styleDNA:{}, selectedStyles:new Set(), plans:[], history:[], photo:null, photoEpoch:0, recognitionBusy:false, recognitionPrediction:null, busy:false, installPrompt:null };
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
function visionStatus(message,warning=false){
 const n=$("recognition-status");n.textContent=message;
 n.classList.toggle("vision-warning",warning);
}
function visionReady(){ $("recognize-photo").disabled=!state.photo||state.recognitionBusy; }
async function recognizePhoto(){
 if(!state.photo){visionStatus("Сначала выбери фото вещи.",true);return;}
 // Explicit button click also counts as the user's opt-in after viewing the disclosure.
 if(!$("vision-auto").checked){
  $("vision-auto").checked=true;
  try{localStorage.setItem(STORAGE_VISION_CONSENT,"true");}catch(_){}
 }
 const passcode=getAccessCode();
 if(!passcode){visionStatus("Для AI нужен код. Введи его в поле выше и нажми «Код AI».",true);return;}
 if(state.recognitionBusy)return;
 const requestId=++state.photoEpoch;
 const imageData=state.photo;
 const previous={
  name:$("item-name").value,category:$("item-category").value,color:$("item-color").value,
  season:$("item-season").value,style:$("item-style").value,formality:$("item-formality").value
 };
 state.recognitionBusy=true;visionReady();$("save-item").disabled=true;
 visionStatus("✦ Gemini анализирует фото…");
 try{
  const response=await fetch("/api/mobile-vision",{
   method:"POST",
   headers:{"Content-Type":"application/json","X-Travel-Passcode":passcode},
   body:JSON.stringify({imageData})
  });
  const data=await response.json();
  if(requestId!==state.photoEpoch||state.photo!==imageData)return; // discarded stale photo
  if(!response.ok){
   if(data&&data.code==="ACCESS_DENIED"){
    try{sessionStorage.removeItem(STORAGE_ACCESS);}catch(_){}
   }
   throw Error((data&&data.error)||"Не удалось распознать вещь.");
  }
  const result=data&&data.item;
  if(!result||typeof result!=="object")throw Error("AI не вернул характеристики.");
  const safeStyles=["classic","minimalist","romantic","elegant","streetwear","boho"];
  const safeSeasons=["all-season","spring","summer","autumn","winter"];
  const safeCategories=["Топ / Блуза","Брюки / Спідниця","Сукня","Куртка / Пальто","Взуття","Аксесуар","Інше"];
  const seasons=Array.isArray(result.season)?result.season.filter(x=>safeSeasons.includes(x)):[];
  const styles=Array.isArray(result.style)?result.style.filter(x=>safeStyles.includes(x)):[];
  const category=safeCategories.includes(result.category)?result.category:"Інше";
  const mainSeason=seasons.includes("all-season")?"all-season":seasons[0]||"all-season";
  const mainStyle=styles[0]||"";
  const f=Number(result.formality),confidence=Number(result.confidence);
  const formality=Number.isFinite(f)?f>=0.72?"0.85":f<0.33?"0.2":"0.5":"0.5";
  // Keep user changes made while the request was in flight.
  const changes={name:result.name||"",category,color:result.color||"",season:mainSeason,style:mainStyle,formality};
  const fields={name:"item-name",category:"item-category",color:"item-color",season:"item-season",style:"item-style",formality:"item-formality"};
  for(const [k,value] of Object.entries(changes)){
   const input=$(fields[k]);
   if(String(input.value)===String(previous[k])&&value)input.value=String(value);
  }
  state.recognitionPrediction={season:seasons,style:styles,seasonSelected:mainSeason,styleSelected:mainStyle};
  const percent=Number.isFinite(confidence)?Math.round(Math.max(0,Math.min(1,confidence))*100):null;
  const caution=result.warning?String(result.warning).slice(0,240):"";
  visionStatus("✓ AI заполнил характеристики"+(percent===null?"":". Уверенность: "+percent+"%")+
   ". Проверь поля перед сохранением."+(caution?" "+caution:""),percent!==null&&percent<60);
 }catch(error){
  if(requestId===state.photoEpoch)visionStatus((error&&error.message||"AI недоступен.")+" Все поля можно заполнить вручную.",true);
 }finally{
  if(requestId===state.photoEpoch){state.recognitionBusy=false;visionReady();$("save-item").disabled=false;}
 }
}
async function onPhotoChange(event){
 const file=event.target.files&&event.target.files[0];if(!file)return;
 const token=++state.photoEpoch;
 state.photo=null;state.recognitionBusy=false;state.recognitionPrediction=null;$("save-item").disabled=false;visionReady();
 $("photo-preview").hidden=true;$("photo-label").textContent="Обрабатываю фото…";
 visionStatus("Фото будет сохранено локально. AI распознавание доступно после согласия.");
 try{
  const photo=await convertPhoto(file);
  if(token!==state.photoEpoch)return;
  state.photo=photo;const preview=$("photo-preview");preview.src=photo;preview.hidden=false;
  $("photo-label").textContent="Фото готово";visionReady();
  if($("vision-auto").checked)await recognizePhoto();
 }catch(error){
  if(token!==state.photoEpoch)return;
  state.photo=null;$("photo-preview").hidden=true;$("photo-label").textContent="Выбрать фото";
  visionReady();visionStatus(error&&error.message||"Не удалось прочитать фото.",true);
 }
}
async function saveItem(event){
 event.preventDefault();
 if(state.recognitionBusy){toast("Дождись распознавания или отключи AI и загрузи фото заново.");return;}
 const name=$("item-name").value.trim();if(!name){toast("Укажи название вещи.");return;}
 $("save-item").disabled=true;
 try{
  const currentSeason=$("item-season").value,currentStyle=$("item-style").value;
  const ai=state.recognitionPrediction;
  const season=ai&&currentSeason===ai.seasonSelected&&ai.season.length?ai.season:[currentSeason];
  const style=ai&&currentStyle===ai.styleSelected&&ai.style.length?ai.style:(currentStyle?[currentStyle]:[]);
  const item={id:Date.now()*100+Math.floor(Math.random()*100),name,category:$("item-category").value,
   color:$("item-color").value.trim(),season,style,formality:Number($("item-formality").value),
   img:state.photo||"",createdAt:new Date().toISOString()};
  await WardrobeDB.add(item);
  if(typeof WardrobeDB.markInitialized==="function")WardrobeDB.markInitialized();
  state.photo=null;state.photoEpoch++;state.recognitionPrediction=null;
  $("add-item-form").reset();
  $("vision-auto").checked=localStorage.getItem(STORAGE_VISION_CONSENT)==="true";
  $("photo-preview").hidden=true;$("photo-preview").removeAttribute("src");
  $("photo-input").value="";$("photo-label").textContent="Выбрать фото";
  visionReady();visionStatus("Вещь сохранена. Добавь следующее фото.");
  await refreshWardrobe();toast("Добавлено в гардероб!");
 }catch(error){toast("Не удалось сохранить вещь: "+(error.message||"ошибка"));}
 finally{$("save-item").disabled=false;}
}
function saveVisionAccess(){
 const code=$("vision-access-code").value.trim();
 if(!code){visionStatus("Введи код доступа к AI.",true);return;}
 try{
  sessionStorage.setItem(STORAGE_ACCESS,code);
  $("vision-access-code").value="";
  visionStatus("Код сохранён на время сессии. Можно распознавать вещи.");
  if(state.photo&&$("vision-auto").checked)recognizePhoto();
 }catch(_){visionStatus("Не удалось сохранить код. Проверь настройки браузера.",true);}
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
 $("recognize-photo").addEventListener("click",recognizePhoto);
 $("vision-save-access").addEventListener("click",saveVisionAccess);
 $("vision-auto").checked=localStorage.getItem(STORAGE_VISION_CONSENT)==="true";
 $("vision-auto").addEventListener("change",()=>{
   try{localStorage.setItem(STORAGE_VISION_CONSENT,$("vision-auto").checked?"true":"false");}catch(_){}
   if($("vision-auto").checked&&state.photo)recognizePhoto();
   else if(!$("vision-auto").checked){state.photoEpoch++;state.recognitionBusy=false;$("save-item").disabled=false;visionReady();visionStatus("Распознавание отключено. Фото остаётся на устройстве.");}
 });
 visionReady();
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