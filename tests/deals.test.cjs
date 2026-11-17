const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Deals=require('../deals.js');
const source=fs.readFileSync(require.resolve('../index.html'),'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const context={module:{exports:{}},CarDeals:Deals,URL};
vm.runInNewContext(source,context);
const {applyFilters,DEFAULTS,formatListingsForAI}=context.module.exports;
function car(id,changes={}){
  return {id,src:'Venditore '+id,brand:'Fiat',model:'Panda',ver:'1.0 Hybrid',year:2023,reg:'01/2023',km:50000,cv:70,fuel:'Ibrida',fuelLabel:'Ibrida Benzina',gear:'Manuale',body:'City car',price:11000,url:'https://example.com/auto/'+id,res:false,note:'',real:true,...changes};
}
function market(changes={}){return [car('pick',{price:9000,...changes}),car('a',{price:11000,year:2022,km:60000}),car('b',{price:11500,year:2021,km:70000}),car('c',{price:12000,km:80000})];}
test('signals a cheaper car against at least three older or equally new, more driven alternatives',()=>{
  const data=market(),d=Deals.calculate(data,2026)[Deals.key(data[0])];
  assert.equal(d.reference,11500);assert.equal(d.peers,3);assert.equal(d.sellers,3);assert.equal(d.saving,2500);
  assert.deepEqual(Deals.calculate([...data].reverse(),2026),Deals.calculate(data,2026));
});
test('a low price caused by greater age or mileage is not a deal',()=>{
  for(const changes of [{year:2020},{km:90000}]){
    const data=market(changes);assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])],undefined);
  }
});
test('finance price never substitutes for cash and budget follows cash in deal mode',()=>{
  const data=market({price:7500,cash:12000}),ratings=Deals.calculate(data,2026);
  assert.equal(ratings[Deals.key(data[0])],undefined);
  const state={...DEFAULTS,price:10000,sort:'deal'};
  assert.equal(applyFilters(data,state,ratings).length,0);
  assert.equal(applyFilters(data,{...state,sort:'price'},ratings).length,1);
  assert.equal(Deals.price(car('invalid',{cash:'non indicato'})).toString(),'NaN');
});
test('duplicate URLs and a single seller cannot manufacture the comparison sample',()=>{
  const data=market();data[3]={...data[2],id:'copy',src:'Altro',url:data[2].url+'?tracking=1'};
  assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])],undefined);
  const oneSeller=market().map((c,i)=>i?{...c,src:'Unico salone'}:c);
  assert.equal(Deals.calculate(oneSeller,2026)[Deals.key(oneSeller[0])],undefined);
});
test('limits each seller to three comparisons and ignores source order',()=>{
  const data=market();for(let i=0;i<6;i++) data.push(car('stock'+i,{src:data[1].src,price:16000,km:85000+i}));
  const d=Deals.calculate(data,2026)[Deals.key(data[0])];
  assert.equal(d.peers,5);assert.equal(d.sellers,3);
});
test('reserved, uncertain, commercial and incomplete listings receive no badge',()=>{
  const invalid=[{id:null},{id:''},{res:true},{note:'Prezzo da verificare'},{ver:'1.0 Hybrid VAN'},{body:'Furgoni/Van'},{seats:2},{km:0},{km:null},{cv:0},{gear:''},{fuel:''},{year:0},{year:2099},{price:0},{cash:-100},{url:'javascript:alert(1)'}];
  for(const changes of invalid){const data=market(changes);assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])],undefined,JSON.stringify(changes));}
});
test('different engines, transmission, fuel and drivetrain do not inflate the reference',()=>{
  for(const changes of [{cv:120},{gear:'Automatico'},{fuel:'Benzina'},{ver:'1.0 Hybrid 4x4'},{body:'Cabrio'}]){
    const data=market();data[1]={...data[1],...changes};assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])],undefined);
  }
});
test('does not flag tiny savings or implausibly large discounts',()=>{
  for(const price of [11200,5000]){const data=market({price});assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])],undefined);}
});
test('price uncertainty lowers priority while real advertised discounts alone have no influence',()=>{
  const known=market(),uncertain=market({real:false}),promo=market({price:8000,cash:9000});
  const score=d=>Deals.calculate(d,2026)[Deals.key(d[0])].score;
  assert.equal(score(known)-score(uncertain),4);assert.equal(score(known)-score(promo),2);
  const marked=market({old:20000,drop:5000});assert.equal(score(known),score(marked));
});
test('ranking preserves filter and AI export behavior without mutating source data',()=>{
  const data=market(),before=JSON.stringify(data),ratings=Deals.calculate(data,2026);
  const state={...DEFAULTS,price:10000,sort:'deal'};
  const selected=applyFilters(data,state,ratings);assert.equal(selected[0].id,'pick');assert.equal(JSON.stringify(data),before);
  const exported=formatListingsForAI([car('finance',{price:8000,cash:10500})],null);
  assert.match(exported,/Prezzo con finanziamento: 8\.000 €/);assert.match(exported,/Prezzo senza finanziamento: 10\.500 €/);
  assert.equal(applyFilters(data,{...state,text:'Aygo'},ratings).length,0);
});
test('regional listings count actual sellers and keep private/dealer comparisons separate',()=>{
  const data=market().map((c,i)=>({...c,src:'AutoScout24 Lombardia',sellerId:'seller'+i,sellerType:'dealer'}));
  assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])].sellers,3);
  assert.equal(Deals.calculate(data.map(c=>({...c,sellerId:'one-seller'})),2026)[Deals.key(data[0])],undefined);
  assert.equal(Deals.calculate(data.map((c,i)=>i?c:{...c,sellerType:'private'}),2026)[Deals.key(data[0])],undefined);
  const ratings=Deals.calculate(data,2026);
  assert.equal(applyFilters(data,{...DEFAULTS,price:20000,seller:'private'},ratings).length,0);
  assert.equal(applyFilters(data,{...DEFAULTS,price:20000,seller:'dealer'},ratings).length,4);
});

test('reported financing is excluded as a deal and as reference, and survives AI export and clean filtering',()=>{
 const note='Finanziamento segnalato dall’utente: prezzo senza finanziamento da verificare';
 const data=market({note,real:false});assert.equal(Deals.calculate(data,2026)[Deals.key(data[0])],undefined);
 const peers=market();peers[1].note=note;assert.equal(Deals.calculate(peers,2026)[Deals.key(peers[0])],undefined);
 assert.equal(applyFilters(data,{...DEFAULTS,price:10000,clean:true},{}).length,0);
 const text=formatListingsForAI([data[0]],null);assert.match(text,/segnalato dall’utente/);assert.match(text,/senza finanziamento da verificare/);assert.doesNotMatch(text,/Prezzo senza finanziamento: [0-9]/);
});
