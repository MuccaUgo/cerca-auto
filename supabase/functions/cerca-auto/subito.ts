// Subito.it: lettura diretta, senza account, delle auto in vendita in Lombardia (regione 4 del portale),
// con prezzo pubblicizzato fino a 10.000 € e immatricolazione dal 2020, di privati e aziende.
// Le condizioni generali di Subito (art. 5 e 10) vietano l'accesso con strumenti automatici e l'uso dei contenuti
// da parte di aggregatori non autorizzati: la lettura è attiva per scelta del proprietario dell'app e si spegne
// con il secret SUBITO_DIRECT=off sulla funzione cerca-auto.
// Dei privati non si conservano nome, telefono o ID dell'account: come "venditore" vale il singolo annuncio.
export const SUBITO = { name: 'Subito Lombardia', maxPrice: 10000, minYear: 2020, minPrice: 1500, regionId: '4', pageSize: 30, maxPages: 60 };

type Item = Record<string, any>;
export type SubitoCar = {
  src: string; id: string; brand: string; model: string; ver: string; year: number; reg: string;
  km: number; price: number; old: number; gear: string; res: boolean; unavailable: boolean;
  fuel: string; fuelLabel: string; cv: number; body: string; seats?: number; url: string;
  real: boolean; note: string; cash?: number;
  matchIdentity?: {vin:string}; portal: string; sellerId: string; sellerName: string; sellerType: string; city: string; postcode: string;
};

export const NOTES = {
  conditional: 'Prezzo subordinato a condizioni: verificare finanziamento o permuta',
  vat: 'Prezzo forse IVA esclusa: verificare il totale',
  generic: 'Annuncio generico: prezzo e km da verificare',
  damage: 'Annuncio con danni o riparazioni da fare: verificare',
};

export function subitoUrl(page = 1): string {
  const q = new URLSearchParams({ pe: String(SUBITO.maxPrice), ys: String(SUBITO.minYear) });
  if (page > 1) q.set('o', String(page));
  return 'https://www.subito.it/annunci-lombardia/vendita/auto/?' + q;
}

