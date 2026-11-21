// Alert criteria, in one place: the scan, the notification text and the config endpoint all read them.
export const WATCH = { maxPrice: 10000, minYear: 2020 };

type Offer = {
  src: string; id: string | number; price: number; url: string; cash?: number;
  res?: boolean; unavailable?: boolean; note?: string;
};
export type WatchCar = {
  src: string; id: string | number; brand: string; model: string; year: number;
  price: number; cash?: number; res?: boolean; url: string;
  offers?: Offer[]; watchPrices?: Record<string, number>; watchDropKey?: string;
  [key: string]: unknown;
};
export function carKey(car: Pick<Offer, 'src' | 'id'>): string { return car.src + '|' + car.id; }
// entered_at / entered_from: when a car already in the inventory dropped below the price limit, and from which price.
export type InventoryRow = {
  car_key: string; src: string; first_seen: string; last_seen: string; eligible: boolean;
  entered_at: string | null; entered_from: number | null; car: WatchCar;
};
export type PreviousRow = {
  car_key: string; first_seen: string; eligible: boolean;
  entered_at?: string | null; entered_from?: number | null; price?: number | null;
  last_seen?: string; prices?: Record<string, number> | null; dropKey?: string | null;
};
function currentOffers(car: WatchCar): Offer[] {
  return car.offers?.length ? car.offers : [car];
}
// Only keys of confirmed offers enter this history. Similar-looking cars keep their own history.
export function watchKeys(row: InventoryRow): string[] {
  return row.car.watchPrices ? Object.keys(row.car.watchPrices) : [row.car_key];
}
// Used for push text as well as eligibility, so price, URL and finance conditions always refer to the same offer.
export function selectWatchOffer(car: WatchCar, key?: string): WatchCar | undefined {
  let selected: WatchCar | undefined;
  for (const offer of currentOffers(car)) {
    if (key && carKey(offer) !== key) continue;
    const candidate = offer === car ? car : {
      ...car, ...offer, cash: offer.cash, note: offer.note, res: offer.res, unavailable: offer.unavailable,
    };
    if (matchesWatch(candidate) && (!selected || candidate.price < selected.price)) selected = candidate;
  }
  return selected;
}
export function observeCars(cars: WatchCar[], previous: PreviousRow[], initialized: string[], now: string): InventoryRow[] {
  const byOffer = new Map<string, PreviousRow[]>();
  for (const row of previous) {
    const keys = row.prices ? Object.keys(row.prices) : [row.car_key];
    for (const key of keys) {
      const matches = byOffer.get(key);
      if (matches) matches.push(row);
      else byOffer.set(key, [row]);
    }
  }
  const ready = new Set(initialized);
  return cars.map((car) => {
    const key = carKey(car);
    const offers = currentOffers(car);
    const history = [...new Set(offers.flatMap(offer => byOffer.get(carKey(offer)) ?? []))];
    // Order matters if two previously observed listings have just been confirmed as the same vehicle.
    history.sort((a, b) => Date.parse(a.last_seen ?? a.first_seen) - Date.parse(b.last_seen ?? b.first_seen));
    const prices: Record<string, number> = {};
    let first: PreviousRow | undefined, lastDrop: PreviousRow | undefined;
    for (const row of history) {
      if (!first || Date.parse(row.first_seen) < Date.parse(first.first_seen)) first = row;
      if (row.entered_at && (!lastDrop || Date.parse(row.entered_at) > Date.parse(lastDrop.entered_at!))) lastDrop = row;
      if (row.prices) Object.assign(prices, row.prices);
      else if (Number(row.price) > 0) prices[row.car_key] = Number(row.price);
    }
    let drop: Offer | undefined;
    for (const offer of offers) {
      if (prices[carKey(offer)] > WATCH.maxPrice && matchesWatch({ ...offer, year: car.year, brand: car.brand, model: car.model }) &&
          (!drop || offer.price < drop.price)) drop = offer;
    }
    const from = drop ? prices[carKey(drop)] : lastDrop?.entered_from ?? null;
    const dropKey = drop ? carKey(drop) : lastDrop?.dropKey ?? lastDrop?.car_key;
    for (const offer of offers) prices[carKey(offer)] = offer.price;
    const tracked = Object.keys(prices).length > 1 ? { ...car, watchPrices: prices, watchDropKey: dropKey } : car;
    return {
      car_key: key, src: car.src, first_seen: first?.first_seen ?? now, last_seen: now,
      eligible: first ? first.eligible : ready.has(car.src),
      entered_at: drop ? now : lastDrop?.entered_at ?? null,
      entered_from: from, car: tracked,
    };
  });
}
export function matchesWatch(car: WatchCar): boolean {
  return Number.isFinite(car.price) && car.price > 0 && car.price <= WATCH.maxPrice &&
    Number.isInteger(car.year) && car.year >= WATCH.minYear && !car.res && !car.unavailable;
}
export function safePushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return endpoint.length <= 2048 && url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
       url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
