// Cerca auto — legge in tempo reale gli annunci dei siti configurati e li restituisce in un formato unico.
// Per aggiungere un sito: scrivere una funzione che restituisce { cars, expected } e aggiungerla a SOURCES.

type Car = {
  src: string; id: string; brand: string; model: string; ver: string;
  year: number; reg: string; km: number; price: number; old: number;
  gear: string; res: boolean; fuel: string; fuelLabel: string; cv: number;
  body: string; url: string;
  cash?: number; // prezzo senza finanziamento, quando il prezzo esposto vale solo finanziando
  real?: boolean; // l'annuncio dichiara prezzo reale / senza vincolo di finanziamento
  note?: string; // avvertenza sull'annuncio
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

async function getHtmlOnce(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
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

// Fino a 3 tentativi: i siti ogni tanto rifiutano o lasciano cadere una singola richiesta.
async function getHtml(url: string): Promise<string> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await getHtmlOnce(url);
    } catch (e) {
      last = e;
      console.error("tentativo " + (i + 1) + " fallito: " + url + " — " + String((e as Error).message ?? e));
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
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
    4,
    async (p) => {
      try {
        return parse(await getHtml(base + "?page=" + p)).list;
      } catch (_e) {
        return []; // una pagina persa non deve far perdere tutto il sito
      }
    },
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

// ---------- Concessionari con inventario su Autoscout24 ----------
// Vale per qualsiasi concessionario: basta lo "slug" della sua pagina autoscout24.it/concessionari/<slug>.
const REAL_PRICE = /PREZZO\s+REALE|NO\s+VINCOL|SENZA\s+VINCOL|NESSUN\s+VINCOL|NO\s+OBBLIGO|SENZA\s+OBBLIGO|NESSUN\s+OBBLIGO/i;
const TEASER = /DIVERSI\s+COLORI|EXTRA-?SCONTO|PREZZO\s*\+\s*IVA/i;

function autoscoutDealer(name: string, slug: string): () => Promise<SourceResult> {
  return async () => {
    const base = "https://www.autoscout24.it/concessionari/" + slug;
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
      const rawTitle = String(v.modelVersionInput ?? "") + " " + String(v.subtitle ?? "");
      cars.push({
        src: name,
        id: l.id,
        brand: String(v.make ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        model: String(v.model ?? ""),
        ver: String(v.modelVersionInput ?? "").replace(/\*[^*]*\*/g, " ").replace(/\*/g, " ").replace(/\s+/g, " ").trim(),
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
        real: REAL_PRICE.test(rawTitle),
        note: TEASER.test(rawTitle) ? "Annuncio generico: prezzo e km da verificare" : "",
      });
    }
    return { cars, expected: first.total };
  };
}

// ---------- AM Autoccasione (Milano, sito proprio) ----------
// Il sito espone titolo e una riga di testo libero: "ANNO 2024'KM: 49'000 € 8'950 SENZA FINANZIAMENTO € 10'450".
const BRANDS = ["Alfa Romeo", "Land Rover", "Audi", "BMW", "Citroen", "Cupra", "Dacia", "DS", "Fiat", "Ford", "Honda", "Hyundai",
  "Jeep", "Kia", "Lancia", "Mazda", "Mercedes", "MG", "Mini", "Mitsubishi", "Nissan", "Opel", "Peugeot", "Renault", "Seat",
  "Skoda", "Smart", "Suzuki", "Toyota", "Volkswagen", "Volvo", "Chevrolet", "Jaguar", "Porsche", "Tesla", "Abarth", "Subaru"];
const AUDI_MODELS = /^(A[1-8]|Q[2-8]|TT)\b/i;
const num = (t: string | undefined) => Number(String(t ?? "").replace(/[^\d]/g, "")) || 0;
const cap = (t: string) => t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

async function amAutoccasione(): Promise<SourceResult> {
  const html = await getHtml("https://www.amautoccasione.it/prodotti");
  const re = /<a href="(https:\/\/www\.amautoccasione\.it\/prodotti\/[^"]+)">[\s\S]*?<h4>([\s\S]*?)<\/h4>\s*<p>([\s\S]*?)<\/p>/g;
  const cars: Car[] = [];
  let m: RegExpExecArray | null;
  let found = 0;
  while ((m = re.exec(html))) {
    found++;
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const desc = m[3].replace(/<[^>]+>/g, " ").replace(/&euro;/g, "€").replace(/\s+/g, " ").trim();
    const year = Number((desc.match(/ANNO\s*((?:19|20)\d\d)/i) || [])[1]) || 0;
    const km = num((desc.match(/KM:?\s*([\d'.]+)/i) || [])[1]);
    const parts = desc.split(/SENZA\s+FINANZIAMENTO/i);
    const price = num((parts[0].match(/€\s*([\d'.]+)/) || [])[1]);
    const cash = parts.length > 1 ? num((parts[1].match(/([\d'.]+)/) || [])[1]) : 0;
    if (!price) continue;
    let brand = BRANDS.find((b) => title.toLowerCase().startsWith(b.toLowerCase() + " ") || title.toLowerCase() === b.toLowerCase()) ?? "";
    let rest = brand ? title.slice(brand.length).trim() : title;
    if (!brand && AUDI_MODELS.test(title)) brand = "Audi";
    if (!brand) { brand = cap(title.split(" ")[0]); rest = title.split(" ").slice(1).join(" "); }
    if (brand === "Mercedes") brand = "Mercedes-Benz";
    const words = rest.split(" ").filter(Boolean);
    const model = cap(words[0] ?? "");
    const up = title.toUpperCase();
    const fuel = /HYBRID|IBRID|E-TECH/.test(up) ? "Ibrida" : /\bGPL\b/.test(up) ? "GPL" : /METANO/.test(up) ? "Metano"
      : /ELETTRIC|\bBEV\b/.test(up) ? "Elettrica" : /TDI|CDI|DCI|HDI|MJET|MULTIJET|ECOBLUE|CRDI|DIESEL|\bD\b/.test(up) ? "Diesel" : "Benzina";
    cars.push({
      src: "AM Autoccasione",
      id: m[1].split("/prodotti/")[1],
      brand, model,
      ver: words.slice(1).join(" "),
      year, reg: String(year || ""), km, price, old: 0,
      gear: /DSG|S[- ]?TRONIC|\bAUTO\b|AUTOMATIC|\bEAT\d?\b|CVT|E-TECH|FULL HYBRID/.test(up) ? "Automatico" : "Manuale",
      res: false, fuel, fuelLabel: fuel,
      cv: Number((up.match(/(\d{2,3})\s*CV/) || [])[1]) || 0,
      body: "",
      url: m[1],
      cash: cash > price ? cash : 0,
    });
  }
  if (!found) throw new Error("struttura della pagina cambiata (nessun annuncio trovato)");
  return { cars, expected: found };
}

const SOURCES: { name: string; site: string; run: () => Promise<SourceResult> }[] = [
  { name: "brumbrum", site: "brumbrum.it", run: brumbrum },
  { name: "Achille Car", site: "achillecar.it (Autoscout24)", run: autoscoutDealer("Achille Car", "achille-car-srl") },
  { name: "AM Autoccasione", site: "amautoccasione.it", run: amAutoccasione },
  { name: "Lanzocar", site: "Cologno Monzese (Autoscout24)", run: autoscoutDealer("Lanzocar", "lanzocar-srl") },
  { name: "Little Cars 3", site: "Sesto San Giovanni (Autoscout24)", run: autoscoutDealer("Little Cars 3", "little-cars-3-di-500cars-snc") },
  { name: "Broker Mobility", site: "Milano (Autoscout24)", run: autoscoutDealer("Broker Mobility", "brokermobility-by-rent-76-srl") },
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
        console.error(s.name + " non letto: " + String((e as Error).message ?? e));
        return { name: s.name, site: s.site, ok: false, expected: 0, got: 0, error: String((e as Error).message ?? e), cars: [] as Car[] };
      }
    }),
  );
  const body = JSON.stringify({
    updated: new Date().toISOString(),
    sources: results.map(({ cars: _c, ...meta }) => meta),
    cars: results.flatMap((r) => r.cars).filter((c) => c.price > 0),
  });
  // In memoria solo i risultati completi: un errore momentaneo non deve restare per minuti.
  if (results.every((r) => r.ok && r.got >= r.expected)) cache = { at: Date.now(), body };
  return new Response(body, { headers });
});
