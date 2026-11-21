const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../supabase/functions/cerca-auto/subito.ts');
const plain=(x)=>JSON.parse(JSON.stringify(x));
const NOW=new Date('2026-11-21T12:00:00Z');

// Annuncio nel formato restituito dal portale (ridotto ai campi usati).
const item=(id,extra={},features={})=>({
  kind:'AdItem',urn:'id:ad:aaaa-bbbb:list:'+id,subject:'Fiat Panda 1.0 FireFly Hybrid City Life',body:'Auto in ottime condizioni.',
  type:{key:'s',value:'In vendita'},category:{id:'2',label:'Auto'},urls:{default:'https://www.subito.it/auto/fiat-panda-hybrid-milano-'+id+'.htm?utm=x'},
  geo:{region:{id:'4',value:'Lombardia'},city:{shortName:'MI',value:'Milano'},town:{value:'Cinisello Balsamo'}},
  advertiser:{name:'Mario',type:0,phone:'3331234567',userId:'987654321',company:false},
  features:{
    '/car':{values:[{label:'Marca',value:'FIAT'},{label:'Modello',value:'Panda'},{label:'Versione',value:'Altro allestimento'}]},
    '/price':{values:[{key:'9500',value:'9500 €'}]},'/year':{values:[{key:'2023',value:'2023'}]},'/register_date':{values:[{key:'10/2023',value:'10/2023'}]},
    '/mileage_scalar':{values:[{key:'49345',value:'49345 Km'}]},'/fuel':{values:[{key:'7',value:'Mild Hybrid Benzina'}]},'/gearbox':{values:[{key:'1',value:'Manuale'}]},
    '/power':{values:[{key:'51/69',value:'51 kW / 69 Cv'}]},'/car_type':{values:[{key:'1',value:'City car'}]},'/seats':{values:[{key:'4',value:'5'}]},...features},
  ...extra});
const catalog=(brand,model)=>({'/car':{values:[{label:'Marca',value:brand},{label:'Modello',value:model},{label:'Versione',value:'Altro allestimento'}]}});
const year=(y,km)=>({'/year':{values:[{key:String(y)}]},'/register_date':{values:[{value:'03/'+y}]},...(km===undefined?{}:{'/mileage_scalar':{values:[{key:String(km)}]}})});
const dealer={name:'',type:1,phone:'0',shopId:'53020',userId:'6096134',company:true,shopName:'Salone Esempio'};
const car=(id,extra,features)=>S.subitoCar(item(id,extra,features),NOW);
const page=(items,{page=1,pages=1,total=items.length,filters={pe:'10000',ys:'2020'},region='4'}={})=>'<script id="__NEXT_DATA__" type="application/json">'+
  JSON.stringify({props:{pageProps:{initialState:{items:{originalList:items,total,totalPages:pages},search:{page,filters,geo:{region:{id:region}}}}}}})+'</script>';

