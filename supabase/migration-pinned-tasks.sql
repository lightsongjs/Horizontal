-- Sarcini fixate ("Fixeaza sus", ca Pin din TickTick): un tichet fixat,
-- deschis si al meu sta primul in "Azi", cu sau fara scadenta.
-- Spec: docs/superpowers/specs/2026-10-17-sarcini-fixate-design.md
-- Reguli: src/lib/pinned.ts, buildSmartLists (src/lib/schedule.ts).
--
-- Ruleaza o data, INAINTE de push: npm run migrate supabase/migration-pinned-tasks.sql
-- (fara coloana, un "Fixeaza sus" trimite `pinned_at` si PostgREST il refuza;
-- citirile merg oricum - `select('*')` doar nu-l aduce).
-- Safe to re-run.
--
-- Nullable, fara default: null = nefixat; valoarea = cand a fost fixat (ordinea
-- intre fixate: cel mai recent primul). O coloana pe `issues`, deci politicile
-- RLS existente o acopera; nu exista granturi pe coloane pentru `issues`.
-- `move_issue` copiaza randul prin `jsonb_populate_record`, deci un tichet mutat
-- isi pastreaza fixarea fara nicio schimbare acolo.
-- Fara index: fixatele se aleg din tichetele deschise deja aduse de client
-- (`listOpenIssues`), nu printr-o interogare proprie.

alter table issues add column if not exists pinned_at timestamptz;
