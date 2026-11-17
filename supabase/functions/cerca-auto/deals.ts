// Migliori affari: stima il prezzo "normale" di ogni auto dal confronto con le altre in catalogo
// e misura di quanto il prezzo esposto sta sotto (o sopra) quella stima.
//
// Metodo, in breve:
// 1. Un'unica regressione sul logaritmo del prezzo stima quanto pesano età, chilometri, potenza, cambio,
//    alimentazione e vendita tra privati, confrontando solo auto dello stesso modello tra loro.
// 2. Il livello di prezzo di ogni modello si ricava dalle ALTRE auto dello stesso modello (mai dall'auto
//    stessa), con un richiamo verso la media della marca quando i confronti sono pochi.
// 3. Lo scarto dalla stima è valutato rispetto alla dispersione tipica: conta come affare solo uno scarto
//    insolito, e uno scarto enorme è trattato come anomalia da verificare, non come occasione.

export type Deal = { est: number; pct: number; n: number; lvl: number };
export type DealCar = {
  src: string; brand: string; model: string; ver?: string; year: number; reg?: string; km: number; price: number;
  cash?: number; cv?: number; gear?: string; fuel?: string; res?: boolean; note?: string; deal?: Deal;
};

const MIN_COMPS = 3;   // auto dello stesso modello necessarie per dare una stima
const K_MODEL = 2;     // richiamo verso la marca quando i confronti sono pochi
const K_BRAND = 4;     // richiamo della marca verso la media generale
const Z_GOOD = 0.9, PCT_GOOD = 0.06;              // "Buon prezzo"
const Z_TOP = 1.5, PCT_TOP = 0.10, N_TOP = 4;     // "Ottimo affare"
const Z_ODD = 3.2, PCT_ODD = 0.33;                // troppo sotto la stima: anomalia da verificare
const SUSPECT = /DA SISTEMARE|NON MARCIANTE|INCIDENTAT|COMMERCIANT|EXPORT|GUAST|MOTORE (ROTTO|FUSO)/i;
const NAMES = ['age', 'age2', 'km10', 'lncv', 'auto', 'hybrid', 'diesel', 'gas', 'electric', 'private'];

const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

// Risolve A·x = b per eliminazione di Gauss con pivot parziale; null se il sistema non è risolvibile.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

type Row = { car: DealCar; price: number; y: number; x: number[]; model: string; brand: string; r: number };

