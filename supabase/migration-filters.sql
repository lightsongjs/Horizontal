-- Sertarul și filtrele: fixările (pătratele de sus din sertar) și filtrele
-- salvate. Amândouă PERSONALE: ale contului, nu ale proiectului, deci RLS e
-- doar `user_id = auth.uid()` — niciun membru, niciun admin nu le vede pe ale
-- altuia. Sincronizate în cont (decizia omului): fixezi pe telefon, vezi
-- fixat pe laptop.
-- Rulează: npm run migrate supabase/migration-filters.sql
-- Safe to re-run.

-- ── 1. pinned_items ─────────────────────────────────────────────────────────
-- `ref` e text liber, fără cheie externă: ținta e un proiect (`projects.id`),
-- un filtru (`saved_filters.id`) sau o listă a aplicației ('week', 'inbox').
-- O țintă dispărută lasă un rând orfan pe care clientul nu-l arată
-- (`livePins`); ștergerea unui filtru își ia fixarea cu ea (trigger, mai jos).
create table if not exists public.pinned_items (
  -- `default auth.uid()`: clientul nu trimite `user_id`, ca la `issue_seen`.
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('filter','project','list')),
  ref        text not null,
  -- Ordinea = ordinea fixării. Reordonarea prin tragere poate veni mai târziu.
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.pinned_items enable row level security;
drop policy if exists pinned_own on public.pinned_items;
create policy pinned_own on public.pinned_items for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.pinned_items to authenticated;

-- ── 2. saved_filters ────────────────────────────────────────────────────────
-- Un filtru salvat: rânduri de condiții în `rules` (jsonb — forma și citirea
-- defensivă sunt în `src/lib/savedFilters.ts`, `normalizeRules`). Numai
-- tichete DESCHISE; regula se aplică în client, peste `listOpenIssues`.
create table if not exists public.saved_filters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  icon       text not null default 'filter',
  rules      jsonb not null default '{}'::jsonb,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists saved_filters_user_idx on public.saved_filters (user_id, position);

alter table public.saved_filters enable row level security;
drop policy if exists filters_own on public.saved_filters;
create policy filters_own on public.saved_filters for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.saved_filters to authenticated;

-- Un filtru șters își ia fixarea cu el, în aceeași tranzacție — altfel ar
-- rămâne un pătrat orfan pe care fiecare client ar trebui să-l ascundă.
create or replace function public.saved_filters_unpin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pinned_items where user_id = old.user_id and kind = 'filter' and ref = old.id::text;
  return old;
end $$;
drop trigger if exists saved_filters_unpin on public.saved_filters;
create trigger saved_filters_unpin after delete on public.saved_filters
for each row execute function public.saved_filters_unpin();
