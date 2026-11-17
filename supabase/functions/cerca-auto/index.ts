// Cerca auto — legge in tempo reale gli annunci dei siti configurati e li restituisce in un formato unico.
// Per aggiungere un sito: scrivere una funzione che restituisce { cars, expected } e aggiungerla a SOURCES.

type Car = {
  src: string; id: string; brand: string; model: string; ver: string;
  year: number; reg: string; km: number; price: number; old: number;
  gear: string; res: boolean; fuel: string; fuelLabel: string; cv: number;
  body: string; url: string;
};
type SourceResult = { cars: Car[]; expected: number };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const CACHE_MS = 3 * 60 * 1000;
let cache: { at: number; body: string } | null = null;

async function getHtml(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "it-IT,it;q=0.9" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status + " su " + url);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function nextData(html: string): any {
  const i = html.indexOf("__NEXT_DATA__");
  if (i < 0) throw new Error("struttura della pagina cambiata (manca __NEXT_DATA__)");
  const a = html.indexOf(">", i) + 1;
  const b = html.indexOf("</script>", a);
  return JSON.parse(html.slice(a, b));
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

function fuelCategory(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("hybrid") || l.includes("ibrid") || l.includes("elettrica/")) return "Ibrida";
  if (l.includes("elettr")) return "Elettrica";
  if (l.includes("gpl")) return "GPL";
  if (l.includes("metano")) return "Metano";
  if (l.includes("diesel")) return "Diesel";
  return "Benzina";
}

// ---------- brumbrum.it ----------
async function brumbrum(): Promise<SourceResult> {
  const base = "https://www.brumbrum.it/auto/usata";
  const parse = (html: string) => {
    const st = nextData(html).props.initialReduxState;
    const found = Object.values(st.auto.found ?? {})[0] as unknown[] | undefined;
    return { list: Object.values(st.auto.list ?? {}) as any[], total: found ? found.length : 0 };
  };
  const first = parse(await getHtml(base));
  const pages = Math.max(1, Math.ceil(first.total / 24));
  const rest = await inBatches(
    Array.from({ length: pages - 1 }, (_, i) => i + 2),
    6,
    async (p) => parse(await getHtml(base + "?page=" + p)).list,
  );
  const seen = new Set<string>();
  const cars: Car[] = [];
  for (const a of [first.list, ...rest].flat()) {
    if (!a || !a.id_auto || seen.has(a.id_auto)) continue;
    seen.add(a.id_auto);
    const price = Number(a.prezzo_sellout) || 0;
    const pub = Number(a.publication_prezzo_sellout) || 0;
    const label = String(a.alimentazione ?? "");
    cars.push({
      src: "brumbrum",
      id: a.id_auto,
      brand: String(a.marca ?? ""),
      model: String(a.modello ?? ""),
      ver: [a.allestimento_breve, a.motorizzazione].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
      year: Number(a.anno) || 0,
      reg: String(a.anno ?? ""),
      km: Number(a.km) || 0,
      price,
      old: pub > price ? pub : 0,
      gear: String(a.cambio ?? "").toLowerCase().startsWith("man") ? "Manuale" : "Automatico",
      res: String(a.disponibilita ?? "") !== "Disponibile",
      fuel: fuelCategory(label),
      fuelLabel: label,
      cv: Number(a.potenza) || 0,
      body: String(a.tipologia ?? ""),
      url: "https://www.brumbrum.it" + a.url,
    });
  }
  return { cars, expected: first.total };
}

// ---------- Achille Car (inventario su Autoscout24) ----------
async function achilleCar(): Promise<SourceResult> {
  const base = "https://www.autoscout24.it/concessionari/achille-car-srl";
  const parse = (html: string) => {
    const p = nextData(html).props.pageProps;
    return { list: (p.listings ?? []) as any[], total: Number(p.numberOfResults) || 0 };
  };
  const first = parse(await getHtml(base));
  const pages = Math.max(1, Math.ceil(first.total / 20));
  const rest = await inBatches(
    Array.from({ length: pages - 1 }, (_, i) => i + 2),
    4,
    async (p) => {
      try {
        return parse(await getHtml(base + "/veicoli?page=" + p)).list;
      } catch (_e) {
        return [];
      }
    },
  );
  const seen = new Set<string>();
  const cars: Car[] = [];
  for (const l of [first.list, ...rest].flat()) {
    if (!l || !l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    const v = l.vehicle ?? {};
    const reg = String(v.firstRegistrationDate?.formatted ?? "");
    const rawDate = String(v.firstRegistrationDate?.raw ?? "");
    const label = String(v.fuelCategory?.formatted ?? "");
    cars.push({
      src: "Achille Car",
      id: l.id,
      brand: String(v.make ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""),
      model: String(v.model ?? ""),
      ver: String(v.modelVersionInput ?? "").replace(/\*[^*]*\*/g, "").replace(/\s+/g, " ").trim(),
      year: Number(rawDate.slice(0, 4)) || Number(reg.split("/")[1]) || 0,
      reg,
      km: Number(v.mileageInKm?.raw) || 0,
      price: Number(l.prices?.public?.priceRaw) || 0,
      old: 0,
      gear: String(v.transmissionType?.formatted ?? "").toLowerCase().startsWith("man") ? "Manuale" : "Automatico",
      res: false,
      fuel: fuelCategory(label),
      fuelLabel: label.replace("Elettrica/", "Ibrida ").trim(),
      cv: Number(v.powerInHp?.raw) || 0,
      body: String(v.bodyType?.formatted ?? ""),
      url: "https://www.autoscout24.it" + l.url,
    });
  }
  return { cars, expected: first.total };
}

const SOURCES: { name: string; site: string; run: () => Promise<SourceResult> }[] = [
  { name: "brumbrum", site: "brumbrum.it", run: brumbrum },
  { name: "Achille Car", site: "achillecar.it (Autoscout24)", run: achilleCar },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const headers = { ...CORS, "Content-Type": "application/json; charset=utf-8" };
  if (cache && Date.now() - cache.at < CACHE_MS) return new Response(cache.body, { headers });

  const results = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const r = await s.run();
        return { name: s.name, site: s.site, ok: true, expected: r.expected, got: r.cars.length, error: "", cars: r.cars };
      } catch (e) {
        return { name: s.name, site: s.site, ok: false, expected: 0, got: 0, error: String((e as Error).message ?? e), cars: [] as Car[] };
      }
    }),
  );
  const body = JSON.stringify({
    updated: new Date().toISOString(),
    sources: results.map(({ cars: _c, ...meta }) => meta),
    cars: results.flatMap((r) => r.cars).filter((c) => c.price > 0),
  });
  if (results.some((r) => r.ok)) cache = { at: Date.now(), body };
  return new Response(body, { headers });
});
