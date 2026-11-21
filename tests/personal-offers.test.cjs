const test = require('node:test');
const assert = require('node:assert/strict');
const values = new Map();
Object.defineProperty(globalThis, 'localStorage', {value: {
  getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)
}});
const offers = require('../personal-offers.js');
const url = 'https://www.subito.it/auto/fiat-panda-milano-123456789.htm';
const car = {src:'AutoScout',id:'001',brand:'Fiat',model:'Panda',url:'https://www.autoscout24.it/annunci/panda'};
test('personal linking accepts Auto pages only, removes tracking and limits search to Lombardy', () => {
  for (const link of [url.replace('www.subito.it','www.subito.it.evil.test'),url.replace('/auto/','/moto/'),url.replace('https:', 'http:'),url.replace('www.', 'alice@www.'),'javascript:alert(1)']) assert.equal(offers.listing(link),null);
  assert.equal(offers.listing(url + '?utm_source=ios#hello').url,url);
  const search = new URL(offers.searchUrl(car));
  assert.equal(search.pathname,'/annunci-lombardia/vendita/auto/');
  assert.equal(search.searchParams.get('q'),'Fiat Panda');
  const filtered = new URL(offers.searchUrl(car,{price:10000,year:2020}));
  assert.equal(filtered.searchParams.get('pe'),'10000');assert.equal(filtered.searchParams.get('ys'),'2020');
});
test('a local match is separate from catalog, can be edited/removed by alias, and cannot link two cars', () => {
  const another = {...car,id:'002'};
  assert.throws(()=>offers.save(car,url,'-1',[car]),/prezzo/);
  offers.save(car,url,'',[car]);
  assert.equal(offers.get(car).price,undefined);
  assert.equal(car.offers,undefined);
  assert.throws(()=>offers.save(another,url.replace('fiat-panda','updated-title'),'5000',[another]),/già presente/);
  const grouped = {...car,id:'later',aliases:['AutoScout|001']};
  assert.equal(offers.get(grouped).url,url);
  offers.save(grouped,url,'5990',[grouped]);
  assert.equal(offers.get(grouped).price,5990);
  assert.equal(offers.get(car),null);
  const authoritative = {...grouped,offers:[{url,portal:'subito'}]};
  assert.equal(offers.get(authoritative),null);
  offers.save(grouped,null,'',[grouped]); assert.equal(offers.get(grouped),null);
  assert.throws(()=>offers.save(another,url,'',[authoritative,another]),/già presente/);
});
