/* Optional, server-side OpenRouter Free AI fallback.
 * Never log, store or echo secrets, photos, prompts or full provider responses.
 * Free models can reject requests even when API credentials are configured.
 * Groq is called ONLY after explicit PWA_ALLOW_PAID_GROQ_FALLBACK=true.
 */
function parseJSON(value){
 if(value&&typeof value==="object"&&!Array.isArray(value))return value;
 if(Array.isArray(value))value=value.filter(v=>v?.type==="text"&&typeof v.text==="string").map(v=>v.text).join("");
 if(typeof value!=="string"||!value.trim())return null;
 const clean=value.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\x60\x60\x60\s*$/,"").trim();
 try{return JSON.parse(clean);}catch(_){}
 const start=clean.indexOf("{"),end=clean.lastIndexOf("}");
 if(start<0||end<start)return null;
 try{return JSON.parse(clean.slice(start,end+1));}catch(_){return null;}
}
export function pwaFallbackEnabled(env){
 return !!(env?.PWA_OPENROUTER_API_KEY||(env?.PWA_GROQ_API_KEY&&env?.PWA_ALLOW_PAID_GROQ_FALLBACK==="true"));
}
function providerFailure(status,provider){
 const name=provider==="OpenRouter Free"?"OpenRouter Free":"Groq";
 if(status===401||status===403)return {code:"FALLBACK_AUTH",error:name+" отклонил ключ доступа (HTTP "+status+"). Проверь секрет в Cloudflare Preview.",status};
 if(status===402)return {code:"FALLBACK_CREDITS",error:name+" отклонил запрос из-за лимита кредитов (HTTP 402). Проверь лимит ключа и состояние аккаунта.",status};
 if(status===429)return {code:"FALLBACK_RATE_LIMIT",error:name+" достиг лимита запросов (HTTP 429). Не повторяй сейчас: бесплатная квота или мощность модели ограничена.",status};
 if(status===400||status===422)return {code:"FALLBACK_INVALID_REQUEST",error:name+" не принял изображение или формат запроса (HTTP "+status+").",status};
 if(status===404)return {code:"FALLBACK_MODEL_UNAVAILABLE",error:name+" не нашёл доступную модель для запроса (HTTP 404).",status};
 if(status>=500)return {code:"FALLBACK_PROVIDER_UNAVAILABLE",error:name+" временно недоступен (HTTP "+status+"). Попробуй позже.",status};
 return {code:"FALLBACK_HTTP_ERROR",error:name+" отклонил запрос (HTTP "+status+").",status};
}
export async function tryPwaFallback({env,task,instruction,input,imageData=null,validator,fetcher=fetch,timeoutMs=14000}){
 if(!["vision","capsule"].includes(task))throw Error("Invalid fallback task");
 const providers=[];
 if(env?.PWA_OPENROUTER_API_KEY)providers.push({
  provider:"OpenRouter Free",url:"https://openrouter.ai/api/v1/chat/completions",
  key:env.PWA_OPENROUTER_API_KEY,model:"openrouter/free"
 });
 if(env?.PWA_GROQ_API_KEY&&env?.PWA_ALLOW_PAID_GROQ_FALLBACK==="true")providers.push({
  provider:"Groq",url:"https://api.groq.com/openai/v1/chat/completions",
  key:env.PWA_GROQ_API_KEY,model:task==="vision"?"qwen/qwen3.8-27b":"openai/gpt-oss-20b"
 });
 const content=task==="vision"
  ? [{type:"text",text:instruction+"\nReturn ONLY valid JSON with the requested garment fields."},
     {type:"image_url",image_url:{url:imageData}}]
  : instruction+"\nReturn ONLY a valid JSON object, without markdown.\n"+input;
 let failure=null;
 for(const selected of providers){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetcher(selected.url,{
    method:"POST",signal:controller.signal,
    headers:{"Authorization":"Bearer "+selected.key,"Content-Type":"application/json"},
    body:JSON.stringify({
     model:selected.model,messages:[{role:"user",content}],
     max_tokens:task==="vision"?1024:1850,temperature:0.2
    })
   });
   if(!response.ok){
    failure={...providerFailure(response.status,selected.provider),provider:selected.provider};
    // Don't read the upstream response body; it may contain personal or sensitive details.
    continue;
   }
   const data=await response.json();
   const parsed=parseJSON(data?.choices?.[0]?.message?.content);
   if(!parsed||(typeof validator==="function"&&!validator(parsed))){
    failure={code:"FALLBACK_INVALID_OUTPUT",error:selected.provider+" ответил, но не вернул корректные характеристики. Бесплатная модель могла обрезать JSON.",status:502,provider:selected.provider};
    continue;
   }
   return {data:parsed,provider:selected.provider};
  }catch(error){
   const timedOut=error?.name==="AbortError";
   failure={
    code:timedOut?"FALLBACK_TIMEOUT":"FALLBACK_CONNECTION",
    error:selected.provider+(timedOut?" не ответил вовремя. Попробуй позже.":" недоступен из-за ошибки соединения. Попробуй позже."),
    status:timedOut?504:502,provider:selected.provider
   };
  }finally{clearTimeout(timeout);}
 }
 return failure?{failure}:null;
}
