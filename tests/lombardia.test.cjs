const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const src=stripTypeScriptTypes(fs.readFileSync(require.resolve('../supabase/functions/cerca-auto/lombardia.ts'),'utf8'),{mode:'transform'}).replace(/^export /gm,'');
const context={module:{exports:{}},URL,URLSearchParams,Date,Map,Set,Promise};
vm.runInNewContext(src+'\nmodule.exports={LOMBARDIA,lombardiaUrl,isLombardia,listingCar,parseRegionalPage,collectLombardia,mergeListings};',context);
const R=context.module.exports;
const listing=(id,extra={})=>({id,url:'/annunci/fiat-panda-'+id,price:{priceRaw:9500},availableNow:true,vehicle:{make:'Fiat',model:'Panda',modelVersionInput:'1.0 Hybrid',fuel:'Elettrica/Benzina',transmission:'Manuale'},location:{countryCode:'IT',zip:'20100',city:'Milano'},seller:{id:'salone1',type:'Dealer',companyName:'Salone Uno',links:{infoPage:'https://www.autoscout24.it/concessionari/achille-car'}},tracking:{mileage:'50000'},vehicleDetails:[{iconName:'calendar',data:'01/2023'},{iconName:'speedometer',data:'51 kW (69 CV)'}],...extra});
const html=(listings,pages=1,query={})=>'<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{listings,numberOfPages:pages,numberOfResults:listings.length*pages,pageQuery:{priceto:'10000',fregfrom:'2020',cy:'I',zipr:'200',...query}}}})+'</script>';
test('all Lombardy postal sectors and Mantova are included; neighboring regions and unknown locations are excluded',()=>{
 for(const zip of ['20100','20800','21100','22100','23100','23900','24100','25100','26100','26900','27100','46100']) assert.equal(R.isLombardia({zip,countryCode:'IT'}),true,zip);
 for(const zip of ['28100','29100','37100','41100','47900','','2000']) assert.equal(R.isLombardia({zip,countryCode:'IT'}),false,zip);
 assert.equal(R.isLombardia({zip:'20100',countryCode:'CH'}),false);assert.equal(R.isLombardia(undefined),false);
});
test('filters accepted by the portal and minimum year/maximum advertised price are enforced again locally',()=>{
 const q=new URL(R.lombardiaUrl(2)).searchParams;assert.equal(q.get('priceto'),'10000');assert.equal(q.get('fregfrom'),'2020');assert.equal(q.get('page'),'2');assert.equal(q.get('size'),'100');
 assert.throws(()=>R.parseRegionalPage(html([],1,{priceto:''})),/filtri/);
 assert.equal(R.listingCar(listing('over',{price:{priceRaw:10500}})),null);
 assert.equal(R.listingCar(listing('old',{vehicleDetails:[{iconName:'calendar',data:'01/2019'}]})),null);
 assert.equal(R.listingCar(listing('bad',{url:'https://evil.example/ad'})),null);
});
test('keeps seller type and location without collecting private names, telephone or street',()=>{
 const c=R.listingCar(listing('p',{seller:{id:'p1',type:'PrivateSeller',contactName:'Non conservare',phones:['123']}}));
 assert.equal(c.sellerType,'private');assert.equal(c.sellerName,'Privato');assert.equal(c.city,'Milano');assert.equal(c.cv,69);assert.equal(c.fuel,'Ibrida');assert.equal(c.km,50000);assert.equal(JSON.stringify(c).includes('Non conservare'),false);
 const d=R.listingCar(listing('d'),{'achille-car':'Achille Car'});assert.equal(d.src,'Achille Car');
});
test('never interprets a conditional price as no-strings pricing and preserves current unavailability',()=>{
 const c=R.listingCar(listing('c',{price:{priceRaw:8500,isConditionalPrice:true},availableNow:false}));assert.equal(c.real,false);assert.match(c.note,/condizioni/);assert.equal(c.unavailable,true);
});
test('paginates, removes repeated listings and post-filters the seller location',async()=>{
 const pages=[html([listing('a'),listing('outside',{location:{zip:'28100',countryCode:'IT'}})],2),html([listing('a'),listing('b')],2)];let calls=0;
 const result=await R.collectLombardia(async url=>{calls++;return pages[Number(new URL(url).searchParams.get('page'))-1];});
 assert.equal(calls,2);assert.equal(result.complete,true);assert.equal(result.cars.length,2);assert.equal(result.coverage.rejectedLocation,1);assert.equal(result.coverage.uniqueRead,3);
});
test('missing pages are reported as partial while successful pages remain usable',async()=>{
 const r=await R.collectLombardia(async url=>{if(new URL(url).searchParams.get('page')==='2')throw Error('HTTP 503');return html([listing('a')],2);});assert.equal(r.complete,false);assert.equal(r.cars.length,1);assert.equal(r.coverage.failedPages,1);assert.match(r.error,/parziale/);
});
test('deduplication preserves existing source, conditions and seller metadata',()=>{
 const existing={...R.listingCar(listing('same')) ,src:'Achille Car',note:'Avvertenza originale'};
 delete existing.sellerId;const regional=R.listingCar(listing('same'));const out=R.mergeListings([existing,regional]);assert.equal(out.length,1);assert.equal(out[0].src,'Achille Car');assert.equal(out[0].sellerId,'salone1');assert.equal(out[0].note,'Avvertenza originale');
});
