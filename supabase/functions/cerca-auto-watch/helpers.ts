export type WatchCar = {
  src: string; id: string | number; brand: string; model: string; year: number;
  price: number; cash?: number; res?: boolean; url: string;
  [key: string]: unknown;
};
export function carKey(car: WatchCar): string { return car.src + '|' + car.id; }
export type InventoryRow = { car_key: string; src: string; first_seen: string; last_seen: string; eligible: boolean; car: WatchCar };
export function observeCars(cars: WatchCar[], previous: { car_key: string; first_seen: string; eligible: boolean }[], initialized: string[], now: string): InventoryRow[] {
  const known = new Map(previous.map((row) => [row.car_key, row]));
  const ready = new Set(initialized);
  return cars.map((car) => {
    const key = carKey(car), old = known.get(key);
    return { car_key: key, src: car.src, first_seen: old?.first_seen ?? now, last_seen: now, eligible: old ? old.eligible : ready.has(car.src), car };
  });
}
export function matchesWatch(car: WatchCar): boolean {
  return Number.isFinite(car.price) && car.price > 0 && car.price <= 10000 &&
    Number.isInteger(car.year) && car.year >= 2020 && !car.res;
}
export function safePushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return endpoint.length <= 2048 && url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
       url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export function notification(cars: WatchCar[], tag: string) {
  const nf = new Intl.NumberFormat('it-IT');
  const preview = cars.slice(0, 2).map((car) => ({
    label: (car.brand + ' ' + car.model).trim().slice(0, 70) + ' · ' + car.year + ' · ' + nf.format(car.price) + ' €' + (car.cash ? ' con finanziamento' : ''),
    url: car.url,
  }));
  return {
    title: cars.length === 1 ? 'Una nuova auto su Cerca auto' : cars.length + ' nuove auto su Cerca auto',
    body: preview.map((car) => car.label).join('\n') + (cars.length > 2 ? '\nE altre ' + (cars.length - 2) + ' auto. Apri la ricerca.' : ''),
    cars: preview, count: cars.length, tag, created: new Date().toISOString(),
  };
}
