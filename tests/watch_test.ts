// Prova locale della funzione cerca-auto-watch: database, catalogo e servizio push sono finti e in memoria.
import webpush from 'npm:web-push@3.6.7';
import ece from 'npm:http_ece@1.2.0';
import { createECDH, randomBytes } from 'node:crypto';
import { matchesWatch, notification, observeCars } from '../supabase/functions/cerca-auto-watch/helpers.ts';

Deno.env.set('SUPABASE_URL', 'https://proj.test'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'svc'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');
const vapid = webpush.generateVAPIDKeys();
const client = createECDH('prime256v1'); client.generateKeys();
const auth = randomBytes(16);
const pg = (ms: number) => new Date(ms).toISOString().replace('Z', '+00:00');   // formato di PostgREST
const H = 3600000, T = Date.now();
const mk = (src: string, id: string, price: number, year = 2021, extra: Record<string, unknown> = {}) =>
  ({ src, id, brand: 'Fiat', model: 'Panda ' + id, year, price, res: false, url: 'https://example.com/' + id, ...extra });

const st = {
  inventory: new Map<string, any>(), sources: new Set<string>(['brumbrum', 'AM Autoccasione']),
  subs: [{ id: 'sub1', subscription: { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: client.getPublicKey('base64url'), auth: auth.toString('base64url') } }, token_hash: 'x', enabled: true, created_at: pg(T - H) }],
  sent: [] as any[], runs: new Map<string, any>(), pushes: [] as any[], catalog: [] as any[], pushStatus: 201, catalogStatus: 200, partial: false, pagedReads: 0, unordered: 0,
};
const baseline = (car: any) => st.inventory.set(car.src + '|' + car.id, { car_key: car.src + '|' + car.id, src: car.src, first_seen: pg(T - 4 * H), last_seen: pg(T - 4 * H), eligible: false, entered_at: null, entered_from: null, car });

let handler: (req: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url), method = init.method ?? 'GET';
  const json = (v: unknown, status = 200) => new Response(v === null ? null : JSON.stringify(v), { status });
  if (url.hostname === 'web.push.apple.com') {
    if (st.pushStatus < 300) st.pushes.push(JSON.parse(ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: client, authSecret: auth }).toString()));
    return new Response(null, { status: st.pushStatus });
  }
  if (url.pathname === '/functions/v1/cerca-auto') return json({ updated: new Date().toISOString(), sources: [...new Set(st.catalog.map((c) => c.src))].map((name, i) => ({ name, ok: !(st.partial && i === 0), got: 1, expected: 1 })), cars: st.catalog }, st.catalogStatus);
  const table = url.pathname.replace('/rest/v1/', ''), q = url.searchParams, body = init.body ? JSON.parse(String(init.body)) : null;
  const page = (rows: any[]) => { if (q.has('offset')) { st.pagedReads++; if (!q.get('order')) st.unordered++; } const o = Number(q.get('offset') ?? 0); return json(rows.slice(o, o + Number(q.get('limit') ?? 1e9))); };
  if (table === 'rpc/car_watch_get_secrets') return json({ cerca_auto_vapid: JSON.stringify(vapid), cerca_auto_cron_secret: 'cron' });
  if (table === 'rpc/car_watch_claim') return json(true);
  if (table === 'rpc/car_watch_release') return json(null);
  if (table === 'car_watch_runs') {
    if (method === 'POST') { st.runs.set(body.id, body); return json(null, 201); }
    if (method === 'PATCH') { const id = q.get('id')!.slice(3); Object.assign(st.runs.get(id), body); return json(null, 204); }
    return json([]);
  }
  if (table === 'car_watch_inventory') {
    if (method === 'POST') { for (const row of body) { if (!('entered_at' in row) || !('entered_from' in row)) throw new Error('riga senza colonne ribasso'); st.inventory.set(row.car_key, row); } return json(null, 201); }
    if (!q.get('select')!.includes('price:car->price')) throw new Error('manca il prezzo precedente');
    return page([...st.inventory.values()].sort((a, b) => a.car_key < b.car_key ? -1 : 1).map((r) => ({ car_key: r.car_key, first_seen: r.first_seen, eligible: r.eligible, entered_at: r.entered_at, entered_from: r.entered_from, price: r.car.price, last_seen: r.last_seen, prices: r.car.watchPrices, dropKey: r.car.watchDropKey })));
  }
  if (table === 'car_watch_sources') { if (method === 'POST') { body.forEach((r: any) => st.sources.add(r.name)); return json(null, 201); } return page([...st.sources].sort().map((name) => ({ name }))); }
  if (table === 'car_watch_subscriptions') { if (method === 'PATCH') return json(null, 204); return page(st.subs.filter((s) => s.enabled)); }
  if (table === 'car_watch_sent') { if (method === 'POST') { st.sent.push(...body); return json(null, 201); } return page(st.sent.filter((r) => 'eq.' + r.subscription_id === q.get('subscription_id'))); }
  throw new Error('richiesta non prevista: ' + method + ' ' + url.href);
}) as any;

