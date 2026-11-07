import {authenticated,sameOrigin,sessionCookie,removeSessionCookie} from "../_lib/mobile-auth.js";
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Pragma":"no-cache","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
function reply(data,status=200,cookie=null){
 const h={...headers};if(cookie)h["Set-Cookie"]=cookie;
 return new Response(JSON.stringify(data),{status,headers:h});
}
export async function onRequestGet({request,env}){
 if(!sameOrigin(request))return reply({error:"Forbidden"},403);
 const configured=!!(env.TRAVEL_PWA_PASSCODE&&env.PWA_GEMINI_API_KEY);
 return reply({connected:configured&&await authenticated(request,env.TRAVEL_PWA_PASSCODE),configured});
}
export async function onRequestPost({request,env}){
 if(!sameOrigin(request))return reply({error:"Forbidden"},403);
 if(!env.TRAVEL_PWA_PASSCODE||!env.PWA_GEMINI_API_KEY)return reply({error:"В этом окружении Cloudflare AI пока не настроен.",code:"NOT_CONFIGURED"},503);
 if(Number(request.headers.get("Content-Length")||0)>1024)return reply({error:"Запрос слишком большой."},413);
 let code;
 try{const raw=await request.text();if(raw.length>1024)throw Error("size");code=JSON.parse(raw)?.passcode;}
 catch(_){return reply({error:"Неправильный запрос."},400);}
 // Match the user's one-time PWA code with the Cloudflare Preview secret.
 // Trim accidental whitespace around the value (including newlines copied into Secrets).
 // Never send the passcode or the Gemini key to the browser.
 const configuredPasscode=typeof env.TRAVEL_PWA_PASSCODE==="string"?env.TRAVEL_PWA_PASSCODE.trim():"";
 if(typeof code!=="string"||!code.trim()||code.length>256||code.trim()!==configuredPasscode)
  return reply({error:"Код не совпадает со значением TRAVEL_PWA_PASSCODE в этом Preview. Проверь именно значение секрета, не его название.",code:"ACCESS_DENIED"},401);
 return reply({connected:true},200,await sessionCookie(env.TRAVEL_PWA_PASSCODE));
}
export async function onRequestDelete({request}){
 if(!sameOrigin(request))return reply({error:"Forbidden"},403);
 return reply({connected:false},200,removeSessionCookie());
}