export function scoreDeals(cars: DealCar[], now: number) {
  for (const car of cars) delete car.deal;
  const today = new Date(now), thisYear = today.getUTCFullYear() + today.getUTCMonth() / 12;
  const rows: Row[] = [];
  for (const car of cars) {
    // Con un prezzo valido solo finanziando, il confronto si fa sul prezzo senza finanziamento.
    const price = Number(car.cash) > 0 ? Number(car.cash) : Number(car.price);
    const m = /^(\d{1,2})\/(\d{4})$/.exec(String(car.reg ?? ''));
    const year = m ? Number(m[2]) : Number(car.year), month = m ? Number(m[1]) : 7;
    const age = Math.max(0, thisYear - (year + (month - 1) / 12)), km = Number(car.km), note = String(car.note ?? '');
    const usable = Number.isFinite(price) && price >= 500 && Number.isInteger(year) && age <= 20 &&
      Number.isFinite(km) && km >= 0 && !(km === 0 && age > 1.5) &&               // km mancanti
      !/da verificare/i.test(note) && !SUSPECT.test(String(car.ver ?? '')) &&     // annunci generici o auto da sistemare
      norm(car.brand) !== '' && norm(car.model) !== '';
    if (!usable) continue;
    const fuel = String(car.fuel ?? '');
    rows.push({
      car, price, y: Math.log(price), r: 0, brand: norm(car.brand), model: norm(car.brand) + '|' + norm(car.model),
      x: [age, age * age / 10, km / 10000, Number(car.cv) > 0 ? Math.log(Number(car.cv)) : NaN,
        car.gear === 'Automatico' ? 1 : 0, fuel === 'Ibrida' ? 1 : 0, fuel === 'Diesel' ? 1 : 0,
        fuel === 'GPL' || fuel === 'Metano' ? 1 : 0, fuel === 'Elettrica' ? 1 : 0, /privati/i.test(note) ? 1 : 0],
    });
  }
  const info = { cars: cars.length, usable: rows.length, scored: 0, models: 0, sigma: 0, beta: {} as Record<string, number>, top: 0, good: 0, odd: 0 };
  if (rows.length < 60) return info;

  const by = (key: (row: Row) => string) => {
    const map = new Map<string, Row[]>();
    for (const row of rows) { const k = key(row); (map.get(k) ?? map.set(k, []).get(k)!).push(row); }
    return map;
  };
  const models = by((row) => row.model), brands = by((row) => row.brand);
  // Potenza mancante: media del modello, poi della marca, poi generale.
  const LNCV = 3;
  const known = (list: Row[]) => list.map((row) => row.x[LNCV]).filter(Number.isFinite);
  const overall = known(rows).length ? mean(known(rows)) : Math.log(90);
  for (const row of rows) {
    if (Number.isFinite(row.x[LNCV])) continue;
    const a = known(models.get(row.model)!), b = known(brands.get(row.brand)!);
    row.x[LNCV] = a.length ? mean(a) : b.length ? mean(b) : overall;
  }

  // 1) Pesi delle caratteristiche: minimi quadrati sugli scarti dalla media del proprio modello.
  const k = NAMES.length;
  const fit = (skip: Set<Row>) => {
    const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
    const centered: { row: Row; dx: number[]; dy: number }[] = [];
    for (const list of models.values()) {
      const use = list.filter((row) => !skip.has(row));
      if (use.length < 2) continue;
      const my = mean(use.map((row) => row.y)), mx = NAMES.map((_, j) => mean(use.map((row) => row.x[j])));
      for (const row of use) centered.push({ row, dx: row.x.map((v, j) => v - mx[j]), dy: row.y - my });
    }
    for (const c of centered) for (let i = 0; i < k; i++) { Xty[i] += c.dx[i] * c.dy; for (let j = 0; j < k; j++) XtX[i][j] += c.dx[i] * c.dx[j]; }
    const ridge = 1e-3 * (XtX.reduce((a, row, i) => a + row[i], 0) / k || 1);   // tiene stabili le variabili che variano poco
    for (let i = 0; i < k; i++) XtX[i][i] += ridge;
    const beta = solve(XtX, Xty);
    if (!beta) return null;
    const res = centered.map((c) => ({ row: c.row, e: c.dy - c.dx.reduce((a, v, j) => a + v * beta[j], 0) }));
    const sd = Math.sqrt(res.reduce((a, c) => a + c.e * c.e, 0) / Math.max(1, res.length - k));
    return { beta, res, sd, n: centered.length };
  };
  let model = fit(new Set());
  if (!model || model.n < 40) return info;
  // Secondo passaggio senza i casi estremi, perché non spostino i pesi.
  const refit = fit(new Set(model.res.filter((c) => Math.abs(c.e) > 2.5 * model!.sd).map((c) => c.row)));
  if (refit && refit.n >= 40) model = refit;
  const beta = model.beta;
  NAMES.forEach((name, j) => info.beta[name] = Math.round(beta[j] * 1000) / 1000);
  for (const row of rows) row.r = row.y - row.x.reduce((a, v, j) => a + v * beta[j], 0);

  // 2) Livello di prezzo del modello, stimato dalle altre auto dello stesso modello.
  const overallLevel = mean(rows.map((row) => row.r));
  const scored: { row: Row; est: number; n: number; d: number }[] = [];
  for (const row of rows) {
    const peers = models.get(row.model)!.filter((other) => other !== row).map((other) => other.r);
    if (peers.length < MIN_COMPS) continue;
    const sameBrand = brands.get(row.brand)!.filter((other) => other !== row).map((other) => other.r);
    const brandLevel = (sameBrand.reduce((a, b) => a + b, 0) + K_BRAND * overallLevel) / (sameBrand.length + K_BRAND);
    const center = peers.length >= 4 ? median(peers) : mean(peers);
    const level = (peers.length * center + K_MODEL * brandLevel) / (peers.length + K_MODEL);
    const est = Math.exp(level + (row.y - row.r));
    scored.push({ row, est, n: peers.length, d: Math.log(est / row.price) });
  }
  info.scored = scored.length; info.models = new Set(scored.map((s) => s.row.model)).size;
  if (scored.length < 30) return info;

  // 3) Quanto è insolito lo scarto: dispersione robusta (mediana degli scarti assoluti).
  const mid = median(scored.map((s) => s.d));
  const sigma = Math.max(0.05, 1.4826 * median(scored.map((s) => Math.abs(s.d - mid))));
  info.sigma = Math.round(sigma * 1000) / 1000;
  for (const s of scored) {
    const z = (s.d - mid) / sigma, pct = 1 - s.row.price / s.est;
    let lvl = 0;
    if (!s.row.car.res) {
      if (z >= Z_ODD || pct >= PCT_ODD) lvl = -1;
      else if (z >= Z_TOP && pct >= PCT_TOP && s.n >= N_TOP) lvl = 2;
      else if (z >= Z_GOOD && pct >= PCT_GOOD) lvl = 1;
    }
    if (lvl === 2) info.top++; else if (lvl === 1) info.good++; else if (lvl === -1) info.odd++;
    s.row.car.deal = { est: Math.round(s.est / 50) * 50, pct: Math.round(pct * 100), n: s.n, lvl };
  }
  return info;
}

