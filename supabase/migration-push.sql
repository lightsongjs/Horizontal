-- Web push: abonamente + urma mementourilor trimise.
-- Rulează o dată: npm run migrate supabase/migration-push.sql
-- Fișierul folosește ghilimele simple acolo unde logica depinde de ele (ca
-- migration-access.sql), nu convenția fără ghilimele din schema.sql.

-- Un rând per DISPOZITIV. `endpoint` e cheia naturală: același browser reabonat
-- întoarce același endpoint, iar un al doilea rând ar trimite notificări duble.
create table if not exists push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null unique, p256dh text not null, auth text not null, ua text, created_at timestamptz not null default now(), last_error text, last_error_at timestamptz);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
alter table push_subscriptions enable row level security;

-- Fiecare își vede și își gestionează DOAR abonamentele proprii. Nici adminul nu
-- are ce căuta aici: un abonament e o adresă de livrare către un dispozitiv
-- personal, nu un obiect de administrat. Jobul de trimitere rulează cu service
-- role, care ocolește RLS oricum.
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Urma trimiterii. O coloană, nu o coadă separată: un tichet are exact un
-- memento. Recurența (care ar produce mai multe apariții pe același tichet) e
-- amânată — când ajunge, ea aduce coada.
alter table issues add column if not exists reminder_sent_at timestamptz;

-- Indexul pe care se sprijină jobul de cron: mementourile netrimise, în ordine.
-- Îl înlocuiește pe cel din migration-todo, care nu știa de reminder_sent_at.
drop index if exists issues_remind_idx;
create index if not exists issues_remind_pending_idx on issues (remind_at) where remind_at is not null and reminder_sent_at is null and done = false;

-- Schimbarea orei mementoului ANULEAZĂ trimiterea anterioară: altfel un
-- „Amână 10 min" ar fi marcat deja trimis și n-ar mai suna niciodată.
-- În trigger, nu în codul aplicației: `remind_at` se schimbă din formular, din
-- quick add, din butonul notificării și din API — un singur loc care garantează
-- regula bate patru care și-o amintesc.
create or replace function reset_reminder_sent() returns trigger language plpgsql as $$
begin
  if new.remind_at is distinct from old.remind_at then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists issues_reset_reminder_sent on issues;
create trigger issues_reset_reminder_sent before update on issues for each row execute function reset_reminder_sent();
