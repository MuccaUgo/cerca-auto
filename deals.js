/* Ranking locale: usa soltanto i dati degli annunci, senza quotazioni esterne. */
(function(root){
  "use strict";
  var RULES={minPeers:3,minSellers:2,maxPerSeller:3,maxYearGap:2,maxKmGap:40000,powerTolerance:.15,minSaving:500,minSavingRatio:.05,maxSavingRatio:.35};
  function norm(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
  function key(car){return car.vehicleKey || car.src+"|"+car.id;}
  function seller(car){return car.sellerId?'as24:'+car.sellerId:norm(car.sellerName||car.src);}
  function price(car){
    var advertised=Number(car.price),cash=Number(car.cash);
    // Un prezzo cash esplicito ma non valido non può diventare il prezzo promozionale.
    if(car.cash!==undefined&&car.cash!==null&&car.cash!==0&&car.cash!=="") return Number.isFinite(cash)&&cash>0?cash:NaN;
    return Number.isFinite(advertised)&&advertised>0?advertised:NaN;
  }
  // Confronta una sola quotazione per vettura. I prezzi noti senza finanziamento
  // hanno priorità; fra offerte con lo stesso grado di certezza usa la meno cara.
  function rankOffer(car){
    if(!car.offers || !car.offers.length) return car;
    var best=null;
    car.offers.forEach(function(offer){
      if(offer.manual || offer.note || offer.res || offer.unavailable || !Number.isFinite(price(offer))) return;
      var known=!!(offer.cash || offer.real), priorKnown=best && !!(best.cash || best.real);
      if(!best || (known && !priorKnown) || (known===priorKnown && price(offer)<price(best))) best=offer;
    });
    return best;
  }
  function median(values){var a=values.slice().sort(function(x,y){return x-y;});return (a[(a.length-1)>>1]+a[a.length>>1])/2;}
  function urlIdentity(car){try{var u=new URL(car.url);if(!/^https?:$/.test(u.protocol)) return "";return u.hostname.toLowerCase()+u.pathname.replace(/\/$/,"");}catch(e){return "";}}
  function eligible(car,year){
    var body=norm(car.body),version=norm(car.ver);
    return !!(car.id!==undefined&&car.id!==null&&String(car.id)!==""&&norm(car.src)&&norm(car.brand)&&norm(car.model)&&norm(car.fuel)&&norm(car.gear)&&
      !car.res&&!car.unavailable&&!car.note&&Number.isFinite(price(car))&&Number.isInteger(Number(car.year))&&car.year>=2000&&car.year<=year+1&&
      Number.isFinite(Number(car.km))&&car.km>0&&Number.isFinite(Number(car.cv))&&car.cv>0&&urlIdentity(car)&&
      !(Number(car.seats)>0&&Number(car.seats)<=2)&&!/furgon|\bvan\b|autocarro|commercial/.test(body+" "+version));
  }
  function family(car){
    var version=norm(car.ver),fuel=norm(car.fuel),hybrid="";
    if(fuel==="ibrida") hybrid=/plug in|phev/.test(norm(car.fuelLabel)+" "+version)?"plug-in":/full hybrid|\bhev\b/.test(norm(car.fuelLabel)+" "+version)?"full":"other";
    return [norm(car.brand),norm(car.model),fuel,hybrid,norm(car.gear),car.sellerType==='private'?'private':'dealer',/\b4x4\b|\b4wd\b|\bawd\b|\bquattro\b|\bxdrive\b|\b4matic\b/.test(version)?"4wd":"2wd",/cabrio|convertib/.test(norm(car.body))?"cabrio":"auto"].join("|");
  }
  function calculate(cars,asOfYear){
    var year=asOfYear||new Date().getFullYear(),groups=Object.create(null),seen=Object.create(null),ratings=Object.create(null);
    // Ordine stabile e URL unici: un annuncio ripubblicato non è un nuovo confronto.
    cars.slice().sort(function(a,b){return key(a).localeCompare(key(b));}).forEach(function(car){
      if(car.possibleMatches && car.possibleMatches.length) return;
      var quote=rankOffer(car);
      if(!quote) return;
      if(quote!==car) car=Object.assign({},car,{
        vehicleKey:key(car),price:quote.price,cash:quote.cash,real:quote.real,note:quote.note,
        res:quote.res,unavailable:quote.unavailable,url:quote.url,quoteSource:quote.src
      });
      if(!eligible(car,year)) return;
      var identity=urlIdentity(car);if(seen[identity]) return;seen[identity]=true;
      var group=family(car);(groups[group]||(groups[group]=[])).push(car);
    });
    Object.keys(groups).forEach(function(group){
      var entries=groups[group];
      entries.forEach(function(car){
        var sellerCounts=Object.create(null);
        var peers=entries.filter(function(peer){
          return peer!==car&&peer.year<=car.year&&peer.year>=car.year-RULES.maxYearGap&&peer.km>=car.km&&peer.km<=Number(car.km)+RULES.maxKmGap&&Math.abs(peer.cv-car.cv)<=car.cv*RULES.powerTolerance;
        }).sort(function(a,b){
          var distance=function(p){return (car.year-p.year)/RULES.maxYearGap+(p.km-car.km)/RULES.maxKmGap;};
          return distance(a)-distance(b)||key(a).localeCompare(key(b));
        }).filter(function(peer){var id=seller(peer);sellerCounts[id]=(sellerCounts[id]||0)+1;return sellerCounts[id]<=RULES.maxPerSeller;});
        var sellers=new Set(peers.map(seller)).size;
        if(peers.length<RULES.minPeers||sellers<RULES.minSellers) return;
        var reference=median(peers.map(price)),saving=reference-price(car),ratio=saving/reference;
        if(saving<RULES.minSaving||ratio<RULES.minSavingRatio||ratio>RULES.maxSavingRatio) return;
        // La percentuale è un confronto fra annunci. Le condizioni incerte riducono la priorità.
        var penalty=car.cash?2:car.real?0:4;
        ratings[key(car)]={key:key(car),url:car.url,source:car.quoteSource||car.src,price:price(car),reference:reference,saving:saving,percent:Math.round(ratio*100),peers:peers.length,sellers:sellers,score:ratio*100-penalty,cash:!!car.cash,uncertain:!car.cash&&!car.real,peerKeys:peers.map(key)};
      });
    });
    return ratings;
  }
  function compare(a,b,ratings){
    var da=ratings[key(a)],db=ratings[key(b)];
    if(da&&db) return db.score-da.score||db.saving-da.saving||price(a)-price(b)||key(a).localeCompare(key(b));
    if(da||db) return da?-1:1;
    return (a.res?1:0)-(b.res?1:0)||price(a)-price(b)||Number(a.km)-Number(b.km)||key(a).localeCompare(key(b));
  }
  var api={calculate:calculate,compare:compare,price:price,key:key,RULES:RULES};
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
  else root.CarDeals=api;
})(typeof globalThis!=="undefined"?globalThis:this);
