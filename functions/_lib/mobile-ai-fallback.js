/* Optional server-side AI provider fallback for Elizabeth's Elegance Pocket Stylist.
 * OpenRouter is restricted to the zero-priced openrouter/free router.
 * Groq calls are ONLY enabled with explicit PWA_ALLOW_PAID_GROQ_FALLBACK=true.
 * Never log or return API keys, raw prompts, image data or provider error bodies.
 */
function parseJSON(value){
 if(value&&typeof value==="object"&&!Array.isArray(value))return value;
 if(typeof value!=="string"||!value.trim())return null;
 const trimmed=value.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\x60\x60\x60\s*$/,"").trim();
 try{return JSON.parse(trimmed)}catch(_){}
 const start=trimmed.indexOf("{"),end=trimmed.lastIndexOf("}");
 if(start<0||end<start)return null;
 try{return JSON.parse(trimmed.slice(start,end+1))}catch(_){return null}
}
export function pwaFallbackEnabled(env){
 return !!(env?.PWA_OPENROUTER_API_KEY||(
   env?.PWA_GROQ_API_KEY&&env?.PWA_ALLOW_PAID_GROQ_FALLBACK==="true"));
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
  ? [{type:"text",text:instruction+"
Return ONLY JSON, with all requested fields and no markdown."},
     {type:"image_url",image_url:{url:imageData}}]
  : instruction+"
Return ONLY a valid JSON object, without markdown.
"+input;
 for(const selected of providers){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetcher(selected.url,{
    method:"POST",signal:controller.signal,
    headers:{"Authorization":"Bearer "+selected.key,"Content-Type":"application/json"},
    body:JSON.stringify({
     model:selected.model,messages:[{role:"user",content}],
     max_tokens:task==="vision"?850:1850,temperature:0.2
    })
   });
   if(!response.ok)continue;
   const data=await response.json();
   const parsed=parseJSON(data?.choices?.[0]?.message?.content);
   if(!parsed||typeof validator==="function"&&!validator(parsed))continue;
   return {data:parsed,provider:selected.provider};
  }catch(_){
   // A provider can be unavailable or reject JSON. Try another if configured.
  }finally{clearTimeout(timeout)}
 }
 return null;
}
