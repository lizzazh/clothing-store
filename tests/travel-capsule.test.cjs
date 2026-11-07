/* Run with: node --test tests/travel-capsule.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const Capsule = require('../js/travel-capsule.js');
const wardrobe = [
  { id: 1, name: 'Сорочка', category: 'Топ / Блуза', season: ['spring'], formality: 0.8, style: ['classic'] },
  { id: 2, name: 'Брюки', category: 'Брюки / Спідниця', season: ['spring'], formality: 0.7 },
  { id: 3, name: 'Лофери', category: 'Взуття', season: ['spring'], formality: 0.7 },
  { id: 4, name: 'Куртка', category: 'Куртка / Пальто', season: ['spring'], formality: 0.6 },
  { id: 5, name: 'Сукня', category: 'Сукня', season: ['spring'], formality: 0.9 }
];
test('dates are inclusive, dinner assignments are explicit', () => {
  const days=Capsule.defaultDays('2027-05-10','2027-05-12',1);
  assert.equal(days.length,3); assert.equal(days.flatMap(x=>x.occasions).filter(x=>x==='dinner').length,1);
});
test('rejects invalid date ranges', () => {
  assert.throws(()=>Capsule.defaultDays('2027-05-12','2027-05-10'));
  assert.throws(()=>Capsule.defaultDays('2027-05-10','2027-07-10'));
});
test('packs solely available items and covers a small trip', () => {
  const days=Capsule.defaultDays('2027-05-10','2027-05-12',1);
  const out=Capsule.plan({items:wardrobe,days,maxItems:5,maxShoes:1});
  assert.equal(out.covered,true); assert.ok(out.packingIds.length<=5);
  assert.ok(out.packingIds.every(id=>wardrobe.some(item=>String(item.id)===id)));
});
test('missing shoes never produces an invented outfit', () => {
  const out=Capsule.plan({items:wardrobe.filter(x=>x.category!=='Взуття'),
    days:Capsule.defaultDays('2027-05-10','2027-05-10',0)});
  assert.equal(out.covered,false); assert.equal(out.days[0].occasions[0].complete,false);
});
test('hard item limit is respected and uncovered slots are reported', () => {
  const out=Capsule.plan({items:wardrobe,days:Capsule.defaultDays('2027-05-10','2027-05-11'),maxItems:1});
  assert.ok(out.packingIds.length<=1); assert.equal(out.covered,false);
});
test('no arbitrary luggage-weight guarantee without measurements', () => {
  const out=Capsule.plan({items:wardrobe,days:Capsule.defaultDays('2027-05-10','2027-05-10'),maxWeightKg:8});
  assert.equal(out.weightKg,null); assert.ok(out.warnings.some(w=>w.includes('Вага')));
});
test('outer layer required below 14 C, missing outer returns incomplete outfit', () => {
  const days=Capsule.defaultDays('2027-05-10','2027-05-10');
  days[0].temperature=9;
  const out=Capsule.plan({items:wardrobe.filter(x=>x.category!=='Куртка / Пальто'),days});
  assert.equal(out.covered,false);
});
test('keeps the outfit complete in cold weather when outerwear exists', () => {
  const days=Capsule.defaultDays('2027-05-10','2027-05-10');
  days[0].temperature=9;
  const out=Capsule.plan({items:wardrobe,days});
  assert.equal(out.covered,true);
  assert.ok(out.days[0].occasions[0].itemIds.includes('4'));
});
test('categorizes native wardrobe values', () => {
 assert.equal(Capsule.typeOf({category:'Сукня'}),'dress');
 assert.equal(Capsule.typeOf({category:'Взуття'}),'shoes');
});
