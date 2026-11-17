-- Server-side inventory and Web Push state. Apply before deploying cerca-auto-watch.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.car_watch_inventory (
  car_key text primary key,
  src text not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  eligible boolean not null default false,
  entered_at timestamptz,   -- when a known car dropped below the price limit
  entered_from numeric,     -- its price before that drop
  car jsonb not null
);
create table public.car_watch_sources (
  name text primary key,
  initialized_at timestamptz not null default now()
);
create table public.car_watch_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  subscription jsonb not null,
  token_hash text unique not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz
);
create table public.car_watch_sent (
  subscription_id uuid not null references public.car_watch_subscriptions(id) on delete cascade,
  car_key text not null references public.car_watch_inventory(car_key),
  sent_at timestamptz not null default now(),
  primary key (subscription_id, car_key)
);
create index car_watch_sent_car_key_idx on public.car_watch_sent(car_key);
create table public.car_watch_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','partial','error')),
  sources jsonb not null default '[]',
  cars_read integer not null default 0,
  new_cars integer not null default 0,
  price_drops integer not null default 0,
  pushes_sent integer not null default 0,
  error text
);
create index car_watch_runs_started_idx on public.car_watch_runs(started_at desc);
create table public.car_watch_locks (
  id integer primary key check (id = 1),
  leased_until timestamptz not null default '-infinity'
);
insert into public.car_watch_locks(id) values (1);

alter table public.car_watch_inventory enable row level security;
alter table public.car_watch_sources enable row level security;
alter table public.car_watch_subscriptions enable row level security;
alter table public.car_watch_sent enable row level security;
alter table public.car_watch_runs enable row level security;
alter table public.car_watch_locks enable row level security;
revoke all on public.car_watch_inventory, public.car_watch_sources, public.car_watch_subscriptions,
  public.car_watch_sent, public.car_watch_runs, public.car_watch_locks from anon, authenticated;
grant select, insert, update, delete on public.car_watch_inventory, public.car_watch_sources,
  public.car_watch_subscriptions, public.car_watch_sent, public.car_watch_runs, public.car_watch_locks to service_role;

create function public.car_watch_get_secrets() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name in ('cerca_auto_vapid', 'cerca_auto_cron_secret');
$$;
create function public.car_watch_claim() returns boolean
language sql security invoker set search_path = '' as $$
  with claimed as (
    update public.car_watch_locks set leased_until = now() + interval '10 minutes'
    where id = 1 and leased_until < now() returning id
  ) select exists(select 1 from claimed);
$$;
create function public.car_watch_release() returns void
language sql security invoker set search_path = '' as $$
  update public.car_watch_locks set leased_until = '-infinity' where id = 1;
$$;
revoke all on function public.car_watch_get_secrets(), public.car_watch_claim(), public.car_watch_release() from public, anon, authenticated;
grant execute on function public.car_watch_get_secrets(), public.car_watch_claim(), public.car_watch_release() to service_role;
