-- Rutine: un proiect "doar mementouri" - tichetele lui apar in liste si pe
-- widget doar dupa ce suna (src/lib/routines.ts, core/Agenda.kt).
-- Ruleaza o data: npm run migrate supabase/migration-routines.sql
-- Safe to re-run. Politicile RLS existente pe `projects` acopera coloana.

alter table projects add column if not exists reminders_only boolean not null default false;