await import('../supabase/functions/cerca-auto-watch/index.ts');
async function scan() {
  const before = st.pushes.length;
  const res = await handler(new Request('https://proj.test/functions/v1/cerca-auto-watch?action=scan', { method: 'POST', headers: { 'x-watch-secret': 'cron' }, body: '{}' }));
  const out = await res.json(); const run = out.runId ? st.runs.get(out.runId) : [...st.runs.values()].at(-1);
  return { status: res.status, out, run, pushes: st.pushes.slice(before) };
}
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '\n       atteso: ' + JSON.stringify(want) + '\n       avuto:  ' + JSON.stringify(got)));
}
const sentKeys = () => st.sent.map((r) => r.car_key).sort();

// Stock iniziale, registrato prima dell'iscrizione: nessuna di queste auto è "nuova".
const filler = Array.from({ length: 620 }, (_, i) => mk('brumbrum', 'F' + String(i).padStart(3, '0'), 20000));
const base = [mk('brumbrum', 'K1', 10490), mk('brumbrum', 'K2', 9990), mk('brumbrum', 'K3', 10490, 2019), mk('brumbrum', 'K4', 10490),
  mk('brumbrum', 'K5', 12000), mk('AM Autoccasione', 'AM1', 10500, 2023, { cash: 12500 }), ...filler];
base.forEach(baseline);

// 1) ribassi sotto soglia + una vera novità
st.catalog = [mk('brumbrum', 'K1', 9990), mk('brumbrum', 'K2', 9490), mk('brumbrum', 'K3', 9990, 2019), mk('brumbrum', 'K4', 9990, 2021, { res: true }),
  mk('brumbrum', 'K5', 11000), mk('AM Autoccasione', 'AM1', 9900, 2023, { cash: 11900 }), mk('brumbrum', 'N1', 9500, 2022), mk('brumbrum', 'N2', 15000), ...filler];
let r = await scan();
check('1 esito', [r.status, r.run.status, r.run.new_cars, r.run.price_drops, r.run.pushes_sent], [200, 'ok', 2, 2, 1]);
check('1 avvisate solo K1, AM1 (ribasso) e N1 (nuova)', sentKeys(), ['AM Autoccasione|AM1', 'brumbrum|K1', 'brumbrum|N1']);
check('1 titolo', r.pushes[0]?.title, '3 novità su Cerca auto: 1 nuova, 2 ribassi');
check('1 testo', r.pushes[0]?.body, 'Fiat Panda N1 · 2022 · 9.500 €\nFiat Panda AM1 · 2023 · 9.900 € con finanziamento (era 10.500 €)\nE un’altra auto. Apri la ricerca.');
check('1 letture a pagine tutte ordinate', [st.pagedReads > 4, st.unordered], [true, 0]);
check('1 storico: prezzo di partenza salvato', [st.inventory.get('brumbrum|K1').entered_from, st.inventory.get('brumbrum|K2').entered_at], [10490, null]);

