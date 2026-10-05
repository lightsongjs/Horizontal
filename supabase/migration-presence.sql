-- „Laptopul e activ": telefonul își amână mementoul cu 30 s cât omul lucrează
-- la laptop, ca un „Gata" dat acolo să nu mai sune și pe telefon.
-- Rulează o dată: npm run migrate supabase/migration-presence.sql
--
-- Un rând per (cont, dispozitiv). `active_at` = ultima bătaie de inimă a cutiei
-- de pe laptop cât ecranul e deblocat și omul a atins tastatura/mausul în
-- ultimele 2 minute; null = blocat sau inactiv. Timpul e al SERVERULUI la
-- scriere și la citire: ceasul telefonului și cel al laptopului nu se compară.
create table if not exists device_presence (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device text not null,
  active_at timestamptz,
  primary key (user_id, device)
);
alter table device_presence enable row level security;
drop policy if exists presence_own on device_presence;
create policy presence_own on device_presence for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function touch_presence(p_device text, p_active boolean) returns void
language sql security invoker set search_path = public as $$
  insert into device_presence (user_id, device, active_at)
  values (auth.uid(), p_device, case when p_active then now() end)
  on conflict (user_id, device) do update set active_at = excluded.active_at;
$$;

-- 75 s = bătaia de 30 s a cutiei, de două ori, plus întârzierea rețelei. Mai
-- mult ar ține telefonul „amânat" după ce omul a plecat de la laptop.
create or replace function desktop_active() returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from device_presence
    where user_id = auth.uid() and device = 'linux' and active_at > now() - interval '75 seconds'
  );
$$;

grant execute on function touch_presence(text, boolean) to authenticated;
grant execute on function desktop_active() to authenticated;
