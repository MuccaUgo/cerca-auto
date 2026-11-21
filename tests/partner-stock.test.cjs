const {test}=require('node:test'), assert=require('node:assert/strict');
const {partnerCar,collectPartnerStock,groupPartnerStock,reconcileSubito,PARTNER_SOURCE}=require('../supabase/functions/cerca-auto/partner.ts');
const uuid='11111111-1111-4111-8111-111111111111';
function row(id='55555555',changes={}) {
  return {subito_id:id,listing:{url:'https://www.subito.it/auto/fiat-panda-milano-'+id+'.htm?foo=1',
    sellerName:'Salone Uno',autoscoutSellerId:'123',brand:'Fiat',model:'Panda',ver:'1.0 Hybrid',reg:'03/2024',year:2024,
    price:7990,pricing:'finance',gear:'Manuale',fuel:'Ibrida',cv:69,km:50200,postcode:'20100',countryCode:'IT',...changes}};
}
function base(changes={}) {
  return {...partnerCar(row()),portal:'autoscout24',url:'https://www.autoscout24.it/annunci/panda-'+uuid,
    src:'Salone Uno',id:uuid,price:9490,real:true,note:'',km:50000,...changes};
}
for(const [method,identity,changes] of [
  ['reference',{}, {autoscoutListingId:uuid}],
  ['stock',{stock:'ab-001'}, {stock:'AB-001'}],
  ['VIN',{vin:'ZFA01234567890123'}, {vin:'ZFA01234567890123'}]
]) test('confirmed '+method+' retains links, terms and stable alert keys',()=>{
  const cars=groupPartnerStock([base({matchIdentity:identity})],[partnerCar(row(undefined,changes))]);
  assert.equal(cars.length,1);const [c]=cars;
  assert.deepEqual(c.offers.map(x=>x.price),[9490,7990]);assert.equal(c.real,true);
  assert.equal(c.offers[0].real,true);assert.match(c.offers[1].note,/finanziamento/);
  assert.equal(c.offers[1].url,'https://www.subito.it/auto/fiat-panda-milano-55555555.htm');
  assert.deepEqual(c.aliases,['Salone Uno|'+uuid,'Subito Lombardia|55555555',PARTNER_SOURCE+'|55555555']);
  assert.ok(!JSON.stringify(c).includes('matchIdentity'));assert.equal(c.src,'Salone Uno');
});
test('similar cars remain separate, indexed by seller, month, version, power and mileage',()=>{
  const data=groupPartnerStock([base(),base({id:'outside',km:67000})],[partnerCar(row())]);
  assert.equal(data.length,3);assert.equal(data[0].possibleMatches[0].portal,'subito');
  assert.equal(data[1].possibleMatches,undefined);assert.equal(data[2].possibleMatches.length,1);
  for (const change of [{sellerType:'private'},{sellerId:'other'},{reg:'2024'},{ver:''},{gear:'Automatico'},{cv:71},{km:0}]) {
    assert.ok(!groupPartnerStock([base(change)],[partnerCar(row())])[0].possibleMatches);
  }
});
test('ambiguous and conflicting strong evidence never auto-merges',()=>{
  const stocked=()=>base({matchIdentity:{stock:'AA01'}});
  const partner=(fields)=>partnerCar(row(undefined,{stock:'AA01',...fields}));
  assert.equal(groupPartnerStock([stocked(),{...stocked(),id:'other'}],[partner()]).length,3);
  assert.equal(groupPartnerStock([stocked()],[partner({reg:'10/2024'})]).length,2);
  assert.equal(groupPartnerStock([stocked()],[partner({autoscoutSellerId:'999'})]).length,2);
  assert.equal(groupPartnerStock([base({matchIdentity:{vin:'ZFA01234567890123'}})],[partner({vin:'ZFA01234567890999',autoscoutListingId:uuid})]).length,2);
});
test('scope and URLs validated, no invented financing amount, partial feeds surface errors',async()=>{
  assert.equal(partnerCar(row(undefined,{postcode:'28100'})),null);
  assert.equal(partnerCar(row(undefined,{countryCode:'CH'})),null);
  assert.throws(()=>partnerCar(row(undefined,{url:'https://www.subito.it.attacker.example/auto/car-55555555.htm'})));
  assert.throws(()=>partnerCar(row(undefined,{url:'https://www.subito.it/auto/car-66666666.htm'})));
  assert.equal(partnerCar(row()).cash,undefined);assert.equal(partnerCar(row(undefined,{cash:9490})).cash,9490);
  const partial=await collectPartnerStock(async()=>[row(),row('not-an-id')]);
  assert.equal(partial.cars.length,1);assert.equal(partial.complete,false);
  assert.equal((await collectPartnerStock(async()=>{throw Error()})).complete,false);
  const empty=await collectPartnerStock(async()=>[]);assert.equal(empty.complete,true);assert.equal(empty.cars.length,0);
});
test('direct copy of an authorized dealer offer keeps one price snapshot and both historic keys',()=>{
  const feed=partnerCar(row(undefined,{autoscoutListingId:uuid,cash:11400,city:'Milano'}));
  const live={...feed,src:'Subito Lombardia',sellerId:'sub:shop:123',matchIdentity:undefined,price:8500,cash:undefined,real:true,note:''};
  const combined=reconcileSubito([live],[feed]);assert.equal(combined.length,1);assert.equal(combined[0].cash,undefined);
  const [group]=groupPartnerStock([base()],combined);assert.equal(group.offers.length,2);assert.equal(group.offers[1].price,8500);
  assert.equal(group.offers[1].real,false);assert.match(group.offers[1].note,/da verificare/);
  assert.ok(group.aliases.includes('Subito Lombardia|55555555'));assert.ok(group.aliases.includes(PARTNER_SOURCE+'|55555555'));
});
test('unmapped portal seller identifiers cannot confirm a car, even with same specs; a named dealer and town can suggest it',()=>{
  const feed=partnerCar(row(undefined,{city:'Milano (MI)'}));
  const live={...feed,src:'Subito Lombardia',sellerId:'sub:shop:123',matchIdentity:undefined};
  const cars=groupPartnerStock([base({city:'Milano',sellerId:'123'})],[live]);assert.equal(cars.length,2);
  assert.equal(cars[0].possibleMatches[0].src,'Subito Lombardia');assert.ok(!cars[0].offers);
  const privateAd={...live,sellerType:'private',sellerName:'Privato',sellerId:'sub:ad:55555555',possibleMatches:undefined};
  assert.ok(!groupPartnerStock([base({city:'Milano'})],[privateAd])[0].possibleMatches);
});