// 2) stesso catalogo: conferma il controllo senza ripetere le auto
r = await scan();
check('2 conferma senza ripetizione', [r.run.status, r.run.new_cars, r.run.price_drops, r.run.pushes_sent, r.pushes.length, r.pushes[0]?.count], ['ok', 0, 0, 1, 1, 0]);
check('2 titolo nessuna novità', r.pushes[0]?.title, 'Cerca auto: nessuna novità');
check('2 nessuna auto nella conferma', r.pushes[0]?.cars, []);
check('2 il ribasso resta in storico', st.inventory.get('brumbrum|K1').entered_at !== null, true);

// 3) un'auto comparsa dopo l'iscrizione, fuori budget, scende sotto soglia
st.catalog = st.catalog.map((c) => c.id === 'N2' ? { ...c, price: 9800 } : c);
r = await scan();
check('3 ribasso singolo', [r.run.price_drops, r.pushes[0]?.title, r.pushes[0]?.body], [1, 'Un’auto è scesa sotto i 10.000 €', 'Fiat Panda N2 · 2021 · 9.800 € (era 15.000 €)']);

// 4) il servizio push è giù: l'avviso non va perso, parte al controllo successivo
st.pushStatus = 500; st.catalog = st.catalog.map((c) => c.id === 'K5' ? { ...c, price: 9900 } : c);
r = await scan();
check('4 invio fallito', [r.run.status, r.run.price_drops, r.run.pushes_sent, sentKeys().includes('brumbrum|K5')], ['partial', 1, 0, false]);
st.pushStatus = 201; r = await scan();
check('4 recuperato al giro dopo', [r.run.status, r.run.price_drops, r.pushes[0]?.body, sentKeys().includes('brumbrum|K5')], ['ok', 0, 'Fiat Panda K5 · 2021 · 9.900 € (era 11.000 €)', true]);

// 5) un'auto già avvisata risale e riscende: niente secondo avviso
st.catalog = st.catalog.map((c) => c.id === 'K1' ? { ...c, price: 10600 } : c); await scan();
st.catalog = st.catalog.map((c) => c.id === 'K1' ? { ...c, price: 9900 } : c); r = await scan();
check('5 niente doppio annuncio, ma esito inviato', [r.run.price_drops, r.pushes.length, r.pushes[0]?.count], [1, 1, 0]);

// 6) un dispositivo che si iscrive dopo non riceve i ribassi vecchi
st.subs.push({ ...st.subs[0], id: 'sub2', created_at: pg(Date.now()) }); await new Promise((ok) => setTimeout(ok, 5));
r = await scan();
check('6 esito per entrambi senza arretrati', [r.pushes.length, r.pushes.every((p) => p.count === 0), st.sent.filter((x) => x.subscription_id === 'sub2').length], [2, true, 0]);

// 7) una fonte assente non diventa una falsa conferma di assenza di novità.
st.partial = true; r = await scan();
check('7 esito parziale', [r.run.status, r.pushes.length, r.pushes[0]?.title, r.pushes[0]?.status], ['partial', 2, 'Cerca auto: controllo parziale', 'partial']);
check('7 testo distingue le fonti non raggiunte', r.pushes[0]?.body.includes('Alcuni siti non hanno risposto completamente.'), true);
st.partial = false;

// 8) nessun catalogo utile: segnala l'errore, senza toccare la deduplicazione.
const sentBeforeError = sentKeys(); st.catalogStatus = 503; r = await scan();
check('8 esito ricerca fallita', [r.status, r.run.status, r.run.pushes_sent, r.pushes[0]?.title, r.pushes[0]?.status], [500, 'error', 2, 'Cerca auto: controllo non riuscito', 'error']);
check('8 storico avvisi invariato', sentKeys(), sentBeforeError);
st.catalogStatus = 200;

// 9) il primo controllo di una fonte crea lo storico ma conferma comunque il controllo.
st.catalog.push(mk('Nuova fonte', 'INITIAL', 9000)); r = await scan();
check('9 nuovo stock non trattato come novità', [r.pushes.length, r.pushes.every((p) => p.count === 0), sentKeys().includes('Nuova fonte|INITIAL')], [2, true, false]);

