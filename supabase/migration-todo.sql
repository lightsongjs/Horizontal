-- Mod To-Do: scadență pe tichete. Rulează o dată: npm run migrate supabase/migration-todo.sql
-- Single-line, fără ghilimele (editoarele de telefon strică apostrofii). Safe to re-run.
--
-- due_at e timestamptz, iar all_day spune dacă ora din el înseamnă ceva. O
-- sarcina de zi întreagă stochează 00:00 LOCAL ca convenție și nu-și arată
-- niciodată ora; fără flag, ar sări de zi la schimbarea fusului.
alter table issues add column if not exists due_at timestamptz;
alter table issues add column if not exists all_day boolean not null default true;
alter table issues add column if not exists remind_at timestamptz;
alter table issues add column if not exists rrule text;

-- Indexul parțial e cel care face listele Azi/Mâine/7 zile ieftine: tichetele
-- de proiect fără scadență (majoritatea) nu intră în el.
create index if not exists issues_due_idx on issues (due_at) where due_at is not null;

-- Mementourile netrimise, în ordinea în care trebuie trimise. Jobul de cron
-- citește exact acest index.
create index if not exists issues_remind_idx on issues (remind_at) where remind_at is not null and done = false;