test('search URL asks the portal for Lombardy, 10.000 € and 2020, and pages with o',()=>{
  const first=new URL(S.subitoUrl(1)),third=new URL(S.subitoUrl(3));
  assert.equal(first.pathname,'/annunci-lombardia/vendita/auto/');assert.equal(first.searchParams.get('pe'),'10000');assert.equal(first.searchParams.get('ys'),'2020');
  assert.equal(first.searchParams.get('o'),null);assert.equal(third.searchParams.get('o'),'3');
});
test('a page is rejected when the portal drops filters, region or page number',()=>{
  assert.equal(S.parseSubitoPage(page([item('1')],{total:31,pages:2})).pages,2);
  assert.throws(()=>S.parseSubitoPage(page([],{filters:{ys:'2020'}})),/filtri/);
  assert.throws(()=>S.parseSubitoPage(page([],{region:'6'})),/filtri/);
  assert.throws(()=>S.parseSubitoPage(page([],{page:1}),2),/pagina 2/);
  assert.throws(()=>S.parseSubitoPage('<html></html>'),/struttura/);
});
test('maps a private listing without keeping the seller name, phone or account id',()=>{
  const c=car('669199235');
  assert.equal(c.brand,'Fiat');assert.equal(c.model,'Panda');assert.equal(c.ver,'1.0 FireFly Hybrid City Life');assert.equal(c.year,2023);assert.equal(c.reg,'10/2023');
  assert.equal(c.km,49345);assert.equal(c.price,9500);assert.equal(c.cv,69);assert.equal(c.fuel,'Ibrida');assert.equal(c.gear,'Manuale');assert.equal(c.seats,5);
  assert.equal(c.url,'https://www.subito.it/auto/fiat-panda-hybrid-milano-669199235.htm');assert.equal(c.city,'Cinisello Balsamo (MI)');assert.equal(c.portal,'subito');
  assert.equal(c.sellerType,'private');assert.equal(c.sellerName,'Privato');assert.equal(c.sellerId,'sub:ad:669199235');
  const json=JSON.stringify(c);for(const secret of ['Mario','3331234567','987654321']) assert.equal(json.includes(secret),false,secret);
});
test('maps a dealer listing with business name and shop id',()=>{
  const c=car('2',{advertiser:dealer,subject:'JEEP Renegade 1.6 Mjt Limited'},{...catalog('JEEP','Renegade'),'/fuel':{values:[{value:'Diesel'}]},'/gearbox':{values:[{value:'Automatico'}]},'/power':{values:[{value:'96 kW / 131 Cv'}]}});
  assert.equal(c.brand,'Jeep');assert.equal(c.ver,'1.6 Mjt Limited');assert.equal(c.sellerType,'dealer');assert.equal(c.sellerName,'Salone Esempio');assert.equal(c.sellerId,'sub:shop:53020');
  assert.equal(c.fuel,'Diesel');assert.equal(c.gear,'Automatico');assert.equal(c.cv,131);
  assert.equal(S.brandCase('MERCEDES-BENZ'),'Mercedes-Benz');assert.equal(S.brandCase('ALFA ROMEO'),'Alfa Romeo');assert.equal(S.brandCase('BMW'),'BMW');assert.equal(S.brandCase('CITROËN'),'Citroen');
});
test('model names lose the catalog generation, so they match the other sites',()=>{
  const cases={'Panda 3ª serie':'Panda','500 (2015-2024)':'500','Tipo (2015-->)':'Tipo','C3 Aircross 1ª s.':'C3 Aircross','Picanto 3ªs.(17-->)':'Picanto',
    '2008 1° serie':'2008','Civic 3ª-4ª-5ª ser.':'Civic','Porter 1ª/2ª serie':'Porter',"Multivan 5ª '03-'09":'Multivan','Serie 3(G20/1-80/1)':'Serie 3','Ypsilon':'Ypsilon'};
  for(const [raw,clean] of Object.entries(cases)) assert.equal(S.cleanModel(raw),clean,raw);
  const c=car('3',{subject:'Fiat Panda 1.0 FireFly S&S Hybrid'},catalog('FIAT','Panda 3ª serie'));
  assert.equal(c.model,'Panda');assert.equal(c.ver,'1.0 FireFly S&S Hybrid');
});
test('brand or model "Altro" is read from the title, otherwise the listing is skipped',()=>{
  let c=car('4',{subject:'Dacia Dokker van 1.5 blue dci 75cv'},catalog('Altro','Altro modello'));
  assert.equal(c.brand,'Dacia');assert.equal(c.model,'Dokker');assert.equal(c.ver,'van 1.5 blue dci 75cv');
  c=car('5',{subject:'Renault Express II Express van 1.5 Blue dci 95cv'},catalog('De Tomaso','Altro modello'));
  assert.equal(c.brand,'Renault');assert.equal(c.model,'Express');
  c=car('6',{subject:'mercedes classe A 180 CDI'},catalog('Mercedes','Altro modello'));
  assert.equal(c.brand,'Mercedes-Benz');assert.equal(c.model,'Classe A');
  assert.equal(car('7',{subject:'trattorino tosa erba più carrello'},catalog('Altro','Altro modello')),'modello_sconosciuto');
  assert.equal(car('8',{subject:'filtro olio'},catalog('Abarth','Altro modello')),'modello_sconosciuto');
  assert.equal(car('9',{subject:'Fiat vendo urgente'},catalog('Fiat','Altro modello')),'modello_sconosciuto');
});
test('excludes listings outside the search, microcars, rentals, brumbrum copies and bad links',()=>{
  assert.equal(car('10',{geo:{region:{id:'6'}}}),'fuori_lombardia');
  assert.equal(car('11',{},{'/price':{values:[{key:'10500'}]}}),'fuori_filtri');
  assert.equal(car('12',{},year(2019)),'fuori_filtri');
  assert.equal(car('13',{subject:'Macchina elettrica senza patente'}),'microcar');
  assert.equal(car('14',{subject:'Aixam City'}),'microcar');
  assert.equal(car('15',{subject:'Citroen Ami 100% elettrica'},catalog('CITROEN','Ami (2021)')),'microcar');
  assert.equal(car('16',{subject:'Renault TWIZY 80'},catalog('Renault','Altro modello')),'microcar');
  assert.equal(car('17',{},{'/price':{values:[{key:'377'}]}}),'noleggio_o_rata');
  assert.equal(car('18',{subject:'Fiat Panda noleggio a lungo termine'}),'noleggio_o_rata');
  assert.equal(car('19',{subject:'PORSCHE MACAN 4 – SUBENTRO'}),'noleggio_o_rata');
  assert.equal(car('20',{advertiser:dealer,subject:'Audi RS6 Avant 4.0 TFSI',body:'SPECIFICHE OFFERTA - Auto nuova da immatricolare - Simulazione 24-36-48 mesi - Rata mensile senza acconto'},{'/price':{values:[{key:'2990'}]}}),'noleggio_o_rata');
  assert.equal(car('21',{advertiser:dealer,body:'LEASING FULL INCLUSIVE - Acconto minimo 10%'},{'/price':{values:[{key:'5900'}]}}),'noleggio_o_rata');
  assert.equal(typeof car('22',{subject:'Fiat Panda ex leasing aziendale'}),'object');
  assert.equal(typeof car('23',{body:'Possibilità di finanziamento con rata mensile da 150 euro, simulazione di finanziamento in sede'}),'object');
  assert.equal(car('24',{advertiser:{...dealer,shopName:'brumbrum'}}),'brumbrum');
  assert.equal(car('25',{urls:{default:'https://evil.example/auto/x-25.htm'}}),'non_valido');
  assert.equal(car('26',{type:{key:'k'}}),'non_valido');
});
test('skips people looking for cars, also when the words are spelled out',()=>{
  assert.equal(car('30',{subject:'c.e.r.c.o. auto 7 posti'}),'cerco_o_compro');
  assert.equal(car('31',{subject:'Compriamo auto grandinate'}),'cerco_o_compro');
  assert.equal(car('32',{subject:'ritiro auto usate in buone condizioni'}),'cerco_o_compro');
  assert.equal(car('33',{subject:'Ford puma anche sinistrate',body:'C…..o……m….p…r…o Ford puma mandare un messaggio'}),'cerco_o_compro');
  assert.equal(typeof car('34',{subject:'Fiat Panda acquistata nuova, unico proprietario'}),'object');
});
test('skips registration years contradicted by the listing, but not model numbers or dealer history',()=>{
  assert.equal(car('40',{subject:'Ford Mondeo 2012'},catalog('FORD','Mondeo 4ª serie')),'anno_incoerente');
  assert.equal(car('41',{subject:'peugeot 207',body:'vendo peugeot 207, Anno 2007 .macchina tutto perfeto'},catalog('PEUGEOT','207')),'anno_incoerente');
  assert.equal(car('42',{subject:'lancia Ypsilon',body:'vendo lancia Ypsilon anno immatricol. marzo 2006'},catalog('LANCIA','Ypsilon')),'anno_incoerente');
  assert.equal(car('43',{subject:'Fiat grande punto',body:'Vendo grande punto 1.3 multi jet 2015 sempre curata'},year(2025,95000)),'anno_incoerente');
  assert.equal(car('44',{subject:'Mercedes Classe A 170'},{...catalog('MERCEDES','Classe A (W/C169)'),...year(2025,163000)}),'anno_incoerente');
  assert.equal(typeof car('45',{subject:'Peugeot 2008 1.2 PureTech 130'},catalog('PEUGEOT','2008 2ª serie')),'object');
  assert.equal(typeof car('46',{advertiser:dealer,body:'Concessionaria dal 1985. Garanzia 12 mesi.'}),'object');
  assert.equal(typeof car('47',{body:'Gomme anno 2019, immatricolata nel 2021'},year(2021,60000)),'object');
  assert.equal(typeof car('48',{subject:'Fiat Panda 1999 euro trattabili'},{'/price':{values:[{key:'1999'}]}}),'object');
  const reg=(r,km)=>({'/year':{values:[{key:r.slice(3)}]},'/register_date':{values:[{value:r}]},'/mileage_scalar':{values:[{key:String(km)}]}});
  assert.equal(car('49',{subject:'FIAT GRANDE PUNTO 1.2 BENZINA',body:'Buongiorno\nIn vendita FIAT GRANDE PUNTO 1.2 FIRE BENZINA 2010 CON SOLI 57.000 KM!!'},{...catalog('FIAT','Grande Punto'),'/price':{values:[{key:'5500'}]},...reg('11/2026',57000)}),'anno_incoerente');
  assert.equal(car('60',{advertiser:dealer},reg('11/2026',30000)),'anno_incoerente');
  assert.equal(typeof car('61',{advertiser:dealer},reg('11/2025',60000)),'object');
});
test('skips prices that cannot be a sale: powerful new cars for a few thousand euro, private cars at 0 km',()=>{
  assert.equal(car('50',{advertiser:dealer,subject:'Mercedes-benz GLE 63 AMG S',body:'Pronta consegna'},{...catalog('MERCEDES-BENZ','GLE Coupé (C167)'),...year(2026,0),'/price':{values:[{key:'3500'}]},'/power':{values:[{value:'450 kW / 612 Cv'}]}}),'prezzo_implausibile');
  assert.equal(car('51',{subject:'Fiat Panda'},{...year(2026,0),'/price':{values:[{key:'2000'}]}}),'prezzo_implausibile');
  assert.equal(typeof car('52',{advertiser:dealer},{...year(2026,0),'/price':{values:[{key:'4800'}]}}),'object');
  assert.equal(car('53',{subject:'CITROEN C2 BENZINA KM 17650 3 PORTE'},{...catalog('CITROEN','C2'),...year(2025,17650),'/price':{values:[{key:'2300'}]}}),'prezzo_implausibile');
  assert.equal(car('54',{subject:'REGAL RAPTOR, 100% ELETTRICA',advertiser:dealer,body:'MINICAR a 2 POSTI, 100% ELETTRICA'},catalog('PIAGGIO','Porter')),'microcar');
  assert.equal(car('55',{subject:'Microcar elettrica'},{'/power':{values:[{value:'3 kW / 4 Cv'}]}}),'microcar');
  assert.equal(typeof car('56',{body:'Schermo con mini carplay, sensori'}),'object');
});
test('reads a declared price without financing and flags conditional prices',()=>{
  const ke=S.priceTerms('Fiat Panda','PREZZO SENZA FINANZIAMENTO: € 13900,00\n PREZZO PROMOZIONALE KE AUTO+: € 9999,00',9999);
  assert.equal(ke.cash,13900);assert.equal(ke.real,false);assert.equal(ke.note,'');
  const same=S.priceTerms('Fiat Panda','Prezzo anche senza finanziamento 9.999 euro',9999);assert.equal(same.cash,0);assert.equal(same.real,true);
  for(const body of ['Prezzo valido solo con finanziamento','Il prezzo esposto è riservato a chi finanzia l’acquisto','Prezzo promozionale con finanziamento Agos','Prezzo vincolato all’apertura di un finanziamento','Acquisto con finanziamento obbligatorio']){
    const t=S.priceTerms('Fiat Panda',body,9000);assert.equal(t.note,S.NOTES.conditional,body);assert.equal(t.real,false,body);
  }
});
test('real-price statements and harmless financing mentions do not create warnings',()=>{
  for(const body of ['NESSUN OBBLIGO DI FINANZIAMENTO','Nessun vincolo di fananziamento per l’acquisto','Prezzo non vincolato a finanziamento','Prezzo reale, passaggio escluso']){
    const t=S.priceTerms('Fiat Panda',body,9000);assert.equal(t.real,true,body);assert.equal(t.note,'',body);
  }
  for(const body of ['Possibilità di finanziamento personalizzato','Acquisto con pagamento immediato del tuo usato, anche senza obbligo di acquisto.','Prezzo valido per auto in pronta consegna, finanziamenti personalizzati']){
    const t=S.priceTerms('Fiat Panda',body,9000);assert.equal(t.real,false,body);assert.equal(t.note,'',body);
  }
});
test('VAT, generic listings and damage are flagged; negated damage is not',()=>{
  assert.equal(S.priceTerms('Fiat Panda','Prezzo + IVA',9000).note,S.NOTES.vat);
  assert.equal(S.priceTerms('Fiat 500 Hybrid diversi colori','',9000).note,S.NOTES.generic);
  assert.equal(S.priceTerms('Fiat Panda','Auto incidentata lato destro',4000).note,S.NOTES.damage);
  assert.equal(S.priceTerms('Fiat Panda','Mai incidentata, tagliandi regolari, nulla da sistemare',9000).note,'');
});
test('drops Subito copies of cars already read elsewhere and repeated ads of the same seller',()=>{
  const as24={src:'AutoScout24 Lombardia',id:'a1',brand:'Fiat',model:'Panda',year:2023,km:49345,price:9500,portal:'autoscout24'};
  const sub=(id,extra)=>({src:'Subito Lombardia',id,brand:'Fiat',model:'Panda',year:2023,km:49345,price:9490,portal:'subito',sellerId:'sub:ad:'+id,...extra});
  const r=S.dropKnownSubito([as24],[sub('s1'),sub('s2',{km:49346}),sub('s3',{price:10900})]);
  assert.equal(r.duplicates,1);assert.deepEqual(plain(r.cars.map((c)=>c.id)),['s2','s3']);
  const round={...as24,id:'a2',km:50000,price:9000};
  const rr=S.dropKnownSubito([round],[sub('s4',{km:50000,price:9200}),sub('s5',{km:50000,price:9050})]);
  assert.deepEqual(plain(rr.cars.map((c)=>c.id)),['s4']);
  const twice=S.dropKnownSubito([],[sub('s6',{sellerId:'sub:shop:77'}),sub('s7',{sellerId:'sub:shop:77'}),sub('s8')]);
  assert.deepEqual(plain(twice.cars.map((c)=>c.id)),['s6','s8']);assert.equal(twice.duplicates,1);
});
test('collects all pages once and reports partial collections honestly',async()=>{
  const pages={1:page([item('1'),item('2')],{pages:3,total:5}),2:page([item('2'),item('3')],{page:2,pages:3,total:5}),3:page([item('4'),item('5',{geo:{region:{id:'6'}}})],{page:3,pages:3,total:5})};
  const get=(fail)=>async(url)=>{const n=Number(new URL(url).searchParams.get('o')||1);if(n===fail) throw new Error('rete');return pages[n];};
  const ok=await S.collectSubito(get(0));
  assert.equal(ok.complete,true);assert.deepEqual(plain(ok.cars.map((c)=>c.id)),['1','2','3','4']);assert.equal(ok.expected,4);
  assert.equal(ok.coverage.pagesRead,3);assert.equal(ok.coverage.uniqueRead,5);assert.equal(ok.coverage.skipped.fuori_lombardia,1);
  const partial=await S.collectSubito(get(2));
  assert.equal(partial.complete,false);assert.match(partial.error,/lette 2 di 3/);assert.deepEqual(plain(partial.cars.map((c)=>c.id)),['1','2','4']);
  const stuck=await S.collectSubito(async()=>pages[1]);
  assert.equal(stuck.complete,false);assert.equal(stuck.coverage.failedPages,2);
});
