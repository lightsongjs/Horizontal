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
