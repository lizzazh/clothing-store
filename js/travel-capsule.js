/* Elizabeth's Elegance — Travel Capsule Engine. No external API dependency. */
(function(root){
const create=function travelCapsuleFactory(){
"use strict";
const catMap={"Сукня":"dress","Топ / Блуза":"top","Брюки / Спідниця":"bottom","Куртка / Пальто":"outer","Взуття":"shoes","Аксесуар":"accessory"};
function typeOf(item){
 const c=String(item.category||item.cat||"");
 if(catMap[c])return catMap[c];
 const n=String(item.name||"").toLowerCase();
 if(/сукня|плаття|dress/.test(n))return "dress";
 if(/кросів|кроссов|черевик|чобот|туфл|босон|сандал|sneaker|shoe|boot/.test(n))return "shoes";
 if(/брюк|штани|шорт|спідниц|юбк|jean|pant|skirt/.test(n))return "bottom";
 if(/куртк|пальт|плащ|пухов|кардиган|жакет|coat|jacket/.test(n))return "outer";
 if(/топ|футболк|сорочк|блуз|светр|свитер|hoodie|shirt/.test(n))return "top";
 return "unknown";
}
function normalize(items){
 return(items||[]).filter(x=>x&&x.id!=null).map(raw=>({
 id:String(raw.id),name:String(raw.name||"Без назви"),category:typeOf(raw),
 color:String(raw.color||""),style:Array.isArray(raw.style)?raw.style:typeof raw.style==="string"?[raw.style]:[],
 season:Array.isArray(raw.season)?raw.season:typeof raw.season==="string"?[raw.season]:[],
 formality:Number.isFinite(raw.formality)?raw.formality:null,
 weightGrams:Number.isFinite(raw.weightGrams)&&raw.weightGrams>0?raw.weightGrams:null
 })).filter(x=>x.category!=="unknown"&&x.category!=="accessory");
}
function seasonAt(date){
 const m=Number(String(date).slice(5,7));return m===12||m<=2?"winter":m<=5?"spring":m<=8?"summer":"autumn";
}
function matchesWeather(item,day){
 const season=seasonAt(day.date);
 if(item.season.length&& !item.season.includes(season) && !item.season.includes("all-season"))return false;
 const t=day.temperature;
 if(t===null||t===undefined||!Number.isFinite(Number(t)))return true;
 const num=Number(t);
 if(num>=27&&item.season.length===1&&item.season.includes("winter"))return false;
 if(num<=5&&item.season.length===1&&item.season.includes("summer"))return false;
 return true;
}
function formalSuitable(item,occasion){
 if(occasion!=="dinner")return true;
 if(item.formality!==null&&item.formality<0.45)return false;
 const name=item.name.toLowerCase();
 if(item.category==="shoes"&&/крос|sneaker|сланц|шльоп/.test(name))return false;
 return true;
}
function walkSuitable(item,occasion){
 return !(occasion==="walk"&&item.category==="shoes"&&/підбор|каблук|heels|шпильк/.test(item.name.toLowerCase()));
}
function rate(item,profile,day,occasion){
 const dna=profile&&profile.styleDNA||{};
 const weights=Object.entries(dna).filter(x=>typeof x[1]==="number").map(([k,v])=>[k.toLowerCase(),v]);
 let styleScore=0;
 if(weights.length&&item.style.length)styleScore=Math.max(...item.style.map(s=>(weights.find(x=>x[0]===s.toLowerCase())||["",0])[1]));
 const formal=item.formality===null?0.5:item.formality;
 const eventScore=occasion==="dinner"?formal:1-Math.max(0,formal-0.7);
 return styleScore*0.02+eventScore*2;
}
function defaultDays(startDate,endDate,dinnerCount=0){
 const valid=/^\d{4}-\d{2}-\d{2}$/;
 if(!valid.test(startDate)||!valid.test(endDate))throw Error("Вкажіть дати у форматі РРРР-ММ-ДД.");
 const a=Date.parse(startDate+"T00:00:00Z"),b=Date.parse(endDate+"T00:00:00Z");
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)throw Error("Неправильний діапазон дат.");
 const n=Math.round((b-a)/86400000);
 if(n>30)throw Error("MVP підтримує поїздки до 30 днів.");
 const days=[];
 for(let i=0;i<=n;i++){
   const date=new Date(a+i*86400000).toISOString().slice(0,10);
   days.push({date,occasions:["walk"],temperature:null,rain:null});
 }
 // Distribute dinner occasions instead of assigning every dinner to one day.
 const dc=Math.min(days.length,Math.max(0,Number(dinnerCount)||0));
 for(let j=0;j<dc;j++){
   const idx=Math.min(days.length-1,Math.floor((j+1)*days.length/(dc+1)));
   if(!days[idx].occasions.includes("dinner"))days[idx].occasions.push("dinner");
 }
 return days;
}
function plan(options){
 const trip=options||{},wardrobe=normalize(trip.items);
 if(!Array.isArray(trip.days)||!trip.days.length)throw Error("Не задані дні поїздки.");
 if(trip.days.length>31)throw Error("Підтримується не більше 31 дня.");
 const caps={top:trip.laundry?4:2,bottom:trip.laundry?8:4,dress:trip.laundry?4:2,shoes:999,outer:999};
 const count={},packing=new Map(),days=[],uncovered=[],notes=[];
 const maxItems=Math.max(1,Math.min(100,Number(trip.maxItems)||12));
 const maxShoes=Math.max(1,Math.min(8,Number(trip.maxShoes)||2));
 const maxWeightKg=Number(trip.maxWeightKg)>0?Number(trip.maxWeightKg):null;
 for(const day of trip.days){
  const outings=[];
  const occasions=Array.isArray(day.occasions)&&day.occasions.length?day.occasions:["walk"];
  for(const occasion of occasions){
    const eligible=wardrobe.filter(item=>matchesWeather(item,day)&&formalSuitable(item,occasion)&&walkSuitable(item,occasion));
    const group=(type)=>eligible.filter(i=>i.category===type).sort((a,b)=>rate(b,trip.profile,day,occasion)-rate(a,trip.profile,day,occasion)).slice(0,16);
    const tops=group("top"),bottoms=group("bottom"),dresses=group("dress"),shoes=group("shoes"),outers=group("outer");
    const needOuter=Number.isFinite(Number(day.temperature))&&day.temperature!==null&&Number(day.temperature)<14;
    const outerChoices=needOuter?outers:[null];
    const candidates=[];
    for(const shoe of shoes){
      for(const outer of outerChoices){
       if(needOuter&&!outer)continue;
       for(const dress of dresses)candidates.push([dress,shoe,...(outer?[outer]:[])]);
       for(const top of tops)for(const bottom of bottoms)candidates.push([top,bottom,shoe,...(outer?[outer]:[])]);
      }
    }
    let best=null,bestCost=Infinity;
    for(const set of candidates){
      const unique=[...new Set(set.map(i=>i.id))];if(unique.length!==set.length)continue;
      const next=new Set([...packing.keys(),...unique]);
      if(next.size>maxItems)continue;
      const shoesCount=wardrobe.filter(i=>next.has(i.id)&&i.category==="shoes").length;
      if(shoesCount>maxShoes)continue;
      if(set.some(i=>(count[i.id]||0)>=caps[i.category]))continue;
      const knownAll=[...next].every(id=>wardrobe.find(i=>i.id===id)?.weightGrams!==null);
      if(knownAll&&maxWeightKg!==null){
       const sum=[...next].reduce((s,id)=>s+(wardrobe.find(i=>i.id===id)?.weightGrams||0),0);
       if(sum>maxWeightKg*1000)continue;
      }
      const added=unique.filter(id=>!packing.has(id)).length;
      const quality=set.reduce((s,i)=>s+rate(i,trip.profile,day,occasion),0);
      const wears=set.reduce((s,i)=>s+(count[i.id]||0),0);
      const cost=added*16+set.length*0.3+wears*0.2-quality*0.9;
      if(cost<bestCost){best=set;bestCost=cost;}
    }
    if(!best){
      uncovered.push({date:day.date,occasion});
      outings.push({occasion,itemIds:[],complete:false});
    }else{
      for(const item of best){packing.set(item.id,item);count[item.id]=(count[item.id]||0)+1;}
      outings.push({occasion,itemIds:best.map(i=>i.id),complete:true});
    }
  }
  days.push({date:day.date,temperature:day.temperature??null,occasions:outings});
 }
 const selected=[...packing.values()];
 if(!wardrobe.some(i=>i.category==="shoes"))notes.push("У гардеробі немає взуття: комплект не можна завершити.");
 if(uncovered.length)notes.push("Не всі події покриті. Перевірте наявність потрібних категорій, кількість змін, ліміти та погодну придатність речей.");
 const allKnown=selected.every(i=>i.weightGrams!==null);
 const weightKg=selected.length&&allKnown?Number((selected.reduce((sum,i)=>sum+i.weightGrams,0)/1000).toFixed(2)):null;
 if(maxWeightKg!==null&&weightKg===null)notes.push("Вага деяких речей невідома: відповідність нормі багажу не підтверджена.");
 if(trip.days.some(d=>d.temperature===null||d.temperature===undefined))notes.push("Для частини днів немає прогнозу: погодну придатність потрібно перевірити.");
 return {days,packingIds:selected.map(i=>i.id),items:selected,weightKg,covered:!uncovered.length,uncovered,warnings:notes};
}
return {normalize,typeOf,defaultDays,plan};
};
const api=create();
if(typeof module!=="undefined"&&module.exports)module.exports=api;
else root.TravelCapsule=api;
})(typeof window!=="undefined"?window:globalThis);
