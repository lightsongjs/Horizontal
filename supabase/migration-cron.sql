-- Planificatorul mementourilor: pg_cron cheamă funcția edge la fiecare minut.
-- Rulează o dată, DUPĂ ce ai deployat funcția: npm run migrate supabase/migration-cron.sql
--
-- De ce aici și nu un Cron Trigger de Cloudflare: Cloudflare PAGES Functions nu
-- au cron (doar Workers au), iar un Worker separat ar fi cerut wrangler.toml, un
-- al doilea depozit de secrete și un al doilea model de autentificare. Supabase
-- e deja singurul backend cu sesiune și RLS, și are deja o funcție edge.
--
-- ÎNAINTE de a rula, pune cele două valori în Vault (o dată):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- Secretele NU stau în acest fișier: ar ajunge în git.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: reluarea migrării nu produce două programări care ar trimite dublu.
select cron.unschedule('send-reminders') where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule('send-reminders', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

-- Verificare:  select jobname, schedule, active from cron.job;
--
-- Istoric: `cron.job_run_details` NU are coloana `jobname` (pg_cron 1.4+), deci
-- filtrarea cere un join pe `jobid`:
--   select d.status, d.return_message, d.start_time
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname = 'send-reminders' order by d.start_time desc limit 10;
--
-- Dar `status = 'succeeded'` aici înseamnă doar că `net.http_post` a fost PUS ÎN
-- COADĂ — pg_net e asincron, cererea pleacă după commit. Răspunsul real al
-- funcției edge e altundeva, și numai el spune dacă s-a trimis ceva:
--   select status_code, content, created from net._http_response
--   order by created desc limit 5;   -- se păstrează ~6h (pg_net.ttl)
