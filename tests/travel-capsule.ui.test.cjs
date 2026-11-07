// No browser package needed: exercise actual HTML controller with Node's VM and DOM stubs.
// Run: node --test tests/travel-capsule.ui.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const TravelCapsule=require('../js/travel-capsule.js');

const html=fs.readFileSync(path.join(__dirname,'..','travel-capsule.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!source)throw new Error('Inline Travel Capsule controller not found');

const basicItems=[
  {id:1,name:'Біла сорочка',category:'Топ / Блуза',season:['spring'],formality:0.8,img:'data:image/png;base64,AAAA'},
  {id:2,name:'Брюки',category:'Брюки / Спідниця',season:['spring'],formality:0.8},
  {id:3,name:'Лофери',category:'Взуття',season:['spring'],formality:0.8},
  {id:4,name:'Сукня',category:'Сукня',season:['spring'],formality:0.9},
];
function setup(initialItems=basicItems){
  let wardrobe=structuredClone(initialItems);
  const elements=new Map(),storage=new Map(),requests=[],copied=[];
  function el(name){
    if(!elements.has(name))elements.set(name,{
      value:'',checked:false,hidden:false,disabled:false,innerHTML:'',textContent:'',
      events:{},addEventListener(type,fn){this.events[type]=fn}
    });
    return elements.get(name);
  }
  for(const [name,value] of Object.entries({city:'Kyiv',start:'2027-05-10',end:'2027-05-11',dinners:'1',maxItems:'12',maxShoes:'2',
    temp:'20',luggage:'cabin',weight:'',prompt:''})){el(name).value=value}
  const localStorage={
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value))
  };
  localStorage.setItem('ai_profile',JSON.stringify({styleDNA:{classic:80}}));
  const fetch=async url=>{
    requests.push(url);
    if(url.includes('geocoding'))return {ok:true,json:async()=>({results:[{latitude:50,longitude:14}]})};
    return {ok:true,json:async()=>({daily:{
      time:['2027-05-10','2027-05-11'],temperature_2m_min:[17,16],temperature_2m_max:[22,23],precipitation_probability_max:[0,20]
    }})};
  };
  const context={
    document:{getElementById:el},
    WardrobeDB:{async getAll(){return structuredClone(wardrobe)}},
    TravelCapsule, AIService:{async generateStructured(){return {city:'Prague',startDate:'2027-06-01',endDate:'2027-06-02',
      dinnerCount:1,maxItems:10,maxShoes:2,laundry:true};}},
    localStorage,fetch,navigator:{clipboard:{async writeText(value){copied.push(value)}}}, Intl,Date, console
  };
  vm.runInNewContext(source,context,{filename:'travel-capsule.html'});
  return {el,storage,requests,copied,changeWardrobe(value){wardrobe=structuredClone(value)},async click(id){await el(id).events.click()}};
}
test('generates clothing cards and calendar from existing IndexedDB-format items',async()=>{
  const a=setup();await a.click('generate');
  assert.equal(a.el('results').hidden,false);
  assert.match(a.el('packing').innerHTML,/Біла сорочка|Брюки/);
  assert.match(a.el('calendar').innerHTML,/Вечеря в ресторані/);
  assert.ok(a.storage.has('ee_travel_capsule_v1'));
});
test('restores the same wardrobe and copies packing checklist',async()=>{
  const a=setup();await a.click('generate');await a.click('restore');await a.click('copy');
  assert.match(a.el('message').textContent,/Завантажено/);
  assert.match(a.copied[0],/TRAVEL CAPSULE/);
});
test('rejects a cached outfit after an existing wardrobe item changes',async()=>{
  const a=setup();await a.click('generate');
  a.changeWardrobe(basicItems.map(item=>item.id===1?{...item,category:'Сукня',name:'Нова сукня'}:item));
  await a.click('restore');
  assert.match(a.el('message').textContent,/змінився|Перезбери/);
});
test('shows clear error when wardrobe has no clothes',async()=>{
  const a=setup([]);await a.click('generate');
  assert.match(a.el('message').textContent,/порожній/);
});
test('AI text parsing updates structured input fields, without submitting wardrobe',async()=>{
  const a=setup();a.el('prompt').value='Прага на два дні, один ресторан';
  await a.click('parse');
  assert.equal(a.el('city').value,'Prague');
  assert.equal(a.el('laundry').checked,true);
});
test('fetches weather for matching dates',async()=>{
  const a=setup();a.el('temp').value='';await a.click('generate');
  assert.ok(a.requests.some(url=>url.includes('open-meteo')));
  assert.match(a.el('calendar').innerHTML,/20°C|19°C/);
});
test('blocks generation without start date',async()=>{
  const a=setup();a.el('start').value='';await a.click('generate');
  assert.match(a.el('message').textContent,/дати/);
});
