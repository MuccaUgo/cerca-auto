-- pg_cron is in UTC. The small hourly SQL gate selects the requested Italian
-- hours, preserving 10:00 / 14:00 / 18:00 through daylight-saving changes.
-- Only three catalog scans are requested per day.
select cron.schedule(
  'cerca-auto-10-14-18-rome',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://udhrplrxqxgiafwxtbqe.supabase.co/functions/v1/cerca-auto-watch?action=scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cerca_auto_anon'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cerca_auto_anon'),
      'X-Watch-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cerca_auto_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )
  where extract(hour from now() at time zone 'Europe/Rome') in (10, 14, 18);
  $$
);