// Legge i risultati incorporati nella pagina e controlla che il portale abbia applicato davvero
// regione, filtri e numero di pagina: altrimenti la raccolta non è affidabile.
export function parseSubitoPage(html: string, page = 1) {
  const marker = html.indexOf('__NEXT_DATA__'), start = html.indexOf('>', marker) + 1, end = html.indexOf('</script>', start);
  if (marker < 0 || end < start) throw new Error('Subito: struttura dei risultati non riconosciuta');
  const state = JSON.parse(html.slice(start, end)).props?.pageProps?.initialState;
  const items = state?.items, search = state?.search ?? {}, filters = search.filters ?? {};
  if (!Array.isArray(items?.originalList) || !Number.isFinite(items.total) || !Number.isInteger(items.totalPages) || items.totalPages < 0) throw new Error('Subito: risultati non validi');
  if (String(filters.pe) !== String(SUBITO.maxPrice) || String(filters.ys) !== String(SUBITO.minYear) || String(search.geo?.region?.id) !== SUBITO.regionId) throw new Error('Subito: i filtri richiesti non sono stati applicati');
  if (Number(search.page ?? 1) !== page) throw new Error('Subito: la pagina ' + page + ' non è stata restituita');
  return { items: items.originalList as Item[], total: Number(items.total), pages: Number(items.totalPages) };
}

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const feature = (item: Item, uri: string): Item => item?.features?.[uri]?.values?.[0] ?? {};
const number = (value: unknown) => Number(String(value ?? '').replace(/[^\d]/g, '')) || 0;
// Confronti fra testi: minuscolo, senza accenti né punteggiatura.
const key = (value: unknown) => text(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function listId(item: Item): string { return /:list:(\d+)/.exec(String(item?.urn ?? ''))?.[1] ?? ''; }

const ACRONYMS = new Set(['BMW', 'MG', 'DS', 'DR', 'BYD', 'KGM', 'GWM', 'SWM', 'JAC', 'VW', 'BAIC', 'XEV']);
export function brandCase(raw: string): string {
  return text(raw).normalize('NFD').replace(/\p{M}/gu, '').split(/(\s+|-)/)
    .map((w) => ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : /[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join('');
}
function fuel(label: string): string {
  const s = label.toLowerCase();
  return /hybrid|ibrid|elettrica\//.test(s) ? 'Ibrida' : /elettr/.test(s) ? 'Elettrica' : /gpl/.test(s) ? 'GPL' : /metano/.test(s) ? 'Metano' : /diesel/.test(s) ? 'Diesel' : /benzina/.test(s) ? 'Benzina' : '';
}
// Il titolo è scritto dal venditore: tolgo marca e modello iniziali e tengo il resto come versione.
function versionFrom(subject: string, brand: string, model: string, catalogVersion: string): string {
  let s = text(subject);
  for (const word of [brand, model]) {
    const w = text(word).toLowerCase();
    if (w && s.toLowerCase().startsWith(w + ' ')) s = s.slice(w.length).trim();
    else if (w && s.toLowerCase() === w) s = '';
  }
  return s || (/^altro allestimento$/i.test(catalogVersion) ? '' : catalogVersion);
}

// Il catalogo di Subito aggiunge la generazione al modello ("Panda 3ª serie", "500 (2015-2024)"):
// la tolgo, così il nome coincide con quello degli altri siti per doppioni, filtri e confronti.
export function cleanModel(raw: string): string {
  const model = text(raw).replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+\d+[ª°](?:\s*[-/]\s*\d+[ª°])*\s*(?:serie|ser\.?|s\.?)?(?:\s.*)?$/i, '').trim();
  return model || text(raw);
}

// Marca o modello "Altro": tengo l'annuncio solo se il titolo comincia con una marca nota seguita dal modello.
const KNOWN_BRANDS = ['Alfa Romeo', 'Land Rover', 'Lynk & Co', 'Mercedes-Benz', 'Mercedes', 'Abarth', 'Audi', 'BMW', 'BYD', 'Chevrolet',
  'Citroen', 'Cupra', 'Dacia', 'DR', 'DS', 'EVO', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Jaecoo', 'Jaguar', 'Jeep', 'Kia', 'Lancia',
  'Leapmotor', 'Lexus', 'Mahindra', 'Maserati', 'Mazda', 'MG', 'Mini', 'Mitsubishi', 'Nissan', 'Omoda', 'Opel', 'Peugeot', 'Polestar',
  'Porsche', 'Renault', 'Seat', 'Skoda', 'Smart', 'SsangYong', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'VW', 'Volvo'];
const UNKNOWN = /^altr[oa]\b/i;
const NOT_A_MODEL = /^(?:auto|automobile|macchina|vettura|usat[ao]|nuov[ao]|vendo|vendesi|privat[ao]|ottim[ao]|perfett[ao]|neopatentat[io]|incidentat[ao]|serie)$/;
const trimWord = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
export function modelFromSubject(subject: string): { brand: string; model: string; lead: string } | null {
  const words = text(subject).split(' ').map(trimWord).filter((w) => key(w));
  const keys = words.map(key);
  for (const brand of KNOWN_BRANDS) {
    const parts = key(brand).split(' ');
    if (!parts.every((part, i) => keys[i] === part)) continue;
    const rest = words.slice(parts.length);
    if (!rest.length || NOT_A_MODEL.test(key(rest[0]))) return null;
    let model = key(rest[0]) === 'classe' && rest[1] ? rest[0] + ' ' + rest[1] : rest[0];
    if (model.length > 3 && model === model.toUpperCase()) model = model.charAt(0) + model.slice(1).toLowerCase();
    model = model.charAt(0).toUpperCase() + model.slice(1);
    return { brand: brand === 'VW' ? 'Volkswagen' : brand === 'Mercedes' ? 'Mercedes-Benz' : brand, model, lead: words.slice(0, parts.length).join(' ') };
  }
  return null;
}

// Microcar "senza patente", quadricicli e noleggi non sono auto in vendita confrontabili con le altre.
const MICROCAR = /senza\s+patente|mini\s*car|micro\s*car|golf\s*car|quadricicl|\b50\s*cc\b|\b(?:aixam|ligier|chatenet|bellier|casalini|grecav|tazzari|estrima|minauto|jinpeng|microlino|xev|mobilize)\b/i;
const MICRO_MODEL = /^(?:ami|topolino|twizy|rocks e|yoyo|duo|microlino)\b/;
// "Ex leasing" è un'auto in vendita; noleggi, leasing, subentri e rate no.
const RENTAL = /noleggio|\/\s*mese\b|al\s+mese\b|canone|\brat[ae]\s+(?:da|di|mensil)|subentr|cessione\s+(?:del\s+)?contratto|cedo\s+(?:il\s+)?contratto|(?<!\bex[\s-]?)leasing/i;
// Nel testo, solo per prezzi bassi: offerte di noleggio o leasing con anticipo o rata al posto del prezzo.
const RENTAL_BODY = /canone\s+mensile|cedo\s+(?:il\s+)?contratto|cessione\s+(?:del\s+)?contratto|subentr\w*|leasing\s+full|simulazion[ei]\s+(?:da\s+|di\s+)?\d{2}\b/i;
// Chi cerca o compra auto, anche con le lettere separate per aggirare i filtri del portale.
const WANTED = /^\W*(?:cerc(?:o|hiamo)|compr(?:o|iamo)|acquist(?:o|iamo))\b|\b(?:cerc(?:o|hiamo)|compr(?:o|iamo)|acquist(?:o|iamo)|ritir(?:o|iamo))\s+(?:la\s+tua\s+|vostr[ae]\s+|qualsiasi\s+|tutte\s+le\s+)?(?:auto|vettur|macchin)/i;
const SPELLED = /\bc[\W_]{1,8}e[\W_]{1,8}r[\W_]{1,8}c[\W_]{1,8}o\b|\bc[\W_]{1,8}o[\W_]{1,8}m[\W_]{1,8}p[\W_]{1,8}r[\W_]{1,8}o\b/i;
const GENERIC = /diversi\s+colori|diverse\s+versioni|immagini\s+(?:indicative|dimostrative)|varie\s+(?:disponibilit|colorazion)/i;
// "fananziamento" e simili: i refusi sono frequenti negli annunci.
const REAL = /prezzo\s*(?:reale|vero)\b|prezzovero|senza\s+vincoli\b|nessun\s+vincolo\b|no\s+vincoli\b|anche\s+senza\s+f\w{0,3}nanzi|(?:senza|nessun[oa]?|no)\s+(?:alcun[oa]?\s+)?(?:obbligo|vincol\w*)\s+(?:di\s+|a\s+|al\s+|ad\s+)?(?:un\s+)?f\w{0,3}nanzi|non\s+(?:è\s+|e'\s+)?(?:vincolat|subordinat|legat|condizionat)\w*\s+(?:a|al|ad)\s+(?:un\s+)?f\w{0,3}nanzi/i;
const NEGATED = /(?:senza|nessun[oa]?|no)\s+(?:alcun[oa]?\s+)?(?:obbligo|vincol\w*)\s+(?:di\s+|a\s+|al\s+|ad\s+)?(?:un\s+)?(?:f\w{0,3}nanzi\w*|permuta)|non\s+(?:è\s+|e'\s+)?(?:vincolat|subordinat|legat|condizionat|riservat)\w*\s+(?:a|al|ad)\s+(?:un\s+)?(?:f\w{0,3}nanzi\w*|permuta)|anche\s+senza\s+f\w{0,3}nanzi\w*/gi;
const CONDITIONAL = /(?:prezzo|offerta|promo\w*|sconto)[^\n!?]{0,60}?(?:valid[oa]|riservat[oa]|applicabile|vincolat[oa]|subordinat[oa]|condizionat[oa]|legat[oa]|riferit[oa])\b[^\n!?.,;]{0,30}?(?:f\w{0,3}nanzi|permuta|rottamazion)|(?:solo|esclusivamente|unicamente)\s+(?:con|in\s+caso\s+di|tramite|previo|previa|per\s+chi\s+\w+)\s+[^\n!?.,;]{0,25}?(?:f\w{0,3}nanzi|permuta|rottamazion)|prezzo\s+promozional\w*[^\n!?]{0,80}?f\w{0,3}nanzi|f\w{0,3}nanziamento\s+(?:obbligatorio|vincolante)/i;
const CASH = /(?:senza\s+f\w{0,3}nanziamento|prezzo\s+(?:in\s+)?(?:contant[ie]|cash))\s*(?:è|e'|di|a|:|=|-)?\s*(?:€|euro|eur)?\s*:?\s*(\d{1,3}(?:[.'’ ]\d{3})+|\d{4,6})(?:,\d{1,2})?/i;
const VAT = /\+\s*iva\b|(?:prezzo|importo)\s+(?:più|oltre)\s+iva\b|iva\s+esclusa|escluso\s+iva|esclusa\s+iva|oltre\s+iva\b/i;
const NO_DAMAGE = /\b(?:mai|non|nessun[oa]?|senza)\s+(?:(?:stat[oa]|è|e')\s+)?(?:incidentat\w*|sinistr\w*|grandinat\w*)|(?:nulla|niente)\s+da\s+(?:riparare|sistemare)/gi;
const DAMAGE = /incidentat|sinistrat|grandinat|da\s+riparare|da\s+sistemare|non\s+(?:funzionante|marciante|avviabile)\b|motore\s+(?:rotto|fuso|grippato|da\s+rifare)|per\s+ricambi/i;

// Condizioni di prezzo dichiarate nel titolo o nella descrizione. Non sostituisce una verifica col venditore.
export function priceTerms(subject: string, body: string, price: number) {
  const all = (text(subject) + '\n' + String(body ?? '')).replace(/[ \t]+/g, ' ');
  const notes: string[] = [];
  let cash = 0, real = REAL.test(all), conditional = false;
  const found = CASH.exec(all), stated = found ? number(found[1]) : 0;
  if (stated && Math.abs(stated - price) <= price * 0.01) real = true;                 // "senza finanziamento" allo stesso prezzo
  else if (stated > price && stated <= price * 1.6) { cash = stated; real = false; }   // prezzo vero dichiarato più alto
  else if (stated > price) conditional = true;                                         // differenza implausibile: solo avvertenza
  if (!cash && !conditional) conditional = CONDITIONAL.test(all.replace(NEGATED, ' '));
  if (conditional) { notes.push(NOTES.conditional); real = false; }
  if (VAT.test(all)) { notes.push(NOTES.vat); real = false; }
  if (GENERIC.test(text(subject))) notes.push(NOTES.generic);
  if (DAMAGE.test(all.replace(NO_DAMAGE, ' '))) notes.push(NOTES.damage);
  return { real, cash, note: notes.join(' · ') };
}

// Molti privati lasciano l'anno proposto dal modulo. Se gli anni scritti nel titolo o nel testo sono tutti
// precedenti al 2020, o se un'auto di meno di due anni ha oltre 100.000 km, l'anno inserito non è credibile.
const YEAR = /(?<!€\s?)(?<!\d)((?:19[5-9]|20[0-2])\d)(?!\d)(?!\s*(?:€|euro|eur\b|km|cc|kg|kw|cv))/gi;
const STATED_YEAR = /\b(?:anno|immatricol\w*\.?)\s*(?:di\s+|del\s+|nel\s+|il\s+|a\s+|:\s*)?(?:(?:0?[1-9]|1[0-2])[/.-]|(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+)?((?:19|20)\d{2})\b/gi;
export function wrongYear(subject: string, body: string, model: string, isPrivate: boolean, km: number, reg: string, year: number, now = new Date()): boolean {
  const own = new Set(key(model).split(' '));
  const years: number[] = [];
  const pick = (value: string, pattern: RegExp) => { for (const m of value.matchAll(pattern)) if (!own.has(m[1])) years.push(Number(m[1])); };
  pick(subject, YEAR);
  pick(body, STATED_YEAR);
  if (isPrivate) pick(body.trim().split('\n')[0].slice(0, 160), YEAR);
  if (years.length && Math.max(...years) < SUBITO.minYear) return true;
  const month = /^(\d{1,2})\/(\d{4})$/.exec(reg);
  const age = now.getFullYear() + now.getMonth() / 12 - (month ? Number(month[2]) + (Number(month[1]) - 1) / 12 : year + 0.5);
  return age < 2 && km > 100000;
}

// Converte un annuncio in auto del catalogo, oppure restituisce il motivo dell'esclusione.
export function subitoCar(item: Item, now = new Date()): SubitoCar | string {
  const id = listId(item);
  if (!id || item?.kind !== 'AdItem') return 'non_valido';
  if (String(item.geo?.region?.id) !== SUBITO.regionId) return 'fuori_lombardia';
  if (String(item.category?.id) !== '2' || item.type?.key !== 's') return 'non_valido';
  const url = new URL(String(item.urls?.default ?? ''), 'https://www.subito.it');
  if (url.origin !== 'https://www.subito.it' || url.username || url.password || !url.pathname.startsWith('/auto/') || !url.pathname.endsWith('-'+id+'.htm')) return 'non_valido';
  const pack: Item[] = item.features?.['/car']?.values ?? [];
  const catalog = (label: string) => text(pack.find((v) => v?.label === label)?.value);
  const subject = text(item.subject), body = String(item.body ?? '');
  let brand = brandCase(catalog('Marca')), model = cleanModel(catalog('Modello')), lead = catalog('Marca');
  if (!brand || !model) return 'non_valido';
  if (UNKNOWN.test(brand) || UNKNOWN.test(model)) {
    const guess = modelFromSubject(subject);
    if (!guess) return 'modello_sconosciuto';
    ({ brand, model, lead } = guess);
  }
  const price = number(feature(item, '/price').key), reg = text(feature(item, '/register_date').value);
  const year = number(feature(item, '/year').key) || Number(reg.split('/').at(-1)) || 0;
  if (!price) return 'non_valido';
  if (price > SUBITO.maxPrice || !Number.isInteger(year) || year < SUBITO.minYear || year > now.getFullYear() + 1) return 'fuori_filtri';
  if (WANTED.test(subject) || SPELLED.test(subject + '\n' + body)) return 'cerco_o_compro';
  if (MICROCAR.test(subject + ' ' + brand) || MICRO_MODEL.test(key(model))) return 'microcar';
  if (price < SUBITO.minPrice || RENTAL.test(subject) || (price < 6000 && RENTAL_BODY.test(body))) return 'noleggio_o_rata';
  const adv = item.advertiser ?? {}, company = adv.company === true || Number(adv.type) === 1;
  // brumbrum ripubblica qui il proprio stock, già letto per intero dal suo sito.
  if (company && /^brumbrum$/i.test(text(adv.shopName))) return 'brumbrum';
  const km = number(feature(item, '/mileage_scalar').key);
  if (wrongYear(subject, body, model, !company, km, reg, year, now)) return 'anno_incoerente';
  const power = /(\d+)\s*cv/i.exec(text(feature(item, '/power').value)), cv = power ? Number(power[1]) : 0;
  // Auto potenti quasi nuove a pochi euro, o auto di privati a 0 km sotto i 5.000 €: anticipi, rate o annunci civetta.
  if ((cv >= 250 && price < 9000 && year >= now.getFullYear() - 2) || (!company && km === 0 && price < 5000 && year >= now.getFullYear() - 1)) return 'prezzo_implausibile';
  const vin = text(feature(item, '/vin').value);
  const fuelLabel = text(feature(item, '/fuel').value), gear = text(feature(item, '/gearbox').value);
  const town = text(item.geo?.town?.value), province = text(item.geo?.city?.shortName);
  const terms = priceTerms(subject, body, price);
  const seats = number(feature(item, '/seats').value);
  return {
    src: SUBITO.name, id, brand, model, ver: versionFrom(subject, lead, model, catalog('Versione')), year, reg: reg || String(year),
    km, price, old: 0,
    gear: /^man/i.test(gear) ? 'Manuale' : /automat|sequenzial/i.test(gear) ? 'Automatico' : '', res: false, unavailable: false,
    fuel: fuel(fuelLabel), fuelLabel: fuelLabel === 'Altro' ? '' : fuelLabel, cv,
    body: text(feature(item, '/car_type').value), ...(seats ? { seats } : {}), url: url.origin + url.pathname,
    real: terms.real, note: terms.note, ...(terms.cash ? { cash: terms.cash } : {}),
    ...(vin ? {matchIdentity:{vin}} : {}), portal: 'subito', sellerType: company ? 'dealer' : 'private',
    sellerId: company && text(adv.shopId) ? 'sub:shop:' + text(adv.shopId) : 'sub:ad:' + id,
    sellerName: company ? (text(adv.shopName) || 'Azienda su Subito') : 'Privato',
    city: town + (province ? ' (' + province + ')' : ''), postcode: '',
  };
}

export async function collectSubito(getHtml: (url: string) => Promise<string>, budgetMs = 60000) {
  const deadline = Date.now() + budgetMs, first = parseSubitoPage(await getHtml(subitoUrl(1)), 1);
  const cars = new Map<string, SubitoCar>(), seen = new Set<string>(), skipped: Record<string, number> = {};
  let pagesRead = 1, failedPages = 0;
  const add = (items: Item[]) => { for (const item of items) {
    const id = listId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const car = subitoCar(item);
      if (typeof car === 'string') skipped[car] = (skipped[car] ?? 0) + 1; else cars.set(car.id, car);
    } catch (_) { skipped.non_valido = (skipped.non_valido ?? 0) + 1; }
  } };
  add(first.items);
  const target = Math.min(Math.max(1, first.pages), SUBITO.maxPages);
  for (let page = 2; page <= target; page += 3) {
    if (Date.now() >= deadline) break;
    await Promise.all(Array.from({ length: Math.min(3, target - page + 1) }, (_, i) => page + i).map(async (n) => {
      try { add(parseSubitoPage(await getHtml(subitoUrl(n)), n).items); pagesRead++; } catch (_) { failedPages++; }
    }));
  }
  const complete = pagesRead >= Math.max(1, first.pages) && !failedPages;
  return { cars: [...cars.values()], expected: cars.size, complete,
    error: complete ? '' : 'Ricerca Subito parziale: lette ' + pagesRead + ' di ' + first.pages + ' pagine',
    coverage: { pagesRead, pagesExpected: first.pages, searchResults: first.total, uniqueRead: seen.size, skipped, failedPages, maxPrice: SUBITO.maxPrice, minYear: SUBITO.minYear, region: 'Lombardia' },
  };
}

// Molti saloni pubblicano la stessa auto anche su Subito: tengo la copia già letta altrove e scarto quella di Subito.
// Stessa marca, anno e chilometri esatti, modello compatibile e prezzo quasi uguale; con km tondi serve il prezzo quasi identico.
// Vale anche fra due annunci Subito dello stesso salone.
type Comparable = { brand: string; model: string; year: number; km: number; price: number; sellerId?: string };
function fingerprint(c: Comparable): string { return Number(c.km) >= 1000 && Number.isInteger(Number(c.year)) ? key(c.brand) + '|' + c.year + '|' + Number(c.km) : ''; }
function sameModel(a: Comparable, b: Comparable): boolean {
  const x = key(a.model).split(' ')[0], y = key(b.model).split(' ')[0];
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
}
function samePrice(a: Comparable, b: Comparable): boolean {
  const p = Number(a.price), q = Number(b.price), gap = Math.abs(p - q) / Math.max(p, q);
  return Number(b.km) % 1000 === 0 ? gap <= 0.01 : gap <= 0.03 || Math.abs(p - q) <= 300;
}
function put(map: Map<string, Comparable[]>, k: string, car: Comparable) { if (k) (map.get(k) ?? map.set(k, []).get(k)!).push(car); }
export function dropKnownSubito<T extends Comparable>(others: Comparable[], subito: T[]): { cars: T[]; duplicates: number } {
  const elsewhere = new Map<string, Comparable[]>(), mine = new Map<string, Comparable[]>(), out: T[] = [];
  for (const car of others) put(elsewhere, fingerprint(car), car);
  let duplicates = 0;
  for (const car of subito) {
    const k = fingerprint(car);
    const twin = !!k && [...(elsewhere.get(k) ?? []), ...(mine.get(k) ?? []).filter((o) => o.sellerId === car.sellerId)]
      .some((o) => sameModel(o, car) && samePrice(o, car));
    if (twin) { duplicates++; continue; }
    put(mine, k, car);
    out.push(car);
  }
  return { cars: out, duplicates };
}
