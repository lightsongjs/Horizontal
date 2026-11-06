-- Valuri arhivate (H-17, 2026-11-06). Rulează o dată, ÎNAINTE de push:
--   npm run migrate supabase/migration-wave-archive.sql
-- Re-rulabilă: `if not exists`.
--
-- Un val cu tichete GATA nu se șterge (tichetele țin valul prin număr, fără
-- cheie străină: ar rămâne orfane). Se arhivează: dispare din taburi și din
-- alegeri, tichetele rămân în bază (căutare, `tk get`), iar foaia „Valuri" îl
-- arată sub „Arhivate", de unde se deschide sau se scoate din arhivă.
-- null = activ. Scrisă de `DELETE /api/waves/<n>` / `PATCH { archived }`
-- (`functions/api/waves/[number].ts`) și de foaia „Valuri" (aplicația).
--
-- Fără coloana asta: aplicația și API-ul merg ca înainte (toate valurile
-- active), iar arhivarea răspunde 409 `migration_missing` fără să scrie nimic.
-- Politicile RLS pe `waves` (`migration-access.sql`) acoperă deja UPDATE.

alter table public.waves add column if not exists archived_at timestamptz;

notify pgrst, 'reload schema';
