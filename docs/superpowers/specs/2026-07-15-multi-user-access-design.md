# Multi-user access pe proiecte — design

**Proiect:** Horizontal
**Data:** 2026-07-15
**Status:** aprobat pentru planificare

## Problemă

Astăzi Horizontal e single-user: userul se creează manual în dashboard-ul
Supabase, iar RLS folosește peste tot politici `to authenticated using (true)`,
deci orice cont logat vede și editează **toate** proiectele. Nu există nicio
legătură user↔proiect și niciun concept de rol.

Vrem ca adminul (owner-ul aplicației) să poată, **din interfață**, să creeze
useri (email + parolă) și să le aleagă la ce proiecte au acces și cu ce nivel.
Fiecare user, la login, vede **doar** proiectele primite.

## Decizii cheie (din brainstorming)

- **Două niveluri de acces per proiect:** `read` (doar vizualizare) și `write`
  (editează tot conținutul proiectului). Owner-ul rămâne admin global peste tot.
- **Un singur admin global (tu).** Doar adminul creează proiecte, useri și
  alocă/revocă accesul. Userii obișnuiți doar consumă/editează proiectele primite.
- **Crearea userilor trece printr-o Supabase Edge Function**, pentru că
  `auth.admin.createUser` cere cheia `service_role`, care nu are voie în browser.
- **Securitatea stă în RLS, nu în UI.** UI-ul ascunde/dezactivează controale ca
  UX, dar baza de date e cea care aplică regulile efectiv.

## 1. Model de date

Tabelă nouă de legătură (many-to-many user↔proiect cu rol):

```sql
create table if not exists project_members (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id)    on delete cascade,
  role       text not null check (role in ('read', 'write')),
  primary key (user_id, project_id)
);
create index if not exists project_members_user_idx on project_members(user_id);
```

**Adminul** e marcat prin `app_metadata.role = 'admin'` pe contul din Supabase
(nu într-o tabelă) — `app_metadata` nu poate fi modificat din client, doar cu
cheia `service_role`, deci nu poate fi escaladat de un user obișnuit.

## 2. RLS — izolarea datelor

Se înlocuiesc TOATE politicile `using(true)` din `schema.sql`. Funcție helper
care citește rolul din JWT:

```sql
create or replace function is_admin() returns boolean as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$ language sql stable;
```

Reguli per tabelă:

- **projects**
  - `SELECT`: `is_admin() or exists (select 1 from project_members m where m.project_id = projects.id and m.user_id = auth.uid())`
  - `INSERT / UPDATE / DELETE`: `is_admin()` (doar adminul creează/șterge proiecte)
- **waves / themes / issues / dependencies** (au `project_id`, direct sau via issue)
  - `SELECT`: admin sau membership pe `project_id`
  - `INSERT / UPDATE / DELETE`: admin sau membership cu `role = 'write'`
  - Pentru `dependencies` (nu are `project_id` direct) verificarea se face prin
    join la `issues` ca să obții `project_id`.
- **project_members**
  - `SELECT`: adminul vede tot; un user își vede doar propriile linii.
  - `INSERT / UPDATE / DELETE`: doar `is_admin()`.

Efect: chiar dacă cineva fură cheia `anon` și scrie query-uri directe, baza îl
oprește. Politicile de scriere se scriu cu `with check` pe aceeași condiție ca
`using`.

## 3. Edge Function — `admin-users`

Un singur endpoint Supabase (Deno), cu `SUPABASE_SERVICE_ROLE_KEY` din
environment-ul funcției (niciodată în client). Deploy din CLI:
`supabase functions deploy admin-users`.

Fiecare request:

1. **Guard:** citește JWT-ul apelantului din header-ul `Authorization`,
   validează-l cu clientul service_role, verifică
   `app_metadata.role === 'admin'`. Altfel → `403`.
2. **Rutare pe `action`:**
   - `create_user` — `admin.createUser({ email, password, email_confirm: true })`;
     apoi inserează liniile în `project_members` cu rolurile alese.
   - `set_access` — rescrie membership-ul unui user: primește lista dorită de
     `{ project_id, role }`, face upsert + șterge ce nu mai e în listă.
   - `reset_password` — `admin.updateUserById(id, { password })`.
   - `delete_user` — `admin.deleteUser(id)` (cascade curăță `project_members`).
   - `list_users` — `admin.listUsers()` + join la `project_members`, returnează
     userii cu email + accesul curent (pentru ecranul de admin).

Payload și răspunsuri: JSON simplu. Erorile Supabase se întorc ca
`{ error: message }` cu status potrivit.

UI-ul apelează cu `supabase.functions.invoke('admin-users', { body })` —
token-ul de sesiune se atașează automat de client.

## 4. UI

### `useAuth` extins
Contextul de auth expune în plus:
- `isAdmin: boolean` — din `session.user.app_metadata.role`.
- `access: Record<projectId, 'read' | 'write'>` — încărcat o dată din
  `project_members` după login (pentru useri non-admin). Adminul nu are nevoie
  de map — vede tot.

### Filtrarea proiectelor
Lista de proiecte **nu are nevoie de cod nou de filtrare** — RLS returnează deja
doar proiectele vizibile. Store-ul citește ca acum; setul de rezultate e restrâns
automat de politici.

### Gating pe read-only
În proiectele cu `role === 'read'` (și non-admin), butoanele de editare
(adaugă/editează issue, marchează done, editează waves/teme) sunt ascunse sau
dezactivate. E strat de UX peste RLS, nu înlocuitor.

### Ecran nou „Utilizatori"
Vizibil doar dacă `isAdmin`. Intrare din meniu/setări.
- Listă useri: email + proiectele lor cu rolul (read/write).
- **Adaugă user:** formular email + parolă + checklist de proiecte, fiecare cu
  toggle read/write. Trimite `create_user`.
- Pe fiecare user: **Editează acces** (checklist proiecte + roluri → `set_access`),
  **Reset parolă** (`reset_password`), **Șterge** (`delete_user`).

## 5. Testare

- **RLS engine test** (script Node, `pg` sau supabase-js cu 3 conturi):
  admin, writer, reader.
  - reader: vede proiectul alocat, NU poate scrie, NU vede proiecte nealocate.
  - writer: vede + scrie pe proiectul alocat, blocat pe altele.
  - admin: vede/scrie tot, poate crea proiecte.
- **Edge Function:** un apel de la un non-admin primește `403`; un apel valid de
  admin creează userul și membership-ul așteptat.

## Ce NU intră (YAGNI)

- Self sign-up, email de confirmare/invitație, reset de parolă declanșat de user.
- Roluri per-proiect de tip admin (invitarea altora) — un singur admin global.
- Audit log, expirare acces, echipe/grupuri.

## Ordine de build sugerată

1. Migrare SQL: `project_members` + rescrierea politicilor RLS + `is_admin()`.
2. Marchează contul tău ca admin (`app_metadata.role='admin'`) via script.
3. RLS engine test (validează izolarea înainte de UI).
4. Edge Function `admin-users` + guard + `create_user`/`list_users`.
5. `useAuth` extins (`isAdmin`, `access`).
6. Ecran „Utilizatori" (listă + adaugă).
7. Restul acțiunilor (set_access, reset_password, delete_user) + gating read-only în UI.
