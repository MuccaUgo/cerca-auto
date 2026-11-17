import webpush from 'npm:web-push@3.6.7';
import { matchesWatch, notification, observeCars, safePushEndpoint, type WatchCar } from './helpers.ts';

const PROJECT = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const ORIGIN = 'https://muccaugo.github.io';
const SUBJECT = ORIGIN + '/cerca-auto/';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-watch-token,x-watch-secret',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Vary': 'Origin',
};
type Secrets = { vapid: { publicKey: string; privateKey: string }; cron: string };
type Subscription = { id: string; subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; token_hash: string; enabled: boolean; created_at: string; last_test_at?: string };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
let secretCache: Secrets | null = null;

async function db(path: string, method = 'GET', body?: unknown, prefer = ''): Promise<any> {
  const res = await fetch(PROJECT + '/rest/v1/' + path, {
    method, headers: { Authorization: 'Bearer ' + SERVICE, apikey: SERVICE, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Database request failed: ' + res.status);
  const text = await res.text(); return text ? JSON.parse(text) : null;
}
async function all(path: string): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await db(path + (path.includes('?') ? '&' : '?') + 'limit=500&offset=' + offset);
    rows.push(...page); if (page.length < 500) return rows;
  }
}
async function secrets(): Promise<Secrets> {
  if (!secretCache) {
    const values = await db('rpc/car_watch_get_secrets', 'POST', {});
    if (!values.cerca_auto_vapid || !values.cerca_auto_cron_secret) throw new Error('Push configuration missing');
    secretCache = { vapid: JSON.parse(values.cerca_auto_vapid), cron: values.cerca_auto_cron_secret };
    // Exercise signing and encryption in the deployed runtime without sending a push.
    const probe = webpush.generateRequestDetails({
      endpoint: 'https://web.push.apple.com/self-test',
      keys: { p256dh: secretCache.vapid.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
    }, '{"title":"self-test"}', { vapidDetails: { subject: SUBJECT, ...secretCache.vapid }, TTL: 60, contentEncoding: 'aes128gcm' });
    if (!probe.body?.length || !Object.keys(probe.headers).some((key) => key.toLowerCase() === 'authorization')) throw new Error('Push encryption self-test failed');
  }
  return secretCache;
}
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
async function device(req: Request): Promise<Subscription | null> {
  const token = req.headers.get('x-watch-token'); if (!token || token.length > 200) return null;
  const rows = await db('car_watch_subscriptions?select=id,subscription,token_hash,enabled,created_at,last_test_at&token_hash=eq.' + await hash(token) + '&limit=1');
  return rows[0] ?? null;
}
async function send(sub: Subscription, payload: unknown): Promise<boolean> {
  if (!safePushEndpoint(sub.subscription.endpoint)) throw new Error('Invalid push provider');
  const conf = await secrets();
  const details = webpush.generateRequestDetails(sub.subscription, JSON.stringify(payload), {
    vapidDetails: { subject: SUBJECT, ...conf.vapid }, TTL: 21600, urgency: 'normal', contentEncoding: 'aes128gcm',
  });
  const res = await fetch(details.endpoint, {
    method: details.method, headers: details.headers, body: new Uint8Array(details.body),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  await res.arrayBuffer();
  if (res.status === 404 || res.status === 410) {
    await db('car_watch_subscriptions?id=eq.' + sub.id, 'PATCH', { enabled: false, updated_at: new Date().toISOString() });
    return false;
  }
  if (!res.ok) throw new Error('Push provider returned ' + res.status);
  return true;
}
async function scan() {
  if (!(await db('rpc/car_watch_claim', 'POST', {}))) return { busy: true };
  const runId = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await db('car_watch_runs', 'POST', { id: runId, started_at: now });
    const res = await fetch(PROJECT + '/functions/v1/cerca-auto?forceFunctionRegion=eu-central-1', {
      headers: { Authorization: 'Bearer ' + ANON, apikey: ANON }, signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error('Catalog request failed: ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.cars) || !data.cars.length || !Array.isArray(data.sources)) throw new Error('No usable catalog');
    const [previous, initialized] = await Promise.all([
      all('car_watch_inventory?select=car_key,first_seen,eligible'), all('car_watch_sources?select=name'),
    ]);
    const known = new Map(previous.map((row) => [row.car_key, row]));
    const cars: WatchCar[] = data.cars.filter((car: WatchCar) => car && car.src && car.id !== undefined && car.id !== null && Number.isFinite(car.price) && car.price > 0);
    const rows = observeCars(cars, previous, initialized.map((row) => row.name), now);
    for (let i = 0; i < rows.length; i += 200) await db('car_watch_inventory?on_conflict=car_key', 'POST', rows.slice(i, i + 200), 'resolution=merge-duplicates');
    const complete = data.sources.filter((source: any) => source.ok && source.got >= source.expected).map((source: any) => ({ name: source.name }));
    if (complete.length) await db('car_watch_sources?on_conflict=name', 'POST', complete, 'resolution=ignore-duplicates');
    const subscriptions: Subscription[] = await all('car_watch_subscriptions?select=id,subscription,token_hash,enabled,created_at&enabled=eq.true');
    let pushes = 0, failed = 0;
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    for (const sub of subscriptions) {
      const sent = new Set((await all('car_watch_sent?select=car_key&subscription_id=eq.' + sub.id)).map((row) => row.car_key));
      const fresh = rows.filter((row) => row.eligible && row.first_seen > sub.created_at && row.first_seen >= cutoff && !sent.has(row.car_key) && matchesWatch(row.car));
      if (!fresh.length) continue;
      fresh.sort((a, b) => a.car.price - b.car.price);
      try {
        if (await send(sub, notification(fresh.map((row) => row.car), runId))) {
          for (let i = 0; i < fresh.length; i += 200) await db('car_watch_sent?on_conflict=subscription_id,car_key', 'POST', fresh.slice(i, i + 200).map((row) => ({ subscription_id: sub.id, car_key: row.car_key })), 'resolution=ignore-duplicates');
          pushes++;
        }
      } catch (_error) { failed++; }
    }
    const count = rows.filter((row) => !known.has(row.car_key) && row.eligible).length;
    const partial = data.sources.some((source: any) => !source.ok || source.got < source.expected);
    await db('car_watch_runs?id=eq.' + runId, 'PATCH', { finished_at: new Date().toISOString(), status: partial || failed ? 'partial' : 'ok', sources: data.sources, cars_read: rows.length, new_cars: count, pushes_sent: pushes, error: failed ? failed + ' push deliveries failed' : null });
    return { runId, cars: rows.length, newCars: count, pushes, partial, failed };
  } catch (error) {
    await db('car_watch_runs?id=eq.' + runId, 'PATCH', { finished_at: new Date().toISOString(), status: 'error', error: (error as Error).message }).catch(() => {});
    throw error;
  } finally { await db('rpc/car_watch_release', 'POST', {}).catch(() => {}); }
}
function keyBytes(value: unknown, length: number): boolean {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_=-]+$/.test(value)) return false;
  try { return atob(value.replace(/-/g, '+').replace(/_/g, '/')).length === length; } catch { return false; }
}

Deno.serve(async (req: Request) => {
  const headers = { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const origin = req.headers.get('origin');
  if (origin && origin !== ORIGIN) return json({ error: 'Origine non consentita.' }, 403);
  try {
    const action = new URL(req.url).searchParams.get('action') || 'config';
    if (action === 'scan' && req.method === 'POST') {
      const conf = await secrets();
      if (!equal(req.headers.get('x-watch-secret') || '', conf.cron)) throw new ApiError(401, 'Non autorizzato.');
      return json(await scan());
    }
    if (action === 'config' && req.method === 'GET') {
      const [conf, sub, runs] = await Promise.all([secrets(), device(req), db('car_watch_runs?select=finished_at,status,cars_read,new_cars&finished_at=not.is.null&order=started_at.desc&limit=1')]);
      return json({ publicKey: conf.vapid.publicKey, timezone: 'Europe/Rome', hours: [10, 14, 18], maxPrice: 10000, minYear: 2020, device: sub ? { enabled: sub.enabled } : null, lastRun: runs[0] ?? null });
    }
    if (req.method !== 'POST') throw new ApiError(405, 'Metodo non consentito.');
    const raw = await req.text(); if (raw.length > 10000) throw new ApiError(413, 'Richiesta troppo grande.');
    const body = raw ? JSON.parse(raw) : {};
    if (action === 'subscribe') {
      const s = body.subscription;
      if (!s || typeof s.endpoint !== 'string' || !safePushEndpoint(s.endpoint) || !keyBytes(s.keys?.p256dh, 65) || !keyBytes(s.keys?.auth, 16)) throw new ApiError(400, 'Abbonamento alle notifiche non valido.');
      const existing = await db('car_watch_subscriptions?select=id,subscription&endpoint=eq.' + encodeURIComponent(s.endpoint) + '&limit=1');
      if (existing[0] && (!equal(existing[0].subscription.keys.auth, s.keys.auth) || !equal(existing[0].subscription.keys.p256dh, s.keys.p256dh))) throw new ApiError(409, 'Riattiva le notifiche da questo dispositivo.');
      const token = crypto.randomUUID() + crypto.randomUUID();
      const now = new Date().toISOString();
      const rows = await db('car_watch_subscriptions?on_conflict=endpoint', 'POST', { endpoint: s.endpoint, subscription: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, token_hash: await hash(token), enabled: true, created_at: now, updated_at: now }, 'resolution=merge-duplicates,return=representation');
      return json({ id: rows[0].id, token });
    }
    const sub = await device(req);
    if (!sub || !sub.enabled) throw new ApiError(401, 'Riattiva le notifiche su questo dispositivo.');
    if (action === 'unsubscribe') {
      await db('car_watch_subscriptions?id=eq.' + sub.id, 'PATCH', { enabled: false, updated_at: new Date().toISOString() });
      return json({ disabled: true });
    }
    if (action === 'test') {
      if (sub.last_test_at && Date.now() - Date.parse(sub.last_test_at) < 15000) throw new ApiError(429, 'Attendi qualche secondo prima di inviare un’altra prova.');
      const accepted = await send(sub, { title: 'Cerca auto: notifiche attive', body: 'La prova funziona. I controlli saranno alle 10:00, 14:00 e 18:00, ora italiana.', tag: 'cerca-auto-test', cars: [], count: 0 });
      if (!accepted) throw new ApiError(410, 'Riattiva le notifiche su questo dispositivo.');
      await db('car_watch_subscriptions?id=eq.' + sub.id, 'PATCH', { last_test_at: new Date().toISOString() });
      return json({ accepted: true });
    }
    throw new ApiError(404, 'Operazione non trovata.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error('car-watch:', (error as Error).message);
    return json({ error: 'Servizio avvisi momentaneamente non disponibile. Riprova.' }, 500);
  }
});
