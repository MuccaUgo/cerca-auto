// Confronta le offerte dei saloni autorizzati. I link a Subito non vengono interrogati.
import { SUBITO } from './subito.ts';
export const PARTNER_SOURCE = "Subito · stock rivenditori";
type Identity = { vin?: string; stock?: string; pairedId?: string };
export type MatchCar = {
  id: string; src: string; url: string; price: number; brand: string; model: string;
  ver: string; reg: string; cv: number; km: number; gear: string; fuel: string;
  res: boolean; unavailable?: boolean; real?: boolean; cash?: number; note?: string;
  portal?: string; sellerId?: string; sellerName?:string; sellerType?: string; postcode?: string; city?:string;
  offers?: Offer[]; aliases?: string[]; possibleMatches?: Link[];
  // Interno: cancellato prima di serializzare il catalogo.
  matchIdentity?: Identity;
};
type Link = Pick<MatchCar, 'src'|'id'|'url'> & {portal: string};
type Offer = Link & Pick<MatchCar, 'price'|'cash'|'real'|'note'|'res'|'unavailable'>;
type StockRow = { subito_id: string; listing: Record<string, unknown> };
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const normalized = (value: unknown) => string(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const validVin = (v: unknown) => /^[A-HJ-NPR-Z0-9]{17}$/.test(string(v).toUpperCase()) && !/^([A-Z0-9])\1+$/.test(string(v).toUpperCase()) ? string(v).toUpperCase() : '';
const validStock = (v: unknown) => {
  const code = (typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : string(v)).toUpperCase();
  return /^[A-Z0-9][A-Z0-9 ._/-]{1,63}$/.test(code) && !/^(?:0+|N\/?A|NONE|NULL|UNKNOWN|ND|N\/D)$/.test(code) ? code : '';
};
const asNumber = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : NaN);
function asLink(c: MatchCar): Link {
  return {src:c.src,id:c.id,url:c.url,portal:c.portal || (c.url.startsWith('https://www.autoscout24.it/') ? 'autoscout24' : c.src)};
}
function asOffer(c: MatchCar): Offer {
  return {...asLink(c),price:c.price,cash:c.cash,real:c.real,note:c.note,res:c.res,unavailable:c.unavailable};
}
// Only authenticated publisher inventory can reach this parser. The portal reference must
// match the ID in the canonical URL, and the seller location must be in Lombardy.
export function partnerCar(row: StockRow) {
  const p = row.listing;
  if (!p || typeof p !== 'object' || !/^\d{5,14}$/.test(row.subito_id)) throw Error('Identità annuncio non valida');
  const url = new URL(string(p.url));
  const id = url.pathname.match(/^\/auto\/[^/]+-(\d+)\.htm$/i)?.[1];
  if (url.protocol !== 'https:' || !['www.subito.it','subito.it'].includes(url.hostname) || url.port || url.username || url.password || id !== row.subito_id) throw Error('Link annuncio non valido');
  url.search = ''; url.hash = '';
  const postcode=string(p.postcode), year=asNumber(p.year), price=asNumber(p.price), km=asNumber(p.km);
  if (!/^\d{5}$/.test(postcode) || !Number.isFinite(price) || price <= 0 || !Number.isInteger(year) ||
      year < 1900 || year > new Date().getFullYear()+1 || !string(p.brand) || !string(p.model) ||
      !string(p.sellerName) || !string(p.countryCode)) throw Error('Dati essenziali incompleti');
  if (string(p.countryCode).toUpperCase() !== 'IT' || !/^(?:2[0-7]|46)/.test(postcode) || year < 2020 || price > 10000) return null;
  if (p.km != null && (!Number.isFinite(km) || km < 0)) throw Error('Chilometraggio non valido');
  if (p.reg != null && !new RegExp('^(0[1-9]|1[0-2])/' + year + '$').test(string(p.reg))) throw Error('Immatricolazione incoerente');
  if (p.pricing != null && !['unknown','finance','cash'].includes(string(p.pricing))) throw Error('Condizione di prezzo non valida');
  const cash = asNumber(p.cash);
  if (p.cash != null && (p.pricing !== 'finance' || !Number.isFinite(cash) || cash <= 0)) throw Error('Prezzo senza finanziamento non valido');
  const note = [string(p.note), p.pricing === 'finance' && !cash ? 'Prezzo con finanziamento: importo senza finanziamento da verificare' : ''].filter(Boolean).join(' · ');
  const cv = asNumber(p.cv);
  const pairedId = string(p.autoscoutListingId).toLowerCase();
  if (pairedId && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(pairedId)) throw Error('Riferimento AutoScout24 non valido');
  return {
    id:row.subito_id,src:PARTNER_SOURCE,portal:'subito',url:url.href,brand:string(p.brand),model:string(p.model),ver:string(p.ver),
    year,reg:string(p.reg) || String(year),km:km || 0,price,old:0,gear:string(p.gear),res:p.res === true,unavailable:p.unavailable === true,
    fuel:string(p.fuel),fuelLabel:string(p.fuelLabel) || string(p.fuel),cv:cv > 0 ? cv : 0,body:string(p.body),cash:cash || undefined,
    real:p.pricing === 'cash' && !note,note,sellerId:string(p.autoscoutSellerId),sellerName:string(p.sellerName),sellerType:'dealer',postcode,city:string(p.city),
    matchIdentity:{vin:validVin(p.vin),stock:validStock(p.stock),pairedId}
  };
}