// `from` is the previous price when the alert is a price drop below the limit; empty for a new listing.
export type Alert = { car: WatchCar; from?: number | null };
export type ScanSummary = { checkedAt: string; carsRead: number; sources: number; completeSources: number };
export function failedNotification(tag: string, checkedAt: string) {
  return { title: 'Cerca auto: controllo non riuscito', body: 'Non sono riuscito a completare la ricerca. Non posso confermare se ci sono novità. Riproverò al prossimo controllo.', cars: [], count: 0, tag, created: checkedAt, status: 'error' };
}
export function notification(alerts: Alert[], tag: string, summary?: ScanSummary) {
  const nf = new Intl.NumberFormat('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions);
  const created = summary?.checkedAt ?? new Date().toISOString();
  const partial = !!summary && summary.completeSources < summary.sources;
  if (!alerts.length) {
    const time = new Date(created).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
    return {
      title: partial ? 'Cerca auto: controllo parziale' : 'Cerca auto: nessuna novità',
      body: 'Controllo delle ' + time + ': ' + (partial ? 'nessuna novità dai siti raggiunti. ' : 'nessun nuovo annuncio o ribasso da segnalare. ') +
        (summary ? nf.format(summary.carsRead) + ' annunci letti · ' + summary.completeSources + '/' + summary.sources + ' siti controllati.' : '') +
        (partial ? ' Alcuni siti non hanno risposto completamente.' : ''),
      cars: [], count: 0, tag, created, status: partial ? 'partial' : 'ok',
    };
  }
  const drops = alerts.filter((alert) => alert.from).length, fresh = alerts.length - drops;
  const limit = nf.format(WATCH.maxPrice) + ' €';
  const preview = alerts.slice(0, 2).map(({ car, from }) => ({
    label: (car.brand + ' ' + car.model).trim().slice(0, 70) + ' · ' + car.year + ' · ' + nf.format(car.price) + ' €' +
      (car.cash ? ' con finanziamento' : /finanziamento|prezzo subordinato/i.test(String(car.note ?? '')) ? ' · condizioni di prezzo da verificare' : '') + (from ? ' (era ' + nf.format(from) + ' €)' : ''),
    url: car.url,
  }));
  const title = !drops
    ? (fresh === 1 ? 'Una nuova auto su Cerca auto' : fresh + ' nuove auto su Cerca auto')
    : !fresh
    ? (drops === 1 ? 'Un’auto è scesa sotto i ' + limit : drops + ' auto sono scese sotto i ' + limit)
    : alerts.length + ' novità su Cerca auto: ' + fresh + (fresh === 1 ? ' nuova' : ' nuove') + ', ' + drops + (drops === 1 ? ' ribasso' : ' ribassi');
  return {
    title,
    body: preview.map((car) => car.label).join('\n') +
      (alerts.length === 3 ? '\nE un’altra auto. Apri la ricerca.' : alerts.length > 3 ? '\nE altre ' + (alerts.length - 2) + ' auto. Apri la ricerca.' : '') +
      (partial ? '\nControllo parziale: alcuni siti non hanno risposto completamente.' : ''),
    cars: preview, count: alerts.length, tag, created, status: partial ? 'partial' : 'ok',
  };
}