// Publish the same car on two portals, rotate the primary and retain only the partner offer.
const partner = 'Subito · stock rivenditori';
const original = mk('brumbrum', 'cross-portal', 10500);
const secondary = mk(partner, 'partner-id', 9000, 2021, { note: 'Finanziamento segnalato: verificare' });
const grouped = (a: ReturnType<typeof mk>, b: ReturnType<typeof mk>) => ({ ...a, offers: [a, b] });
st.catalog = [original, mk(partner, 'initial-stock', 8500)]; r = await scan();
check('stock partner iniziale senza avviso', r.pushes.every(p => p.count === 0), true);
st.catalog = [grouped(original, secondary)]; r = await scan();
check('nuova auto con seconda offerta nel budget, un solo avviso per dispositivo', r.pushes.map(p => p.count), [1,1]);
check('prezzo e link usati dalla stessa offerta', [r.pushes[0]?.cars[0]?.url,r.pushes[0]?.cars[0]?.label.includes('9.000 € · condizioni di prezzo da verificare'),r.run.price_drops], [secondary.url,true,0]);
st.catalog = [grouped(secondary, original)]; r = await scan();
check('cambio principale senza nuovo avviso', [r.run.new_cars,r.pushes.map(p => p.count)], [0,[0,0]]);
st.catalog = [secondary]; r = await scan();
check('seconda offerta rimasta da sola senza nuovo avviso', [r.run.new_cars,r.pushes.map(p => p.count)], [0,[0,0]]);

// Stock già noto sopra soglia: il passaggio a un altro prezzo non è un ribasso della stessa offerta.
const old = mk('brumbrum','known-multi',12500);
baseline(old);
const alt = mk(partner,'other-known-multi',10500);
st.catalog = [grouped(old,alt)]; await scan();
const cheaper = { ...alt, price: 9800 };
st.catalog = [grouped(old,cheaper)]; r = await scan();
check('ribasso confrontato nella stessa offerta', [r.run.new_cars,r.run.price_drops,r.pushes[0]?.cars[0]?.url,r.pushes[0]?.body.includes('era 10.500 €')], [0,1,alt.url,true]);

// 10) l'ora della conferma segue Europe/Rome in inverno e in estate.
for (const [checkedAt, expected] of [['2026-11-17T09:00:00Z', '10:00'], ['2026-07-17T08:00:00Z', '10:00']]) {
  const message = notification([], 'time', { checkedAt, carsRead: 986, sources: 17, completeSources: 17 });
  check('10 ora italiana ' + checkedAt, message.body.startsWith('Controllo delle ' + expected + ':'), true);
  check('10 conteggio fonti', message.body.includes('986 annunci letti · 17/17 siti controllati.'), true);
}

// titoli
const car = mk('brumbrum', 'X', 8950);
check('auto non disponibile esclusa dagli avvisi', matchesWatch({ ...car, unavailable: true }), false);
check('titolo 1 nuova', notification([{ car }], 't').title, 'Una nuova auto su Cerca auto');
check('titolo 2 nuove', notification([{ car }, { car }], 't').title, '2 nuove auto su Cerca auto');
check('titolo 2 ribassi', notification([{ car, from: 10500 }, { car, from: 11000 }], 't').title, '2 auto sono scese sotto i 10.000 €');
check('auto mai vista con prezzo ignoto non è un ribasso', observeCars([car], [{ car_key: 'brumbrum|X', first_seen: pg(T), eligible: false, price: null }], [], pg(T))[0].entered_at, null);
check('segnalazione finanziamento esplicita nella notifica', notification([{car:{...car,note:'Finanziamento segnalato dall’utente: prezzo senza finanziamento da verificare'}}], 't').body.includes('condizioni di prezzo da verificare'), true);
check('finanziamento noto resta distinto dalla segnalazione', notification([{car:{...car,cash:10950}}], 't').body.includes('con finanziamento'), true);
console.log(failed ? '\n' + failed + ' PROVE FALLITE' : '\nTUTTE LE PROVE SUPERATE');
Deno.exit(failed ? 1 : 0);