type ReadPage = (after:string) => Promise<StockRow[]>;
export async function collectPartnerStock(read:ReadPage) {
  const cars: NonNullable<ReturnType<typeof partnerCar>>[] = [];
  let after = '', invalid = 0, failed = false;
  while (true) {
    try {
      const rows = await read(after);
      if (!Array.isArray(rows)) throw Error('Risposta stock non valida');
      for (const row of rows) {
        try { const car = partnerCar(row); if (car) cars.push(car); }
        catch { invalid++; }
      }
      if (rows.length < 500) break;
      const last = String(rows.at(-1)?.subito_id);
      if (last <= after) throw Error('Paginazione stock non valida');
      after = last;
    } catch { failed = true; break; }
  }
  return {cars,expected:cars.length,complete:!invalid && !failed,
    error: [invalid ? invalid+' schede stock non valide' : '',failed ? 'Lettura del catalogo fornito dai rivenditori incompleta' : ''].filter(Boolean).join(' · ')};
}

function sameModel(a:MatchCar,b:MatchCar) {
  const month = /^(0[1-9]|1[0-2])\/\d{4}$/;
  return normalized(a.brand) === normalized(b.brand) && normalized(a.model) === normalized(b.model) &&
    (!month.test(a.reg) || !month.test(b.reg) || a.reg === b.reg) &&
    (!a.cv || !b.cv || Math.abs(a.cv-b.cv) <= 2);

}
function candidateKeys(c:MatchCar): string[] {
  if (c.sellerType !== 'dealer' || !c.ver || !c.fuel || !c.gear || !c.cv || c.km <= 0 || !/^(0[1-9]|1[0-2])\/\d{4}$/.test(c.reg)) return [];
  const parts = [c.brand,c.model,c.ver,c.reg,String(c.cv),c.fuel,c.gear].map(normalized);
  if (!parts.every(Boolean)) return [];
  const keys:string[]=[];
  if (c.sellerId) keys.push(JSON.stringify(['id',c.sellerId,...parts]));
  const name=normalized(c.sellerName), city=normalized(string(c.city).split(/\s+[-(]/)[0]);
  if (name && city && !['azienda su subito','venditore autoscout24','privato'].includes(name))
    keys.push(JSON.stringify(['name',name,city,...parts]));
  return keys;
}
function stockKey(c:MatchCar) {
  const stock=validStock(c.matchIdentity?.stock);
  return c.sellerType === 'dealer' && c.sellerId && stock ? JSON.stringify([c.sellerId,stock]) : '';
}
const keyOf = (c:MatchCar) => c.src+'|'+c.id;
function addIndex(index:Map<string,MatchCar[]>, key:string, car:MatchCar) {
  if (!key) return;
  const bucket=index.get(key);
  if (bucket) bucket.push(car); else index.set(key,[car]);
}
function addPossible(a:MatchCar,b:MatchCar) {
  (a.possibleMatches ||= []).push(asLink(b));
  (b.possibleMatches ||= []).push(asLink(a));
}

// A Subito ID identifies the same offer whether observed live or supplied by a dealer.
// Keep the direct snapshot intact. Dealer identity metadata can confirm a cross-portal match.
export function reconcileSubito<T extends MatchCar>(direct:T[], partner:T[]):T[] {
  const liveById=new Map(direct.map(car=>[car.id,car]));
  const combined=direct.slice();
  for (const stock of partner) {
    const live=liveById.get(stock.id);
    if (!live) {combined.push(stock);continue;}
    if (live.sellerType==='dealer' && sameModel(live,stock)) {
      if (!live.matchIdentity?.vin || !stock.matchIdentity?.vin || validVin(live.matchIdentity.vin)===validVin(stock.matchIdentity.vin)) {
        live.matchIdentity={...stock.matchIdentity,vin:live.matchIdentity?.vin || stock.matchIdentity?.vin};
        if (stock.sellerId) live.sellerId=stock.sellerId;
      }
      if (live.price!==stock.price || !!live.cash!==!!stock.cash || (live.cash && stock.cash && live.cash!==stock.cash) ||
          (!live.note && stock.note)) {
        live.real=false;
        live.note=[live.note,'Condizioni diverse nel catalogo del venditore: prezzo da verificare'].filter(Boolean).join(' · ');
      }
    }
  }
  return combined;
}

export function groupPartnerStock<T extends MatchCar>(primary:T[], supplied:T[]): T[] {
  const byListing=new Map<string,MatchCar[]>(), byVin=new Map<string,MatchCar[]>(), byStock=new Map<string,MatchCar[]>();
  const candidates=new Map<string,MatchCar[]>(), partnerStockCounts=new Map<string,number>();
  const remaining:T[]=[];
  const groupVins=new Map<MatchCar,string>();
  if (supplied.length) {
    for (const car of primary) {
      if (asLink(car).portal === 'autoscout24') addIndex(byListing,String(car.id).toLowerCase(),car);
      addIndex(byVin,validVin(car.matchIdentity?.vin),car);
      addIndex(byStock,stockKey(car),car);
      for (const key of candidateKeys(car)) addIndex(candidates,key,car);
    }
    for (const bucket of candidates.values()) bucket.sort((a,b) => a.km-b.km);
    for (const p of supplied) {
      const key=stockKey(p);
      if (key) partnerStockCounts.set(key,(partnerStockCounts.get(key) || 0)+1);
    }
    for (const partner of supplied) {
      const aliases=[SUBITO.name+'|'+partner.id,PARTNER_SOURCE+'|'+partner.id];
      partner.aliases=aliases;
      const vin=validVin(partner.matchIdentity?.vin), stock=stockKey(partner), paired=partner.matchIdentity?.pairedId;
      const stockHits = stock && partnerStockCounts.get(stock) === 1 ? (byStock.get(stock) || []) : [];
      const hits = new Set([...(paired ? byListing.get(paired) || [] : []), ...(byVin.get(vin) || []), ...stockHits]);
      const eligible = (c:MatchCar) => sameModel(c,partner) && (!vin || !validVin(c.matchIdentity?.vin) || vin===validVin(c.matchIdentity?.vin)) &&
        (!paired || (asLink(c).portal==='autoscout24' && String(c.id).toLowerCase()===paired)) &&
        (!stockKey(c) || !stock || c.sellerId!==partner.sellerId || stockKey(c)===stock);
      const match = hits.size === 1 ? Array.from(hits)[0] : undefined;
      if (match && (!vin || !groupVins.has(match) || groupVins.get(match)===vin) && eligible(match) && (!partner.sellerId || !match.sellerId || partner.sellerId===match.sellerId || (vin && vin===validVin(match.matchIdentity?.vin)))) {
        if (vin) groupVins.set(match,vin);
        (match.offers ||= [asOffer(match)]).push(asOffer(partner));
        (match.aliases ||= [keyOf(match)]).push(...aliases);
        continue;
      }
      remaining.push(partner);
      const seen=new Set<MatchCar>();
      for (const candidateKey of candidateKeys(partner)) {
        const bucket=candidates.get(candidateKey);
        if (!bucket) continue;
        const tolerance=Math.min(1000,Math.max(100,partner.km*.01));
        let lo=0, hi=bucket.length;
        while (lo<hi) {
          const mid=Math.floor((lo+hi)/2);
          if (bucket[mid].km < partner.km-tolerance) lo=mid+1; else hi=mid;
        }
        for (let i=lo;i<bucket.length && bucket[i].km<=partner.km+tolerance;i++) {
          const other=bucket[i];
          // Direct Subito seller IDs are portal-scoped. Two different confirmed AS24 seller IDs conflict.
          const sellerConflict=other.sellerId && partner.sellerId && other.sellerId!==partner.sellerId &&
            !other.sellerId.startsWith('sub:') && !partner.sellerId.startsWith('sub:');
          if (!seen.has(other) && !sellerConflict && eligible(other)) {
            addPossible(partner,other);seen.add(other);
          }
        }
      }
    }
  }
  for (const car of [...primary,...supplied]) delete car.matchIdentity;
  return primary.concat(remaining);
}
