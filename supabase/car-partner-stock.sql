-- Catalogo fornito dai rivenditori e gestito lato server. Nessun accesso pubblico.
create table if not exists public.car_partner_stock (
  subito_id text primary key check (subito_id ~ '^[0-9]{5,14}$'),
  listing jsonb not null check (jsonb_typeof(listing) = 'object'),
  provenance text not null check (length(trim(provenance)) > 0),
  valid_until timestamptz not null
);
alter table public.car_partner_stock enable row level security;
revoke all on table public.car_partner_stock from public, anon, authenticated;
grant select, insert, update, delete on table public.car_partner_stock to service_role;
create index if not exists car_partner_stock_expiry_idx on public.car_partner_stock (valid_until);
