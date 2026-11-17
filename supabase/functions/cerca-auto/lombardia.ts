// Ricerca pubblica, senza account, su AutoScout24. Il raggio non è il confine regionale:
// si raccolgono 200 km dal centro proposto dal portale e poi si verifica il CAP del venditore.
export const LOMBARDIA = { name: 'AutoScout24 Lombardia', maxPrice: 10000, minYear: 2020, radiusKm: 200, pageSize: 100, maxPages: 80 };
type Listing = Record<string, any>;
export type RegionalCar = {
  src: string; id: string; brand: string; model: string; ver: string; year: number; reg: string;
  km: number; price: number; old: number; gear: string; res: boolean; unavailable: boolean;
  fuel: string; fuelLabel: string; cv: number; body: string; url: string; real: boolean; note: string;
  portal: string; sellerId: string; sellerName: string; sellerType: string; city: string; postcode: string;
};
export function lombardiaUrl(page = 1): string {
  const q = new URLSearchParams({ atype: 'C', ustate: 'U', cy: 'I', zipr: String(LOMBARDIA.radiusKm), zip: 'Lombardia', lat: '45.66667', lon: '9.5', priceto: String(LOMBARDIA.maxPrice), fregfrom: String(LOMBARDIA.minYear), sort: 'age', desc: '1', size: String(LOMBARDIA.pageSize), page: String(page) });
  return 'https://www.autoscout24.it/lst?' + q;
}
export function isLombardia(location: Listing | undefined): boolean {
  return !!location && ['IT', 'I'].includes(String(location.countryCode).toUpperCase()) && /^(?:2[0-7]\d{3}|46\d{3})$/.test(String(location.zip ?? '').trim());
}
function number(value: unknown): number { return Number(String(value ?? '').replace(/[^\d]/g, '')) || 0; }
function fuel(label: string): string {
  const s = label.toLowerCase();
  return /hybrid|ibrid|elettrica\//.test(s) ? 'Ibrida' : /elettr/.test(s) ? 'Elettrica' : /gpl/.test(s) ? 'GPL' : /metano/.test(s) ? 'Metano' : /diesel/.test(s) ? 'Diesel' : /benzina/.test(s) ? 'Benzina' : '';
}
export function listingCar(l: Listing, knownDealers: Record<string, string> = {}): RegionalCar | null {
  if (!l?.id || !isLombardia(l.location)) return null;
  const v = l.vehicle ?? {}, details = Array.isArray(l.vehicleDetails) ? l.vehicleDetails : [];
  const detail = (icon: string) => String(details.find((d: Listing) => d.iconName === icon)?.data ?? '');
  const reg = detail('calendar'), year = Number(reg.split('/').at(-1)) || Number(String(l.tracking?.firstRegistration ?? '').split('-').at(-1));
  const price = Number(l.price?.priceRaw);
  if (!Number.isFinite(price) || price <= 0 || price > LOMBARDIA.maxPrice || !Number.isInteger(year) || year < LOMBARDIA.minYear || year > new Date().getFullYear() + 1) return null;
  const url = new URL(String(l.url ?? ''), 'https://www.autoscout24.it');
  if (url.origin !== 'https://www.autoscout24.it' || !url.pathname.startsWith('/annunci/')) return null;
  const label = String(v.fuel ?? detail('gas_pump'));
  const power = detail('speedometer').match(/(\d+)\s*(?:CV|PS|hp)\b/i);
  const seller = l.seller ?? {}, kind = String(seller.type).toLowerCase();
  const sellerType = kind === 'dealer' ? 'dealer' : kind === 'privateseller' || kind === 'private' ? 'private' : 'unknown';
  let slug = '';
  try { slug = new URL(seller.links?.infoPage).pathname.match(/^\/concessionari\/([^/]+)/)?.[1] ?? ''; } catch (_) { /* Privati senza pagina del salone. */ }
  const ver = String(v.modelVersionInput ?? '').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  const raw = ver + ' ' + String(v.subtitle ?? '');
  const notes = [l.price?.isConditionalPrice ? 'Prezzo subordinato a condizioni: verificare finanziamento o permuta' : '', /diversi\s+colori|diverse\s+versioni|immagini\s+(?:indicative|dimostrative)|prezzo\s*\+\s*iva/i.test(raw) ? 'Annuncio generico: prezzo e km da verificare' : ''].filter(Boolean);
  const gear = String(v.transmission ?? detail('gearbox'));
  return {
    src: knownDealers[slug] || LOMBARDIA.name, id: String(l.id),
    brand: String(v.make ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''), model: String(v.model ?? ''), ver, year, reg: reg || String(year),
    km: number(l.tracking?.mileage ?? v.mileageInKm ?? detail('mileage_odometer')), price, old: 0,
    gear: /^man/i.test(gear) ? 'Manuale' : /automat|semiautomat/i.test(gear) ? 'Automatico' : '', res: l.isReserved === true, unavailable: l.availableNow === false,
    fuel: fuel(label), fuelLabel: label.replace('Elettrica/', 'Ibrida ').trim(), cv: power ? Number(power[1]) : 0,
    body: typeof v.bodyType === 'string' ? v.bodyType : '', url: url.href,
    real: !l.price?.isConditionalPrice && /prezzo\s*(?:reale|vero)|prezzovero|senza\s+vincoli|nessun\s+vincolo|no\s+vincoli/i.test(raw), note: notes.join(' · '),
    portal: 'autoscout24', sellerId: String(seller.id ?? ''), sellerName: sellerType === 'private' ? 'Privato' : String(seller.companyName ?? 'Venditore AutoScout24'),
    sellerType, city: String(l.location.city ?? ''), postcode: String(l.location.zip),
  };
}
export function parseRegionalPage(html: string) {
  const marker = html.indexOf('__NEXT_DATA__'), start = html.indexOf('>', marker) + 1, end = html.indexOf('</script>', start);
  if (marker < 0 || end < start) throw new Error('AutoScout24: struttura dei risultati non riconosciuta');
  const p = JSON.parse(html.slice(start, end)).props?.pageProps;
  if (!Array.isArray(p?.listings) || !Number.isInteger(p.numberOfPages) || p.numberOfPages < 0 || !Number.isFinite(p.numberOfResults)) throw new Error('AutoScout24: risultati non validi');
  const q = p.pageQuery ?? {};
  if (String(q.priceto) !== String(LOMBARDIA.maxPrice) || String(q.fregfrom) !== String(LOMBARDIA.minYear) || q.cy !== 'I' || String(q.zipr) !== '200') throw new Error('AutoScout24: i filtri richiesti non sono stati applicati');
  return { listings: p.listings as Listing[], pages: p.numberOfPages, total: p.numberOfResults };
}
export async function collectLombardia(getHtml: (url: string) => Promise<string>, knownDealers: Record<string, string> = {}, budgetMs = 75000) {
  const deadline = Date.now() + budgetMs, first = parseRegionalPage(await getHtml(lombardiaUrl()));
  const cars = new Map<string, RegionalCar>(), seen = new Set<string>();
  let pagesRead = 1, rejectedLocation = 0, failedPages = 0;
  const add = (list: Listing[]) => { for (const l of list) {
    if (!l?.id || seen.has(String(l.id))) continue; seen.add(String(l.id));
    if (!isLombardia(l.location)) { rejectedLocation++; continue; }
    try { const car = listingCar(l, knownDealers); if (car) cars.set(car.id, car); } catch (_) { /* Scheda non valida, mai inventare località o prezzo. */ }
  } };
  add(first.listings);
  const target = Math.min(Math.max(1, first.pages), LOMBARDIA.maxPages);
  for (let page = 2; page <= target; page += 3) {
    if (Date.now() >= deadline) break;
    await Promise.all(Array.from({ length: Math.min(3, target - page + 1) }, (_, i) => page + i).map(async (n) => {
      try { const p = parseRegionalPage(await getHtml(lombardiaUrl(n))); add(p.listings); pagesRead++; } catch (_) { failedPages++; }
    }));
  }
  const complete = pagesRead >= Math.max(1, first.pages) && !failedPages;
  return { cars: [...cars.values()], expected: cars.size, complete,
    error: complete ? '' : 'Ricerca Lombardia parziale: lette ' + pagesRead + ' di ' + first.pages + ' pagine',
    coverage: { pagesRead, pagesExpected: first.pages, searchResults: first.total, uniqueRead: seen.size, rejectedLocation, failedPages, maxPrice: LOMBARDIA.maxPrice, minYear: LOMBARDIA.minYear, region: 'Lombardia' },
  };
}

// Mantieni i saloni già configurati come fonte, e arricchisci i doppioni con i dati del venditore.
export function mergeListings<T extends { src: string; id: string; url: string; [key: string]: any }>(cars: T[]): T[] {
  const out = new Map<string, T>();
  for (const car of cars) {
    const identity = /autoscout24\.it\/annunci\//i.test(car.url) ? 'as24|' + car.id.toLowerCase() : car.src + '|' + car.id;
    const old = out.get(identity);
    if (!old) { out.set(identity, car); continue; }
    for (const field of ['sellerId', 'sellerName', 'sellerType', 'city', 'postcode', 'portal']) if (!old[field] && car[field]) Object.assign(old, { [field]: car[field] });
    if (car.note && !old.note?.includes(car.note)) old.note = [old.note, car.note].filter(Boolean).join(' · ');
    if (car.unavailable) old.unavailable = true;
  }
  return [...out.values()];
}
