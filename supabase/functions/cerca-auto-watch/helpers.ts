// Alert criteria, in one place: the scan, the notification text and the config endpoint all read them.
export const WATCH = { maxPrice: 10000, minYear: 2020 };

export type WatchCar = {
  src: string; id: string | number; brand: string; model: string; year: number;
  price: number; cash?: number; res?: boolean; url: string;
  [key: string]: unknown;
};
export function carKey(car: WatchCar): string { return car.src + '|' + car.id; }
// entered_at / entered_from: when a car already in the inventory dropped below the price limit, and from which price.
export type InventoryRow = {
  car_key: string; src: string; first_seen: string; last_seen: string; eligible: boolean;
  entered_at: string | null; entered_from: number | null; car: WatchCar;
};
export type PreviousRow = {
  car_key: string; first_seen: string; eligible: boolean;
  entered_at?: string | null; entered_from?: number | null; price?: number | null;
};
export function observeCars(cars: WatchCar[], previous: PreviousRow[], initialized: string[], now: string): InventoryRow[] {
  const known = new Map(previous.map((row) => [row.car_key, row]));
  const ready = new Set(initialized);
  return cars.map((car) => {
    const key = carKey(car), old = known.get(key);
    // A known car "enters" the watch when its last stored price was above the limit and it now matches.
    const oldPrice = old ? Number(old.price) : NaN;
    const entered = Number.isFinite(oldPrice) && oldPrice > WATCH.maxPrice && matchesWatch(car);
    return {
      car_key: key, src: car.src, first_seen: old?.first_seen ?? now, last_seen: now,
      eligible: old ? old.eligible : ready.has(car.src),
      entered_at: entered ? now : old?.entered_at ?? null,
      entered_from: entered ? oldPrice : old?.entered_from ?? null,
      car,
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
