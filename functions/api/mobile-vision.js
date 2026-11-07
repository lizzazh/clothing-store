import {authenticated,sameOrigin} from "../_lib/mobile-auth.js";
// Server-side image analysis for the mobile wardrobe.
// Image is sent to Gemini for inference only; no database or image persistence.
const OUT_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:OUT_HEADERS});
const CATEGORIES=["Сукня","Топ / Блуза","Брюки / Спідниця","Куртка / Пальто","Взуття","Аксесуар","Інше"];
const STYLES=["classic","boho","minimalist","romantic","streetwear","elegant"];
const SEASONS=["spring","summer","autumn","winter","all-season"];
const clip=(x,n)=>typeof x==="string"?x.trim().slice(0,n):"";
function extractJSON(raw){
 const text=clip(raw,15000).replace(/^\x60\x60\x60(?:json)?/i,"").replace(/\x60\x60\x60$/,"").trim();
 try{return JSON.parse(text);}catch(_){const start=text.indexOf("{"),end=text.lastIndexOf("}");if(start<0||end<start)return null;try{return JSON.parse(text.slice(start,end+1));}catch(_){return null;}}
}
function sanitize(data){
 if(!data||typeof data!=="object"||Array.isArray(data))return null;
 const category=CATEGORIES.includes(data.category)?data.category:"Інше";
 const style=Array.isArray(data.style)?[...new Set(data.style.filter(s=>STYLES.includes(s)))].slice(0,3):[];
 const season=Array.isArray(data.season)?[...new Set(data.season.filter(s=>SEASONS.includes(s)))].slice(0,4):[];
 const formality=typeof data.formality==="number"&&Number.isFinite(data.formality)?Math.max(0,Math.min(1,data.formality)):0.5;
 const rawConf=typeof data.confidence==="number"&&Number.isFinite(data.confidence)?data.confidence:0.5;
 return {name:clip(data.name,80)||"Предмет одежды",category,color:clip(data.color,35),season:season.length?season:["all-season"],style,formality,confidence:Math.min(1,Math.max(0,rawConf)),warning:clip(data.warning,250)};
}
export async function onRequestPost({request,env}){
 try{
  const origin=request.headers.get("Origin");
  if(origin&&new URL(origin).origin!==new URL(request.url).origin)return reply({error:"Этот источник не разрешён."},403);
  if(request.headers.get("Sec-Fetch-Site")==="cross-site")return reply({error:"Этот источник не разрешён."},403);
 }catch(_){return reply({error:"Неверный Origin."},403);}
 const key=env.PWA_GEMINI_API_KEY;
 if(!env.TRAVEL_PWA_PASSCODE||!key)return reply({error:"AI не настроен в этом окружении Cloudflare.",code:"NOT_CONFIGURED"},503);
 if(!await authenticated(request,env.TRAVEL_PWA_PASSCODE))return reply({error:"Войди в AI один раз в настройках приложения.",code:"ACCESS_DENIED"},401);
 if(Number(request.headers.get("Content-Length")||0)>2000000)return reply({error:"Фото слишком большое для анализа."},413);
 let imageData;
 try{
  const body=await request.text();
  if(body.length>2000000)return reply({error:"Фото слишком большое для анализа."},413);
  const parsed=JSON.parse(body);
  imageData=parsed&&parsed.imageData;
 }catch(_){return reply({error:"Неверный формат изображения."},400);}
 if(typeof imageData!=="string"||imageData.length>1900000||!/^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(imageData))
  return reply({error:"Нужно фото JPEG. Попробуй выбрать другое изображение."},400);
 const base64=imageData.slice("data:image/jpeg;base64,".length);
 const model=clip(env.PWA_GEMINI_MODEL,60)||"gemini-2.5-flash";
 const instruction=[
  "Identify the primary clothing item shown in this image. Never identify people, faces, gender, identity, or other private details.",
  "Return only a valid JSON object with these exact keys: name, category, color, season, style, formality, confidence, warning.",
  "Name and visible color should be Russian. Use a short specific generic name; no invented brands or unseen fabric details.",
  "category must be one of: "+CATEGORIES.join(" | ")+".",
  "season must be an array of applicable seasons from: "+SEASONS.join(" | ")+". Use all-season for versatile items, or 1-3 seasons if supported visually.",
  "style must be an array of 0-3 matching values from: "+STYLES.join(" | ")+".",
  "formality numeric 0..1; 0=sportswear, 0.5=casual, 1=very formal.",
  "confidence number 0..1 indicating uncertainty. If image is unclear or contains multiple garments, set warning in Russian and lower confidence. Never claim certainty."
 ].join("\n");
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
   method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json","X-goog-api-key":key},
   body:JSON.stringify({contents:[{parts:[{text:instruction},{inline_data:{mime_type:"image/jpeg",data:base64}}]}],
     generationConfig:{responseMimeType:"application/json",temperature:0.15,maxOutputTokens:500}})
  });
  if(!response.ok)return reply({error:response.status===429?"Лимит AI-запросов исчерпан. Заполни поля вручную или попробуй позже.":"AI не смог распознать фото. Можно заполнить поля вручную."},response.status===429?429:502);
  const result=await response.json();
  const raw=(result?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("");
  const metadata=sanitize(extractJSON(raw));
  if(!metadata)return reply({error:"AI не вернул корректное описание. Заполни поля вручную."},502);
  return reply({item:metadata});
 }catch(error){return reply({error:error?.name==="AbortError"?"Распознавание заняло слишком много времени. Попробуй ещё раз.":"Не удалось связаться с AI. Заполни поля вручную."},504);}
 finally{clearTimeout(timer);}
}
export function onRequestGet(){return reply({error:"Use POST"},405);}
