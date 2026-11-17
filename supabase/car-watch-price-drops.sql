-- Upgrade for databases created before price-drop alerts (car-watch.sql already includes these columns).
alter table public.car_watch_inventory
  add column if not exists entered_at timestamptz,
  add column if not exists entered_from numeric;
alter table public.car_watch_runs
  add column if not exists price_drops integer not null default 0;
