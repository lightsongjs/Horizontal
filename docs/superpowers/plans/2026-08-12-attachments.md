# Attachments pe tichete — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poze și fișiere atașate pe un tichet: paste sau drag&drop în formularul de tichet, upload imediat în Supabase Storage privat, imaginile micșorate în browser, ștergere cu două atingeri, iar ștergerea unui tichet sau proiect curăță și octeții.

**Architecture:** Browserul vorbește direct cu Supabase (nu există server pe traseu). Un tabel `attachments` ține metadatele, un bucket privat `attachments` ține octeții, iar politicile RLS de pe `storage.objects` folosesc primul segment din cale ca `project_id`. Logica pură (ce se micșorează, ce fișiere se acceptă) stă în module fără DOM, testate cu Vitest; canvas-ul și Supabase sunt la margine.

**Tech Stack:** React 18, TypeScript, Vite, Vitest (environment `node`), `@supabase/supabase-js` v2, Playwright (doar pentru harness-ul de calibrare), Cloudflare Pages.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-12-attachments-design.md`. Orice contradicție între planul ăsta și spec se rezolvă în favoarea specului.
- **Limba:** comentariile din cod și textele de interfață în română, ca în restul proiectului. Mesajele de commit în engleză, conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- **Vitest rulează în `environment: 'node'`** — nu există `vitest.config.*` și nici jsdom în `devDependencies`. Orice cod testat cu Vitest trebuie să fie **fără DOM**. Nu adăuga jsdom.
- **Rulează testele cu** `npm test` (adică `vitest run`). Un singur fișier: `npx vitest run src/lib/shrinkImage.test.ts`.
- **Typecheck:** `npm run typecheck` (`tsc -b --noEmit`). Trebuie să treacă la fiecare commit.
- **Bucket:** nume `attachments`, privat. Cale obiect: `{projectId}/{issueId}/{attachmentId}`, fără extensie.
- **Plafoane:** imagini 20 MB (măsurat înainte de micșorare), non-imagini 10 MB, fără plafon pe numărul de attachment-uri per tichet.
- **Expirare URL semnat:** 8 ore (`SIGNED_TTL_SECONDS = 8 * 60 * 60`). Upload cu `cacheControl: '31536000'`.
- **Ordinea la ștergere:** citește căile → șterge rândurile → șterge octeții best-effort. `removeObjects` nu aruncă niciodată.
- **Nu apela `storage.list()` din client** (politica RLS nu e indexabilă pe scanări de prefix). Căile se citesc din tabelul `attachments`.
- **Nu schimba navigația.** `openIssue` continuă să deschidă `IssueForm`.

---

## Structura fișierelor

**Noi:**

| Fișier | Responsabilitate |
|---|---|
| `supabase/migration-attachments.sql` | Tabel, indecși, RLS pe `attachments` și pe `storage.objects`. Idempotent |
| `scripts/apply-migration.mjs` | Aplică un fișier `.sql` prin clientul `pg` (DDL și RLS nu merg prin REST) |
| `scripts/create-attachments-bucket.mjs` | Creează bucketul privat cu service-role (cheia anon nu poate) |
| `src/lib/shrinkImage.ts` | `shrinkPlan()` pur + `attachmentFilename()` + `shrinkImage()` pe canvas |
| `src/lib/shrinkImage.test.ts` | Teste pentru partea pură |
| `src/lib/pickFiles.ts` | Event-uri → listă de fișiere, plafoane, nume sintetizate. Fără DOM |
| `src/lib/pickFiles.test.ts` | Teste |
| `src/data/attachments.ts` | Supabase: list / upload / delete / URL-uri semnate cu memorare |
| `src/data/attachments.test.ts` | Teste pentru helperii puri și pentru cache |
| `src/components/Attachments.tsx` | Secțiunea de fișiere; deține paste și drop |
| `src/components/Lightbox.tsx` | Imagine pe tot ecranul, cu descărcare |
| `scripts/test-shrink-image.mjs` | Harness de calibrare în browser (portat din mateSimo) |
| `scripts/storage-report.mjs` | Spațiu per proiect, obiecte orfane, curățare opțională |

**Modificate:**

| Fișier | Ce se schimbă |
|---|---|
| `src/data/repository.ts` | `deleteIssues(ids)` în interfață |
| `src/data/supabaseRepository.ts` | `deleteIssue`/`deleteIssues`/`deleteProject` curăță octeții |
| `src/data/localRepository.ts` | `deleteIssues` |
| `src/store.tsx` | `deleteIssues` în context |
| `src/hooks.ts` | Ștergerea în masă folosește `deleteIssues` |
| `src/components/IssueForm.tsx` | Randează `<Attachments>` sub notițe |
| `src/components/IssueSheet.tsx` | Randează `<Attachments readOnly>` |
| `src/App.tsx` | Pereche `dragover`/`drop` inertă la nivel de document |
| `vite.config.ts` | Regulă `NetworkOnly` pe rutele semnate |
| `src/styles.css` | Stiluri pentru miniaturi, rânduri, drop-zone, lightbox |
| `package.json` | Scripturile `migrate`, `storage:bucket`, `test:shrink`, `storage:report` |

**Abatere de la spec, intenționată:** specul spune că listenerul de paste stă „într-un `useEffect` din `IssueForm`". Planul îl pune în `Attachments`, care e montat de `IssueForm` — aceeași durată de viață, dar componenta își deține propria intrare. Intenția specului (nu în `SheetHost`, nu în router) e respectată.

---

## Task 1: Migrare SQL și bucket

**Files:**
- Create: `supabase/migration-attachments.sql`
- Create: `scripts/create-attachments-bucket.mjs`
- Create: `scripts/apply-migration.mjs`
- Modify: `package.json` (scripturile `storage:bucket` și `migrate`)

**Interfaces:**
- Consumes: nimic.
- Produces: tabelul `attachments` cu coloanele `id uuid`, `issue_id text`, `project_id text`, `path text`, `filename text`, `size int`, `content_type text`, `created_at timestamptz`. Bucketul privat `attachments`. Task-urile 5, 6 și 10 depind de ele.

**Ordinea contează:** bucketul se creează ÎNAINTE de migrare. Politicile de pe `storage.objects` se pot crea și fără bucket, dar bucketul nu se poate crea cu cheia anon, iar dacă lipsește la primul upload eroarea e confuză. Deci: `storage:bucket`, apoi `migrate`.

- [ ] **Step 1: Scrie migrarea**

Creează `supabase/migration-attachments.sql`:

```sql
-- Horizontal: attachments pe tichete. Se rulează o singură dată în SQL editor-ul
-- Supabase, DUPĂ migration-access.sql (depinde de is_admin() și project_members).
--
-- Ca și migration-access.sql, fișierul ăsta folosește ghilimele simple: logica
-- depinde genuin de literalii 'write' și 'attachments'.

-- Fișierul e IDEMPOTENT: se rulează cu `npm run migrate` și, în timpul
-- dezvoltării, de mai multe ori. Fiecare pas verifică înainte să creeze.

-- Țintă pentru cheia externă compusă de mai jos. `id` e deja primary key, deci
-- unicitatea e gratuită; constrângerea există doar ca Postgres să accepte
-- referința pe perechea (id, project_id).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'issues_id_project_key') then
    alter table issues add constraint issues_id_project_key unique (id, project_id);
  end if;
end $$;

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null,
  project_id text not null,
  path text not null unique,
  filename text not null,
  size int not null,
  content_type text not null,
  created_at timestamptz not null default now(),
  foreign key (issue_id, project_id) references issues (id, project_id) on delete cascade
);

create index if not exists attachments_issue_idx on attachments (issue_id);
create index if not exists attachments_project_idx on attachments (project_id);

alter table attachments enable row level security;

-- `drop ... if exists` înaintea fiecărei politici, ca fișierul să fie
-- re-rulabil. Același tipar ca în migration-access.sql.
drop policy if exists attachments_select on attachments;
drop policy if exists attachments_write on attachments;
drop policy if exists attachments_objects_select on storage.objects;
drop policy if exists attachments_objects_insert on storage.objects;
drop policy if exists attachments_objects_delete on storage.objects;

-- Aceeași formă ca issues_select / issues_write, dar pe project_id direct.
create policy attachments_select on attachments for select to authenticated
using (is_admin() or exists (select 1 from project_members m where m.project_id = attachments.project_id and m.user_id = auth.uid()));

create policy attachments_write on attachments for all to authenticated
using (is_admin() or exists (select 1 from project_members m where m.project_id = attachments.project_id and m.user_id = auth.uid() and m.role = 'write'))
with check (is_admin() or exists (select 1 from project_members m where m.project_id = attachments.project_id and m.user_id = auth.uid() and m.role = 'write'));

-- ── Politici pe storage.objects ─────────────────────────────────────────────
-- Bucketul TREBUIE să existe deja (npm run storage:bucket).
--
-- Trei lucruri obligatorii aici, fiecare a mușcat pe cineva înainte:
--   1. `public.` pe is_admin() și project_members. search_path al conexiunii
--      storage-api nu garantează `public`, iar is_admin() e declarat cu
--      `set search_path = ''`. Fără calificare: "function is_admin() does not
--      exist", exact la upload.
--   2. `bucket_id = 'attachments'` în fiecare politică, altfel ai scris o
--      politică pentru toate bucketurile din proiect.
--   3. (storage.foldername(name))[1] e primul segment din cale = project_id.
--      Nu e indexabil, deci storage.list() nu se apelează din client.
--
-- Fără politică de update: attachmentId e uuid nou la fiecare upload, upsert nu
-- se folosește, deci obiectele sunt imuabile odată scrise.

create policy attachments_objects_select on storage.objects for select to authenticated
using (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
    )
  )
);

create policy attachments_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
        and m.role = 'write'
    )
  )
);

create policy attachments_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = (storage.foldername(name))[1]
        and m.user_id = (select auth.uid())
        and m.role = 'write'
    )
  )
);
```

- [ ] **Step 2: Scrie scriptul care creează bucketul**

Creează `scripts/create-attachments-bucket.mjs`. Urmează exact tiparul din `CLAUDE.md` pentru operații admin (supabase-js din `node_modules` e recunoscut ca mediu server, deci cheia secret e acceptată):

```js
// Creează bucketul privat `attachments`. Cheia anon nu poate insera în
// storage.buckets, deci pasul ăsta cere service-role și nu poate fi făcut din
// aplicație. Idempotent: dacă bucketul există, spune și iese cu 0.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const { data: existing, error: listErr } = await supabase.storage.listBuckets()
if (listErr) {
  console.error('Nu s-au putut citi bucketurile:', listErr.message)
  process.exit(1)
}
if (existing.some((b) => b.name === 'attachments')) {
  console.log('Bucketul `attachments` există deja. Nimic de făcut.')
  process.exit(0)
}

const { error } = await supabase.storage.createBucket('attachments', { public: false })
if (error) {
  console.error('Crearea bucketului a eșuat:', error.message)
  process.exit(1)
}
console.log('Bucketul privat `attachments` a fost creat.')
```

- [ ] **Step 3: Adaugă scriptul în package.json**

În `package.json`, la `scripts`, după `"test:upgrade"`:

```json
    "storage:bucket": "node scripts/create-attachments-bucket.mjs",
```

- [ ] **Step 4: Creează bucketul**

Run: `npm run storage:bucket`
Expected: `Bucketul privat `attachments` a fost creat.` (sau mesajul de „există deja").

Dacă iese cu „Nu s-au putut citi bucketurile", verifică `VITE_SUPABASE_SERVICE_ROLE_KEY` în `.env`.

- [ ] **Step 5: Scrie scriptul care aplică o migrare**

Creează `scripts/apply-migration.mjs`. Folosește clientul `pg` (deja în `dependencies`) cu **parametri separați**, nu `connectionString` — parola conține `@`, care sparge URL-ul de conexiune. Tiparul e documentat în `CLAUDE.md`:

```js
// Aplică un fișier .sql pe baza de date. Rulează: npm run migrate <cale.sql>
//
// De ce `pg` și nu supabase-js: politicile RLS și DDL-ul nu se pot trimite prin
// API-ul REST. De ce parametri separați și nu connectionString: parola conține
// `@`, care sparge URL-ul.
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { config } from 'dotenv'

config()

const file = process.argv[2]
if (!file) {
  console.error('Lipsește fișierul: npm run migrate supabase/migration-attachments.sql')
  process.exit(1)
}

const sql = readFileSync(file, 'utf8')
const client = new pg.Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  // Un singur query cu tot fișierul: `pg` îl trimite ca simple query, deci
  // instrucțiunile rulează într-o singură tranzacție implicită și, la o eroare
  // la mijloc, nu rămâne o migrare pe jumătate aplicată.
  await client.query(sql)
  console.log(`Migrare aplicată: ${file}`)
} catch (e) {
  console.error(`Migrarea a eșuat: ${e.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
```

Adaugă în `package.json`, la `scripts`:

```json
    "migrate": "node scripts/apply-migration.mjs",
```

- [ ] **Step 6: Aplică migrarea**

Run: `npm run migrate supabase/migration-attachments.sql`
Expected: `Migrare aplicată: supabase/migration-attachments.sql`

Rulează-o **a doua oară** ca să dovedești idempotența.
Expected: exact același mesaj, fără eroare.

- [ ] **Step 7: Verifică politicile**

Run:

```bash
node -e "import('dotenv').then(d=>d.config()).then(async()=>{const {default:pg}=await import('pg');const c=new pg.Client({host:process.env.PG_HOST,port:Number(process.env.PG_PORT),database:process.env.PG_DATABASE,user:process.env.PG_USER,password:process.env.PG_PASSWORD,ssl:{rejectUnauthorized:false}});await c.connect();const r=await c.query(\"select schemaname,tablename,policyname from pg_policies where policyname like 'attachments%' order by policyname\");console.log(r.rows);const t=await c.query(\"select column_name from information_schema.columns where table_name='attachments' order by ordinal_position\");console.log(t.rows.map(x=>x.column_name).join(', '));await c.end()})"
```

Expected: cinci politici — `attachments_objects_delete`, `attachments_objects_insert`, `attachments_objects_select` (pe `storage.objects`), `attachments_select`, `attachments_write` (pe `public.attachments`) — și coloanele `id, issue_id, project_id, path, filename, size, content_type, created_at`.

Dacă politicile de pe `storage.objects` lipsesc dar cele de pe `attachments` există, bucketul nu exista când a rulat migrarea: rulează `npm run storage:bucket`, apoi migrarea din nou.

- [ ] **Step 8: Commit**

```bash
git add supabase/migration-attachments.sql scripts/create-attachments-bucket.mjs scripts/apply-migration.mjs package.json
git commit -m "feat(attachments): migration, RLS policies and private bucket"
```

---

## Task 2: `shrinkPlan` — decizia de micșorare, pură

**Files:**
- Create: `src/lib/shrinkImage.ts`
- Test: `src/lib/shrinkImage.test.ts`

**Interfaces:**
- Consumes: nimic.
- Produces:
  - `interface ShrinkOptions { maxEdge: number; photoQuality: number; photoSkipUnderBytes: number; shotSkipUnderBytes: number }`
  - `const SHRINK_DEFAULTS: ShrinkOptions`
  - `type ShrinkOutputType = 'image/jpeg' | 'image/webp'`
  - `interface ShrinkPlan { action: 'skip' | 'recompress' | 'resize'; width: number; height: number; outputType: ShrinkOutputType | null; reason: 'nu-e-imagine' | 'format-neatins' | 'deja-mica' | 'doar-recomprimare' | 'prea-mare' }`
  - `function shrinkPlan(input: { type: string; size: number; width: number; height: number }, opts?: ShrinkOptions): ShrinkPlan`
  - `function safeFilename(name: string): string`
  - `function attachmentFilename(name: string, outputType: ShrinkOutputType | null): string`

  Task 3 folosește `shrinkPlan` și `attachmentFilename`. Task 7 folosește `SHRINK_DEFAULTS`.

- [ ] **Step 1: Scrie testul care picată**

Creează `src/lib/shrinkImage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  shrinkPlan,
  safeFilename,
  attachmentFilename,
  SHRINK_DEFAULTS,
} from './shrinkImage'

const KB = 1024
const MB = 1024 * 1024

describe('shrinkPlan — ramificarea pe format', () => {
  it('ce nu e imagine nu se atinge', () => {
    const p = shrinkPlan({ type: 'application/pdf', size: 9 * MB, width: 0, height: 0 })
    expect(p).toEqual({ action: 'skip', width: 0, height: 0, outputType: null, reason: 'nu-e-imagine' })
  })

  it('GIF-ul nu se atinge niciodată — canvas i-ar distruge animația', () => {
    const p = shrinkPlan({ type: 'image/gif', size: 8 * MB, width: 900, height: 700 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('SVG-ul nu se atinge niciodată — rasterizarea e o degradare', () => {
    const p = shrinkPlan({ type: 'image/svg+xml', size: 3 * MB, width: 4000, height: 4000 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('WEBP-ul se lasă în pace', () => {
    const p = shrinkPlan({ type: 'image/webp', size: 5 * MB, width: 5000, height: 4000 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('un tip de imagine necunoscut se lasă în pace, nu se ghicește', () => {
    const p = shrinkPlan({ type: 'image/avif', size: 5 * MB, width: 5000, height: 4000 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('format-neatins')
  })

  it('PNG nu produce NICIODATĂ JPEG — ar pierde alpha și ar întinde culorile pe text', () => {
    const p = shrinkPlan({ type: 'image/png', size: 9 * MB, width: 5000, height: 3000 })
    expect(p.outputType).toBe('image/webp')
  })

  it('JPEG rămâne JPEG', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 9 * MB, width: 5000, height: 3000 })
    expect(p.outputType).toBe('image/jpeg')
  })

  it('HEIC de pe iPhone e tratat ca fotografie', () => {
    const p = shrinkPlan({ type: 'image/heic', size: 9 * MB, width: 4032, height: 3024 })
    expect(p.outputType).toBe('image/jpeg')
  })
})

describe('shrinkPlan — praguri', () => {
  it('screenshot-ul de terminal măsurat pe ecranul real nu se atinge (1787x481, 53 KB)', () => {
    const p = shrinkPlan({ type: 'image/png', size: 53 * KB, width: 1787, height: 481 })
    expect(p.action).toBe('skip')
    expect(p.reason).toBe('deja-mica')
  })

  it('PNG-urile de desktop au prag mai generos decât fotografiile', () => {
    // 900 KB e peste pragul de fotografie (400 KB) dar sub cel de captură (1,5 MB).
    const shot = shrinkPlan({ type: 'image/png', size: 900 * KB, width: 1900, height: 1000 })
    expect(shot.action).toBe('skip')
    const photo = shrinkPlan({ type: 'image/jpeg', size: 900 * KB, width: 1900, height: 1000 })
    expect(photo.action).toBe('recompress')
  })

  it('captura de telefon de 1,1 MB se recomprimă, fără redimensionare', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 1100 * KB, width: 1080, height: 2400 })
    expect(p).toEqual({
      action: 'recompress',
      width: 1080,
      height: 2400,
      outputType: 'image/jpeg',
      reason: 'doar-recomprimare',
    })
  })

  it('pragul de octeți singur nu scutește o imagine uriașă', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 300 * KB, width: 8000, height: 4000 })
    expect(p.action).toBe('resize')
  })

  it('nu mărește niciodată', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 100 * KB, width: 640, height: 480 })
    expect(p.width).toBe(640)
    expect(p.height).toBe(480)
  })

  it('exact la maxEdge nu se redimensionează degeaba', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 5 * MB, width: SHRINK_DEFAULTS.maxEdge, height: 1000 })
    expect(p.reason).toBe('doar-recomprimare')
    expect(p.width).toBe(SHRINK_DEFAULTS.maxEdge)
  })
})

describe('shrinkPlan — scara e o împărțire cu numere întregi', () => {
  it('poza de 200 MP se împarte cu un întreg, nu se potrivește exact pe maxEdge', () => {
    // 16320 / 3072 = 5,31 → divizor 6 → 2720. Scalarea fracționară aliazează
    // liniile de 1px; ÷6 filtrează curat.
    const p = shrinkPlan({ type: 'image/jpeg', size: 13 * MB, width: 12288, height: 16320 })
    expect(p.action).toBe('resize')
    expect(p.width).toBe(2048)
    expect(p.height).toBe(2720)
  })

  it('rezultatul nu depășește niciodată maxEdge', () => {
    for (const long of [3073, 4000, 4096, 6144, 8000, 16320]) {
      const p = shrinkPlan({ type: 'image/jpeg', size: 20 * MB, width: long, height: Math.round(long / 2) })
      expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(SHRINK_DEFAULTS.maxEdge)
    }
  })

  it('proporția se păstrează', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 13 * MB, width: 12288, height: 16320 })
    expect(p.width / p.height).toBeCloseTo(12288 / 16320, 2)
  })

  it('o latură nu ajunge niciodată la 0', () => {
    const p = shrinkPlan({ type: 'image/jpeg', size: 20 * MB, width: 20000, height: 3 })
    expect(p.height).toBeGreaterThanOrEqual(1)
  })

  it('respectă opțiuni date, nu doar implicitele', () => {
    const p = shrinkPlan(
      { type: 'image/jpeg', size: 5 * MB, width: 4000, height: 2000 },
      { maxEdge: 1000, photoQuality: 0.7, photoSkipUnderBytes: 0, shotSkipUnderBytes: 0 },
    )
    expect(p.width).toBe(1000)
  })
})

describe('safeFilename', () => {
  it('scoate calea', () => {
    expect(safeFilename('C:\\poze\\ecran.png')).toBe('ecran.png')
    expect(safeFilename('/home/user/ecran.png')).toBe('ecran.png')
  })

  it('înlocuiește caracterele de control, păstrează spațiile', () => {
    expect(safeFilename('note de\u0001 lucru.txt')).toBe('note de_ lucru.txt')
  })

  it('nume gol primește unul', () => {
    expect(safeFilename('')).toBe('fisier')
    expect(safeFilename('   ')).toBe('fisier')
  })

  it('taie la 200 de caractere', () => {
    expect(safeFilename('a'.repeat(500)).length).toBe(200)
  })
})

describe('attachmentFilename', () => {
  it('fără reencodare, numele rămâne (curățat)', () => {
    expect(attachmentFilename('C:\\x\\raport.pdf', null)).toBe('raport.pdf')
  })

  it('extensia urmează formatul de IEȘIRE, nu de intrare', () => {
    expect(attachmentFilename('ecran.png', 'image/webp')).toBe('ecran.webp')
    expect(attachmentFilename('IMG_1234.HEIC', 'image/jpeg')).toBe('IMG_1234.jpg')
  })

  it('fișier fără extensie primește una', () => {
    expect(attachmentFilename('scan', 'image/jpeg')).toBe('scan.jpg')
  })

  it('nu produce un nume care e doar extensie', () => {
    expect(attachmentFilename('.HEIC', 'image/jpeg')).toBe('fisier.jpg')
  })
})
```

- [ ] **Step 2: Rulează testul ca să-l vezi picând**

Run: `npx vitest run src/lib/shrinkImage.test.ts`
Expected: FAIL — `Failed to resolve import "./shrinkImage"`.

- [ ] **Step 3: Scrie implementarea minimă**

Creează `src/lib/shrinkImage.ts`:

```ts
// Micșorarea imaginilor înainte de upload.
//
// De ce în browser: nu există server pe traseu — browserul urcă direct în
// Supabase Storage. Micșorarea aici scutește spațiul din bucket (1 GB pe planul
// gratuit) și timpul de așteptare.
//
// PLAFONUL DIN `pickFiles` E SINGURA LIMITĂ, iar și el e doar UX: cine vrea îl
// ocolește, fiindcă nu există server care să verifice. Micșorarea e optimizare,
// nu apărare — poate eșua (format nedecodabil) și atunci pleacă originalul.
//
// CALIBRARE: numerele de mai jos vin din măsurători pe materialul real al
// utilizatorului (70 de imagini, 2026-08-12) — vezi secțiunea „Calibrare" din
// spec. Recalibrare: `npm run test:shrink -- --calibrate <cale-poza>`.

export interface ShrinkOptions {
  /** Latura lungă maximă, în pixeli. */
  maxEdge: number
  /** Calitatea pentru ramura de fotografie, 0..1. */
  photoQuality: number
  /** Sub atâția octeți nu se atinge o fotografie. */
  photoSkipUnderBytes: number
  /** Sub atâția octeți nu se atinge o captură PNG. Mai generos: capturile sunt
   *  deja bine comprimate, iar reencodarea lor câștigă puțin și riscă mult. */
  shotSkipUnderBytes: number
}

/**
 * `maxEdge: 3072` nu e o preferință — e alegerea corpusului. Din 70 de imagini
 * reale, peste 2000px sunt 43, peste 3072px sunt 2. Adică 2000 ar redimensiona
 * majoritatea (inclusiv capturile de telefon de 1080×2400, care au text mic),
 * iar 3072 atinge exact cele două poze de cameră care au nevoie.
 *
 * `photoQuality: 0.85` e punctul de start moștenit din mateSimo (calibrat pe
 * poze de scris de mână) și E SINGURA VALOARE ÎNCĂ NECALIBRATĂ AICI. Cazul care
 * o decide: capturile de telefon 1080×2400, care cad pe ramura de recomprimare.
 */
export const SHRINK_DEFAULTS: ShrinkOptions = {
  maxEdge: 3072,
  photoQuality: 0.85,
  photoSkipUnderBytes: 400 * 1024,
  shotSkipUnderBytes: 1536 * 1024,
}

export type ShrinkOutputType = 'image/jpeg' | 'image/webp'

export interface ShrinkPlan {
  action: 'skip' | 'recompress' | 'resize'
  /** Dimensiunile țintă; egale cu cele de intrare când doar se recomprimă. */
  width: number
  height: number
  /**
   * Formatul de ieșire, câmp de prim rang **anume** ca decizia să fie date
   * testabile. O simplă comparație de octeți („dacă a ieșit mai mare, ține
   * originalul") nu poate vedea pierderea canalului alpha, deci nu poate ține
   * locul deciziei de format. `null` = nu reencodăm.
   */
  outputType: ShrinkOutputType | null
  reason: 'nu-e-imagine' | 'format-neatins' | 'deja-mica' | 'doar-recomprimare' | 'prea-mare'
}

/** Formatele pe care le reencodăm, și în ce. Orice altceva se lasă în pace. */
const BRANCH: Record<string, ShrinkOutputType> = {
  'image/png': 'image/webp',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/heic': 'image/jpeg',
  'image/heif': 'image/jpeg',
}

/**
 * Decizia, separată de canvas ca să poată fi testată fără browser.
 *
 * Nu mărește niciodată. Iar când micșorează, scara e o împărțire cu un număr
 * ÎNTREG, nu o potrivire exactă pe `maxEdge`: scalarea fracționară aliazează
 * liniile de 1px (bordurile de UI, conturul glifelor), iar ÷2 sau ÷3 filtrează
 * curat. Plătim cu câțiva pixeli sub limită, câștigăm text care se citește.
 */
export function shrinkPlan(
  input: { type: string; size: number; width: number; height: number },
  opts: ShrinkOptions = SHRINK_DEFAULTS,
): ShrinkPlan {
  const { type, size, width, height } = input
  const keep = (reason: ShrinkPlan['reason']): ShrinkPlan => ({
    action: 'skip',
    width,
    height,
    outputType: null,
    reason,
  })

  if (!type.startsWith('image/')) return keep('nu-e-imagine')

  const outputType = BRANCH[type.toLowerCase()]
  // GIF (canvas îi pierde animația), SVG (rasterizarea e o degradare), WEBP
  // (deja eficient) și orice tip necunoscut: nu ghicim, nu atingem.
  if (!outputType) return keep('format-neatins')

  const isShot = outputType === 'image/webp'
  const skipUnder = isShot ? opts.shotSkipUnderBytes : opts.photoSkipUnderBytes
  const longEdge = Math.max(width, height)

  if (size <= skipUnder && longEdge <= opts.maxEdge) return keep('deja-mica')

  if (longEdge <= opts.maxEdge) {
    // Fișier gras, dimensiuni rezonabile: merită recomprimat, nu redimensionat.
    return { action: 'recompress', width, height, outputType, reason: 'doar-recomprimare' }
  }

  const divisor = Math.ceil(longEdge / opts.maxEdge)
  return {
    action: 'resize',
    width: Math.max(1, Math.round(width / divisor)),
    height: Math.max(1, Math.round(height / divisor)),
    outputType,
    reason: 'prea-mare',
  }
}

/**
 * Nume pentru AFIȘARE (coloana `filename`). Scoate calea, caracterele de
 * control, limitează lungimea. NU se folosește niciodată în calea din Storage —
 * aceea e construită doar din id-uri.
 */
export function safeFilename(name: string): string {
  const base = (name ?? '').split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex -- match intenționat de caractere de control
  const cleaned = base.replace(/[\x00-\x1f]/g, '_').trim()
  if (!cleaned) return 'fisier'
  return cleaned.slice(0, 200)
}

const EXT: Record<ShrinkOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * `ecran.png` + WebP → `ecran.webp`. Extensia e cosmetică (`content_type` din DB
 * e sursa de adevăr la descărcare), dar un nume care minte despre conținut
 * încurcă pe oricine descarcă fișierul.
 *
 * Se apelează DUPĂ micșorare, cu formatul chiar produs — inclusiv `null`, când
 * garda de dimensiune a păstrat originalul.
 */
export function attachmentFilename(name: string, outputType: ShrinkOutputType | null): string {
  const safe = safeFilename(name)
  if (!outputType) return safe
  const stem = safe.replace(/\.[^.]+$/, '')
  return `${stem || 'fisier'}.${EXT[outputType]}`
}
```

- [ ] **Step 4: Rulează testele**

Run: `npx vitest run src/lib/shrinkImage.test.ts`
Expected: PASS, 27 de teste.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: fără ieșire, cod 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shrinkImage.ts src/lib/shrinkImage.test.ts
git commit -m "feat(attachments): shrink decision branches on input format"
```

---

## Task 3: `shrinkImage()` pe canvas, plus harness-ul de calibrare

**Files:**
- Modify: `src/lib/shrinkImage.ts` (adaugă funcția impură la final)
- Create: `scripts/test-shrink-image.mjs`
- Modify: `package.json` (script `test:shrink`)

**Interfaces:**
- Consumes: `shrinkPlan`, `attachmentFilename`, `SHRINK_DEFAULTS`, `ShrinkOptions` din Task 2.
- Produces: `function shrinkImage(file: File, opts?: ShrinkOptions): Promise<File>`. Task 7 o apelează.

- [ ] **Step 1: Adaugă funcția de canvas**

La finalul `src/lib/shrinkImage.ts`:

```ts
function drawTo(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Implicitul browserului pe scalări mari face textul zimțat, exact la ce ne
  // uităm noi într-un screenshot de cod.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/**
 * Întoarce fișierul micșorat sau, în ORICE caz de îndoială, fișierul primit.
 *
 * Regula întregii funcții: **nu strica uploadul**. Orice eșec — format pe care
 * browserul nu-l decodează (HEIC în majoritatea browserelor), canvas
 * indisponibil, rezultat mai mare decât originalul — se termină cu fișierul
 * original, nu cu o eroare în fața utilizatorului.
 *
 * Orientarea: reencodarea prin canvas pierde EXIF-ul, deci orientarea trebuie
 * să intre în pixeli la decodare, altfel o poză verticală ajunge culcată.
 * `imageOrientation: 'from-image'` e scris explicit nu pentru că Chromium ar
 * greși fără el — acolo e deja implicitul — ci pentru că implicitul din
 * specificație a fost `none` până nu demult, iar orientarea nu are voie să
 * depindă de versiunea de browser.
 *
 * Calitatea la WebP e 1.0 = fără pierderi. Ramura de PNG există ca să scadă
 * octeții FĂRĂ să atingă pixelii; un WebP cu pierderi ar readuce exact
 * artefactele pentru care am ocolit JPEG-ul.
 */
export async function shrinkImage(file: File, opts: ShrinkOptions = SHRINK_DEFAULTS): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file // format nedecodabil aici
  }

  try {
    const plan = shrinkPlan(
      { type: file.type, size: file.size, width: bitmap.width, height: bitmap.height },
      opts,
    )
    if (plan.action === 'skip' || !plan.outputType) return file

    const target = drawTo(plan.width, plan.height)
    if (!target) return file
    target.ctx.drawImage(bitmap, 0, 0, plan.width, plan.height)

    const quality = plan.outputType === 'image/webp' ? 1 : opts.photoQuality
    const blob = await new Promise<Blob | null>((resolve) =>
      target.canvas.toBlob(resolve, plan.outputType!, quality),
    )
    // Plasă de siguranță, nu decizia principală: se întâmplă real ca o
    // reencodare să crească. Decizia de format s-a luat deja în `shrinkPlan`.
    if (!blob || blob.size >= file.size) return file

    return new File([blob], attachmentFilename(file.name, plan.outputType), {
      type: plan.outputType,
      lastModified: file.lastModified,
    })
  } finally {
    bitmap.close()
  }
}
```

- [ ] **Step 2: Portează harness-ul de calibrare**

Creează `scripts/test-shrink-image.mjs`. E o adaptare a `scripts/test-shrink-image.mjs` din `2026-07-22__mateSimo3aug/app` — citește-l ca referință, dar folosește versiunea de mai jos, care are combinațiile și verificările potrivite pentru Horizontal:

```js
// Verificarea în browser a micșorării: canvas, EXIF, toBlob — lucruri pe care
// testele unitare nu le pot atinge.
//
// Rulează cu `npm run test:shrink`. Nu e în suita implicită (cere browser și
// server de dezvoltare); își pornește singur serverul, ca să nu aibă pași de
// pregătire pe care cineva să-i uite.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = Number(process.env.SHRINK_PORT ?? 5311)
const APP = process.env.APP_URL ?? `http://localhost:${PORT}`
let server = null

if (!process.env.APP_URL) {
  // Comandă ca un singur șir: cu `shell: true` și listă de argumente, Node
  // avertizează (DEP0190) că argumentele se concatenează, nu se escapează.
  server = spawn(`npx vite --port ${PORT} --strictPort`, { stdio: 'ignore', shell: true })
  const deadline = Date.now() + 60000
  for (;;) {
    try { if ((await fetch(APP)).ok) break } catch { /* încă nu răspunde */ }
    if (Date.now() > deadline) {
      server.kill()
      console.error('Serverul de dezvoltare nu a pornit în 60s.')
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
process.on('exit', () => { if (server) server.kill() })

const out = []
const check = (n, c, d = '') => out.push(`${c ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`)

/**
 * MODUL DE CALIBRARE: `npm run test:shrink -- --calibrate <cale-poza>`
 *
 * Trece o imagine REALĂ prin mai multe combinații, scrie rezultatele pe disc și
 * taie din fiecare o bucată la scară 1:1 din zona cu text dens. Constantele din
 * `SHRINK_DEFAULTS` se aleg uitându-te la bucățile alea, nu la kilobytes.
 */
const COMBOS = [
  { maxEdge: 3072, photoQuality: 0.92 },
  { maxEdge: 3072, photoQuality: 0.85 }, // implicitul propus
  { maxEdge: 3072, photoQuality: 0.78 },
  { maxEdge: 2048, photoQuality: 0.85 },
]

async function calibrate(page, filePath) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { basename, join, extname } = await import('node:path')
  const raw = readFileSync(filePath)
  const dir = join(process.cwd(), 'tmp-calibrare')
  mkdirSync(dir, { recursive: true })
  const ext = extname(filePath).toLowerCase()
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  console.log(`original: ${basename(filePath)}, ${(raw.length / 1024).toFixed(0)} KB, ${type}`)

  const results = await page.evaluate(async ({ b64, combos, type }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const { shrinkImage } = await import('/src/lib/shrinkImage.ts')
    const file = new File([bin], `proba${type === 'image/png' ? '.png' : '.jpg'}`, { type })
    const toB64 = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (const byte of buf) s += String.fromCharCode(byte)
      return btoa(s)
    }
    const dimsOf = async (f) => {
      const b = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const d = { w: b.width, h: b.height }
      b.close()
      return d
    }
    const src = await dimsOf(file)
    const list = []
    for (const c of combos) {
      const shrunk = await shrinkImage(file, {
        ...c,
        photoSkipUnderBytes: 0,
        shotSkipUnderBytes: 0,
      })
      const d = await dimsOf(shrunk)
      // Bucată la scară 1:1 din treimea de sus, unde textul e cel mai dens.
      const cw = Math.min(1000, d.w)
      const ch = Math.min(560, d.h)
      const cv = document.createElement('canvas')
      cv.width = cw; cv.height = ch
      const bmp = await createImageBitmap(shrunk, { imageOrientation: 'from-image' })
      cv.getContext('2d').drawImage(bmp, Math.round((d.w - cw) / 2), Math.round(d.h * 0.08), cw, ch, 0, 0, cw, ch)
      bmp.close()
      const cropBlob = await new Promise((r) => cv.toBlob(r, 'image/png'))
      list.push({ ...c, size: shrunk.size, outType: shrunk.type, w: d.w, h: d.h, img: await toB64(shrunk), crop: await toB64(cropBlob) })
    }
    return { src, list }
  }, { b64: raw.toString('base64'), combos: COMBOS, type })

  console.log(`decodat: ${results.src.w}×${results.src.h}`)
  console.log('latura  calitate  marime      ieșire       dimensiuni     raport')
  for (const r of results.list) {
    const name = `${r.maxEdge}-q${String(r.photoQuality).replace('.', '')}`
    const outExt = r.outType === 'image/webp' ? 'webp' : r.outType === 'image/png' ? 'png' : 'jpg'
    writeFileSync(join(dir, `proba-${name}.${outExt}`), Buffer.from(r.img, 'base64'))
    writeFileSync(join(dir, `crop-${name}.png`), Buffer.from(r.crop, 'base64'))
    console.log(
      `${String(r.maxEdge).padEnd(7)} ${String(r.photoQuality).padEnd(9)} ` +
      `${(r.size / 1024).toFixed(0).padStart(6)} KB  ${r.outType.padEnd(12)} ` +
      `${`${r.w}×${r.h}`.padEnd(14)} de ${(raw.length / r.size).toFixed(1)}× mai mic`,
    )
  }
  console.log(`\nFisierele si bucatile 1:1 sunt in ${dir}`)
  console.log('Uita-te la crop-*.png: se citeste textul mic? Aia e conditia, nu kilobytes.')
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => out.push(`FAIL eroare JS — ${e.message}`))
await page.goto(APP)

const calibIdx = process.argv.indexOf('--calibrate')
if (calibIdx >= 0) {
  const path = process.argv[calibIdx + 1]
  if (!path) {
    console.error('Lipseste calea: npm run test:shrink -- --calibrate C:\\cale\\poza.png')
    await browser.close()
    process.exit(1)
  }
  await calibrate(page, path)
  await browser.close()
  process.exit(0)
}

const run = async (name, bytes, type) => page.evaluate(async ({ name, bytes, type }) => {
  const { shrinkImage } = await import('/src/lib/shrinkImage.ts')
  const file = new File([new Uint8Array(bytes)], name, { type })
  const outFile = await shrinkImage(file)
  const dims = async (f) => {
    // Întoarce null pe ce nu se decodează, în loc să arunce. Cazul real:
    // GIF-ul fals din verificarea 5. `shrinkImage` îl întoarce neatins, exact
    // cum trebuie — dar harness-ul îl mai măsoară o dată după aceea, iar
    // `createImageBitmap` aruncă. Fără garda asta, scriptul moare înainte de
    // tally și pare că verificările n-au rulat, când în realitate au trecut.
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' })
      const d = { w: bmp.width, h: bmp.height }
      bmp.close()
      return d
    } catch {
      return null
    }
  }
  return {
    inSize: file.size, outSize: outFile.size,
    inName: file.name, outName: outFile.name,
    outType: outFile.type, same: outFile === file,
    outDims: outFile.type.startsWith('image/') ? await dims(outFile) : null,
  }
}, { name, bytes: [...bytes], type })

// ── 1. fotografie uriașă: se micșorează, iese JPEG, latura lungă sub maxEdge
const photo = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 6000; c.height = 4000
  const x = c.getContext('2d')
  x.fillStyle = '#cbb'; x.fillRect(0, 0, c.width, c.height)
  x.fillStyle = '#123'; x.font = '90px Georgia'
  for (let y = 200; y < c.height; y += 200) x.fillText('detaliu fin 0123456789', 100, y)
  const img = x.getImageData(0, 0, c.width, 400)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.sin(i) * 12) | 0
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
  }
  x.putImageData(img, 0, 0)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
const r1 = await run('IMG_0001.jpg', Buffer.from(photo), 'image/jpeg')
check('fotografia uriasa se micsoreaza', r1.outSize < r1.inSize, JSON.stringify({ in: r1.inSize, out: r1.outSize }))
check('latura lunga ajunge sub maxEdge (3072)', r1.outDims && Math.max(r1.outDims.w, r1.outDims.h) <= 3072, JSON.stringify(r1.outDims))
check('scara e un divizor intreg (6000/2 = 3000)', r1.outDims && r1.outDims.w === 3000 && r1.outDims.h === 2000, JSON.stringify(r1.outDims))
check('fotografia iese JPEG', r1.outType === 'image/jpeg', r1.outType)
check('numele primeste .jpg', r1.outName === 'IMG_0001.jpg', r1.outName)

// ── 2. PNG mare cu text: iese WEBP, NICIODATA JPEG
const shot = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 4000; c.height = 2200
  const x = c.getContext('2d')
  x.fillStyle = '#1e1e1e'; x.fillRect(0, 0, c.width, c.height)
  x.fillStyle = '#9cdcfe'; x.font = '18px monospace'
  for (let y = 30; y < c.height; y += 24) x.fillText('const x = foo(bar, baz) // 0123456789 il1I O0', 20, y)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
const r2 = await run('ecran.png', Buffer.from(shot), 'image/png')
check('PNG-ul NU iese niciodata JPEG', r2.outType !== 'image/jpeg', r2.outType)
check('PNG mare iese WEBP sau rămâne PNG neatins', r2.outType === 'image/webp' || r2.same === true, JSON.stringify({ type: r2.outType, same: r2.same }))
check('nicio ieșire nu e mai mare decat intrarea', r2.outSize <= r2.inSize, JSON.stringify({ in: r2.inSize, out: r2.outSize }))

// ── 3. imagine mica: nu se atinge, si e CHIAR acelasi obiect
const small = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 600; c.height = 400
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
  return [...new Uint8Array(await blob.arrayBuffer())]
})
const r3 = await run('mica.jpg', Buffer.from(small), 'image/jpeg')
check('imaginea mica nu se atinge (acelasi fisier, nu o copie)', r3.same === true && r3.outSize === r3.inSize, JSON.stringify(r3))

// ── 4. PDF: nu se atinge
const r4 = await run('raport.pdf', Buffer.from('%PDF-1.4 fake'), 'application/pdf')
check('PDF-ul nu se atinge', r4.same === true, JSON.stringify(r4))

// ── 5. GIF: nu se atinge (animatia ar muri)
const r5 = await run('anim.gif', Buffer.from('GIF89a fake'), 'image/gif')
check('GIF-ul nu se atinge', r5.same === true, JSON.stringify(r5))

await browser.close()
console.log(out.join('\n'))
console.log(`\n${out.filter((l) => l.startsWith('OK')).length} ok, ${out.filter((l) => l.startsWith('FAIL')).length} fail`)
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0)
```

- [ ] **Step 3: Adaugă scriptul în package.json**

La `scripts`, după `"storage:bucket"`:

```json
    "test:shrink": "node scripts/test-shrink-image.mjs",
```

- [ ] **Step 4: Rulează harness-ul**

Run: `npm run test:shrink`
Expected: toate liniile încep cu `OK`, iar ultima e `11 ok, 0 fail`.

Dacă `chromium.launch()` dă „Executable doesn't exist", rulează `npx playwright install chromium` o singură dată.

- [ ] **Step 5: Typecheck și suita de teste**

Run: `npm run typecheck && npm test`
Expected: ambele trec.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shrinkImage.ts scripts/test-shrink-image.mjs package.json
git commit -m "feat(attachments): canvas shrink plus browser calibration harness"
```

---

## Task 4: `pickFiles` — extragerea fișierelor, fără DOM

**Files:**
- Create: `src/lib/pickFiles.ts`
- Test: `src/lib/pickFiles.test.ts`

**Interfaces:**
- Consumes: nimic.
- Produces:
  - `interface FileLike { name: string; type: string; size: number }`
  - `interface PickCaps { imageMaxBytes: number; otherMaxBytes: number }`
  - `const PICK_CAPS: PickCaps`
  - `type RejectReason = 'prea-mare' | 'gol'`
  - `interface PickResult<T extends FileLike> { accept: T[]; renamed: Record<number, string>; rejected: { name: string; reason: RejectReason }[] }`
  - `function carriesFiles(types: readonly string[]): boolean`
  - `function pickFiles<T extends FileLike>(input: { types: readonly string[]; files: readonly T[] }, opts?: { caps?: PickCaps; now?: () => Date }): PickResult<T>`
  - `function rejectMessage(rejected: PickResult<FileLike>['rejected']): string | null`

  Task 7 le folosește pe toate.

- [ ] **Step 1: Scrie testul care picată**

Creează `src/lib/pickFiles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickFiles, carriesFiles, rejectMessage, PICK_CAPS } from './pickFiles'

const MB = 1024 * 1024
const f = (name: string, type: string, size: number) => ({ name, type, size })
const at = (iso: string) => () => new Date(iso)

describe('carriesFiles', () => {
  it('recunoaște un transfer cu fișiere', () => {
    expect(carriesFiles(['Files'])).toBe(true)
    expect(carriesFiles(['text/plain', 'Files'])).toBe(true)
  })

  it('un transfer doar cu text nu e attachment', () => {
    expect(carriesFiles(['text/plain', 'text/html'])).toBe(false)
    expect(carriesFiles([])).toBe(false)
  })
})

describe('pickFiles — plafoane', () => {
  it('acceptă ce e în limite', () => {
    const r = pickFiles({ types: ['Files'], files: [f('a.png', 'image/png', 2 * MB)] })
    expect(r.accept).toHaveLength(1)
    expect(r.rejected).toEqual([])
  })

  it('imaginile au plafon 20 MB, măsurat înainte de micșorare', () => {
    expect(PICK_CAPS.imageMaxBytes).toBe(20 * MB)
    const ok = pickFiles({ types: ['Files'], files: [f('a.jpg', 'image/jpeg', 19 * MB)] })
    expect(ok.accept).toHaveLength(1)
    const nu = pickFiles({ types: ['Files'], files: [f('a.jpg', 'image/jpeg', 21 * MB)] })
    expect(nu.accept).toEqual([])
    expect(nu.rejected).toEqual([{ name: 'a.jpg', reason: 'prea-mare' }])
  })

  it('non-imaginile au plafon 10 MB', () => {
    expect(PICK_CAPS.otherMaxBytes).toBe(10 * MB)
    const nu = pickFiles({ types: ['Files'], files: [f('log.txt', 'text/plain', 11 * MB)] })
    expect(nu.rejected).toEqual([{ name: 'log.txt', reason: 'prea-mare' }])
  })

  it('un fișier de zero octeți e respins — un folder tras produce așa ceva', () => {
    const r = pickFiles({ types: ['Files'], files: [f('folder', '', 0)] })
    expect(r.accept).toEqual([])
    expect(r.rejected).toEqual([{ name: 'folder', reason: 'gol' }])
  })

  it('acceptă și respinge în același lot, fără să piardă nimic în silență', () => {
    const r = pickFiles({
      types: ['Files'],
      files: [f('bun.png', 'image/png', 1 * MB), f('gras.zip', 'application/zip', 50 * MB)],
    })
    expect(r.accept.map((x) => x.name)).toEqual(['bun.png'])
    expect(r.rejected).toEqual([{ name: 'gras.zip', reason: 'prea-mare' }])
  })

  it('nu acceptă nimic dacă transferul nu poartă fișiere', () => {
    const r = pickFiles({ types: ['text/plain'], files: [f('a.png', 'image/png', 1 * MB)] })
    expect(r.accept).toEqual([])
    expect(r.rejected).toEqual([])
  })

  it('respectă plafoane date', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('a.png', 'image/png', 5 * MB)] },
      { caps: { imageMaxBytes: 1 * MB, otherMaxBytes: 1 * MB } },
    )
    expect(r.accept).toEqual([])
  })

  it('nu există plafon pe numărul de fișiere', () => {
    const many = Array.from({ length: 40 }, (_, i) => f(`p${i}.png`, 'image/png', 1024))
    const r = pickFiles({ types: ['Files'], files: many })
    expect(r.accept).toHaveLength(40)
  })
})

describe('pickFiles — nume sintetizate', () => {
  it('screenshot-ul lipit se redenumește cu data și ora', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('image.png', 'image/png', 50 * 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
  })

  it('două screenshot-uri în același lot nu primesc același nume', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('image.png', 'image/png', 1024), f('image.png', 'image/png', 2048)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
    expect(r.renamed[1]).toBe('screenshot-2026-08-12-14-32-07-2.png')
  })

  it('extensia sintetizată urmează tipul real', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('image.jpeg', 'image/jpeg', 1024)] },
      { now: at('2026-08-12T09:05:00') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-09-05-00.jpg')
  })

  it('un nume adevărat nu se atinge', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('bug-la-login.png', 'image/png', 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBeUndefined()
  })

  it('un fișier fără nume primește unul', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('', 'image/png', 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
  })

  it('indexul din `renamed` e cel din `accept`, nu cel din intrare', () => {
    // Primul fișier e respins, deci screenshot-ul acceptat e la indexul 0.
    const r = pickFiles(
      { types: ['Files'], files: [f('gras.zip', 'application/zip', 50 * MB), f('image.png', 'image/png', 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.accept).toHaveLength(1)
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
  })
})

describe('rejectMessage', () => {
  it('tace când n-a fost respins nimic', () => {
    expect(rejectMessage([])).toBeNull()
  })

  it('un singur fișier prea mare: spune care și ce să facă', () => {
    expect(rejectMessage([{ name: 'poza.jpg', reason: 'prea-mare' }])).toBe(
      'poza.jpg e prea mare. Imaginile pot avea cel mult 20 MB, celelalte fișiere 10 MB.',
    )
  })

  it('mai multe: le numără, nu le înșiră pe toate', () => {
    expect(
      rejectMessage([
        { name: 'a.zip', reason: 'prea-mare' },
        { name: 'b.zip', reason: 'prea-mare' },
      ]),
    ).toBe('2 fișiere nu au fost adăugate: prea mari. Imaginile pot avea cel mult 20 MB, celelalte fișiere 10 MB.')
  })

  it('un folder tras primește un mesaj despre foldere, nu despre mărime', () => {
    expect(rejectMessage([{ name: 'poze', reason: 'gol' }])).toBe(
      'poze nu a putut fi citit. Folderele nu se pot atașa — trage fișierele din ele.',
    )
  })
})
```

- [ ] **Step 2: Rulează testul ca să-l vezi picând**

Run: `npx vitest run src/lib/pickFiles.test.ts`
Expected: FAIL — `Failed to resolve import "./pickFiles"`.

- [ ] **Step 3: Scrie implementarea minimă**

Creează `src/lib/pickFiles.ts`:

```ts
// Ce fișiere intră, din paste sau din drop.
//
// Fără DOM, anume: Vitest rulează în `environment: 'node'` aici, deci un seam
// care atinge ClipboardEvent n-ar putea fi testat. Adaptoarele care ating
// evenimentele reale (`fromClipboard`, `fromDrop` din Attachments.tsx) au trei
// linii și doar reformează datele; toată politica e mai jos, testabilă cu
// obiecte literale.

export interface FileLike {
  name: string
  type: string
  size: number
}

export interface PickCaps {
  imageMaxBytes: number
  otherMaxBytes: number
}

/**
 * Plafoanele sunt PUR UX, nu apărare: browserul urcă direct în Storage, nu
 * există server pe traseu, deci cine vrea le ocolește. Apărarea reală e RLS-ul,
 * care decide *dacă* poți scrie, nu *cât*.
 *
 * Imaginile se măsoară ÎNAINTE de micșorare, fiindcă micșorarea poate eșua (un
 * format nedecodabil) și atunci pleacă originalul.
 */
export const PICK_CAPS: PickCaps = {
  imageMaxBytes: 20 * 1024 * 1024,
  otherMaxBytes: 10 * 1024 * 1024,
}

export type RejectReason = 'prea-mare' | 'gol'

export interface PickResult<T extends FileLike> {
  accept: T[]
  /**
   * Nume de înlocuire, cheiat pe indexul din `accept`. Separat de `accept` ca
   * fișierele să rămână obiectele originale (`File`), nu copii — un `new File`
   * doar pentru redenumire ar rescrie octeții degeaba.
   */
  renamed: Record<number, string>
  rejected: { name: string; reason: RejectReason }[]
}

/** `dataTransfer.types` conține 'Files' doar când transferul poartă fișiere. */
export function carriesFiles(types: readonly string[]): boolean {
  return types.includes('Files')
}

/** Numele pe care browserele le dau unui screenshot din clipboard. */
const GENERIC = /^(image|imagine)\.(png|jpe?g|webp|gif)$/i

const SYNTH_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/**
 * Aplică plafoanele și sintetizează nume pentru screenshot-urile lipite.
 *
 * De ce redenumirea: un screenshot lipit ajunge de la browser cu numele
 * `image.png`, mereu. Fără redenumire fiecare rând din listă ar arăta identic
 * și n-ai putea deosebi două poze una de alta.
 */
export function pickFiles<T extends FileLike>(
  input: { types: readonly string[]; files: readonly T[] },
  opts: { caps?: PickCaps; now?: () => Date } = {},
): PickResult<T> {
  const caps = opts.caps ?? PICK_CAPS
  const now = opts.now ?? (() => new Date())

  const accept: T[] = []
  const renamed: Record<number, string> = {}
  const rejected: { name: string; reason: RejectReason }[] = []

  if (!carriesFiles(input.types)) return { accept, renamed, rejected }

  let synthesized = 0
  for (const file of input.files) {
    if (file.size === 0) {
      rejected.push({ name: file.name || 'fișier', reason: 'gol' })
      continue
    }
    const cap = file.type.startsWith('image/') ? caps.imageMaxBytes : caps.otherMaxBytes
    if (file.size > cap) {
      rejected.push({ name: file.name || 'fișier', reason: 'prea-mare' })
      continue
    }
    const index = accept.length
    accept.push(file)
    if (!file.name || GENERIC.test(file.name)) {
      synthesized += 1
      const ext = SYNTH_EXT[file.type.toLowerCase()] ?? 'png'
      const suffix = synthesized > 1 ? `-${synthesized}` : ''
      renamed[index] = `screenshot-${stamp(now())}${suffix}.${ext}`
    }
  }

  return { accept, renamed, rejected }
}

const CAPS_TEXT = 'Imaginile pot avea cel mult 20 MB, celelalte fișiere 10 MB.'

/**
 * Ce se arată pe ecran când plafonul a tăiat din ce ai ales. Refuzul tăcut e un
 * bug în altă haină: alegi șase fișiere, vezi două, și n-ai cum să afli de ce.
 */
export function rejectMessage(rejected: PickResult<FileLike>['rejected']): string | null {
  if (rejected.length === 0) return null

  const empty = rejected.filter((r) => r.reason === 'gol')
  if (empty.length === rejected.length) {
    const which = empty.length === 1 ? `${empty[0].name} nu a putut fi citit` : `${empty.length} fișiere nu au putut fi citite`
    return `${which}. Folderele nu se pot atașa — trage fișierele din ele.`
  }

  if (rejected.length === 1) return `${rejected[0].name} e prea mare. ${CAPS_TEXT}`
  return `${rejected.length} fișiere nu au fost adăugate: prea mari. ${CAPS_TEXT}`
}
```

- [ ] **Step 4: Rulează testele**

Run: `npx vitest run src/lib/pickFiles.test.ts`
Expected: PASS, 20 de teste.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: cod 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pickFiles.ts src/lib/pickFiles.test.ts
git commit -m "feat(attachments): DOM-free file picking with caps and synthesized names"
```

---

## Task 5: `src/data/attachments.ts` — stratul Supabase

**Files:**
- Create: `src/data/attachments.ts`
- Test: `src/data/attachments.test.ts`

**Interfaces:**
- Consumes: `requireSupabase` din `src/lib/supabase.ts`.
- Produces:
  - `interface Attachment { id: string; issueId: string; projectId: string; path: string; filename: string; size: number; contentType: string; createdAt: string }`
  - `const BUCKET = 'attachments'`
  - `const SIGNED_TTL_SECONDS = 8 * 60 * 60`
  - `function buildAttachmentPath(projectId: string, issueId: string, attachmentId: string): string`
  - `function isRenderableImage(contentType: string): boolean`
  - `function chunk<T>(items: readonly T[], size: number): T[][]`
  - `function cachedUrls(paths: readonly string[], now: number): { hits: Record<string, string>; misses: string[] }`
  - `function rememberUrls(entries: { path: string; url: string }[], now: number, ttlSeconds?: number): void`
  - `function resetUrlCache(): void`
  - `async function listAttachments(issueId: string): Promise<Attachment[]>`
  - `async function uploadAttachment(input: { issueId: string; projectId: string; file: File; filename: string }): Promise<Attachment>`
  - `async function deleteAttachment(a: Attachment): Promise<void>`
  - `async function signedUrls(paths: readonly string[]): Promise<Record<string, string>>`
  - `async function signedDownloadUrl(a: Attachment): Promise<string | null>`
  - `async function removeObjects(paths: readonly string[]): Promise<void>`
  - `async function pathsForIssues(ids: readonly string[]): Promise<string[]>`
  - `async function pathsForProject(projectId: string): Promise<string[]>`

  Task 6 folosește `removeObjects`, `pathsForIssues`, `pathsForProject`. Task 7 folosește restul.

- [ ] **Step 1: Scrie testul care picată**

Creează `src/data/attachments.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-in pentru clientul Supabase: acoperă lanțurile pe care le folosește
// modulul (.from().select().eq()/.in(), .insert().select().single(), .delete(),
// plus .storage.from().upload()/.remove()/.createSignedUrls()).
const { fake } = vi.hoisted(() => {
  type Row = Record<string, unknown>
  // Comutatoare de eșec, citite din `run()`. Preferate înlocuirii lui `fake.from`
  // pe durata unui test: aceea lăsa fake-ul într-o stare pe care testul următor
  // o moștenea dacă restaurarea nu se executa (o aserțiune care aruncă).
  const flags = { failInsert: false }
  class Query {
    op = 'select'
    filters: [string, unknown][] = []
    inFilters: [string, unknown[]][] = []
    payload: Row | null = null
    single_ = false
    constructor(private tables: Record<string, Row[]>, private table: string) {}
    select() { return this }
    insert(row: Row) { this.op = 'insert'; this.payload = row; return this }
    delete() { this.op = 'delete'; return this }
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
    in(col: string, vals: unknown[]) { this.inFilters.push([col, vals]); return this }
    order() { return this }
    single() { this.single_ = true; return this }
    private match(r: Row) {
      return this.filters.every(([c, v]) => r[c] === v) && this.inFilters.every(([c, vs]) => vs.includes(r[c]))
    }
    private run() {
      const t = this.tables[this.table]
      if (this.op === 'insert') {
        if (flags.failInsert) return { data: null, error: { message: 'rls' } }
        const row = { ...this.payload }
        t.push(row)
        return { data: this.single_ ? row : [row], error: null }
      }
      if (this.op === 'delete') {
        this.tables[this.table] = t.filter((r) => !this.match(r))
        return { data: null, error: null }
      }
      const rows = t.filter((r) => this.match(r))
      return { data: this.single_ ? (rows[0] ?? null) : rows, error: null }
    }
    then(resolve: (v: unknown) => void) { resolve(this.run()) }
  }
  class FakeStorage {
    objects = new Set<string>()
    removed: string[][] = []
    uploads: { path: string; options: Record<string, unknown> }[] = []
    failUpload = false
    failRemove = false
    from(_bucket: string) {
      return {
        upload: async (path: string, _body: unknown, options: Record<string, unknown>) => {
          if (this.failUpload) return { data: null, error: { message: 'upload a picat' } }
          this.objects.add(path)
          this.uploads.push({ path, options })
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          this.removed.push(paths)
          if (this.failRemove) return { data: null, error: { message: 'remove a picat' } }
          paths.forEach((p) => this.objects.delete(p))
          return { data: null, error: null }
        },
        createSignedUrls: async (paths: string[], _ttl: number) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://sb.test/${path}?token=abc`, error: null })),
          error: null,
        }),
        createSignedUrl: async (path: string, _ttl: number, opts?: Record<string, unknown>) => ({
          data: { signedUrl: `https://sb.test/${path}?dl=${String(opts?.download ?? '')}` },
          error: null,
        }),
      }
    }
    reset() {
      this.objects = new Set()
      this.removed = []
      this.uploads = []
      this.failUpload = false
      this.failRemove = false
    }
  }
  class Fake {
    tables: Record<string, Row[]> = { attachments: [] }
    storage = new FakeStorage()
    flags = flags
    from(table: string) { return new Query(this.tables, table) }
    reset() { this.tables = { attachments: [] }; this.storage.reset(); flags.failInsert = false }
  }
  return { fake: new Fake() }
})

vi.mock('../lib/supabase', () => ({ supabase: fake, requireSupabase: () => fake }))

import {
  buildAttachmentPath,
  isRenderableImage,
  chunk,
  cachedUrls,
  rememberUrls,
  resetUrlCache,
  listAttachments,
  uploadAttachment,
  deleteAttachment,
  signedUrls,
  removeObjects,
  pathsForIssues,
  pathsForProject,
} from './attachments'

beforeEach(() => {
  fake.reset()
  resetUrlCache()
})

describe('buildAttachmentPath', () => {
  it('proiectul e primul segment — politica RLS citește exact segmentul ăsta', () => {
    expect(buildAttachmentPath('tur', 'TUR-01', 'abc-123')).toBe('tur/TUR-01/abc-123')
  })

  it('calea nu are extensie — content_type real trăiește în DB', () => {
    expect(buildAttachmentPath('tur', 'TUR-01', 'abc-123')).not.toMatch(/\.\w+$/)
  })
})

describe('isRenderableImage', () => {
  it('tipurile de imagine sigure se randează inline', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isRenderableImage(t)).toBe(true)
    }
  })

  it('SVG-ul NU se randează inline, nici HTML-ul', () => {
    expect(isRenderableImage('image/svg+xml')).toBe(false)
    expect(isRenderableImage('text/html')).toBe(false)
  })

  it('un tip necunoscut nu se randează', () => {
    expect(isRenderableImage('application/octet-stream')).toBe(false)
  })
})

describe('chunk', () => {
  it('împarte în tranșe de mărimea cerută', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('lista goală dă zero tranșe', () => {
    expect(chunk([], 2)).toEqual([])
  })
})

describe('memorarea URL-urilor semnate', () => {
  it('un URL memorat se refolosește — altfel fiecare deschidere redescarcă tot', () => {
    rememberUrls([{ path: 'p/i/a', url: 'https://x/a' }], 1_000_000)
    const r = cachedUrls(['p/i/a'], 1_000_000 + 60_000)
    expect(r.hits).toEqual({ 'p/i/a': 'https://x/a' })
    expect(r.misses).toEqual([])
  })

  it('un URL aproape expirat se reînnoiește, nu se folosește pe muchie', () => {
    rememberUrls([{ path: 'p/i/a', url: 'https://x/a' }], 0, 100)
    // 100s TTL, marja de siguranță e 60s → la t=50s mai rămân 50s, deci miss.
    const r = cachedUrls(['p/i/a'], 50_000)
    expect(r.hits).toEqual({})
    expect(r.misses).toEqual(['p/i/a'])
  })

  it('separă ce e în cache de ce lipsește, într-un singur apel', () => {
    rememberUrls([{ path: 'a', url: 'https://x/a' }], 0)
    const r = cachedUrls(['a', 'b'], 1000)
    expect(Object.keys(r.hits)).toEqual(['a'])
    expect(r.misses).toEqual(['b'])
  })

  it('resetUrlCache golește tot', () => {
    rememberUrls([{ path: 'a', url: 'https://x/a' }], 0)
    resetUrlCache()
    expect(cachedUrls(['a'], 1000).misses).toEqual(['a'])
  })
})

describe('listAttachments', () => {
  it('mapează coloanele în modelul aplicației', async () => {
    fake.tables.attachments.push({
      id: 'a1', issue_id: 'TUR-01', project_id: 'tur', path: 'tur/TUR-01/a1',
      filename: 'ecran.png', size: 1234, content_type: 'image/png',
      created_at: '2026-08-12T10:00:00Z',
    })
    const list = await listAttachments('TUR-01')
    expect(list).toEqual([{
      id: 'a1', issueId: 'TUR-01', projectId: 'tur', path: 'tur/TUR-01/a1',
      filename: 'ecran.png', size: 1234, contentType: 'image/png',
      createdAt: '2026-08-12T10:00:00Z',
    }])
  })

  it('un tichet fără fișiere dă listă goală', async () => {
    expect(await listAttachments('TUR-09')).toEqual([])
  })
})

describe('uploadAttachment', () => {
  const file = () => new File([new Uint8Array([1, 2, 3])], 'ecran.png', { type: 'image/png' })

  it('urcă octeții și scrie rândul', async () => {
    const a = await uploadAttachment({ issueId: 'TUR-01', projectId: 'tur', file: file(), filename: 'ecran.png' })
    expect(a.path).toBe(`tur/TUR-01/${a.id}`)
    expect(fake.storage.objects.has(a.path)).toBe(true)
    expect(fake.tables.attachments).toHaveLength(1)
    expect(fake.tables.attachments[0]).toMatchObject({
      issue_id: 'TUR-01', project_id: 'tur', filename: 'ecran.png', content_type: 'image/png', size: 3,
    })
  })

  it('urcă cu cache imuabil — obiectele nu se rescriu niciodată', async () => {
    await uploadAttachment({ issueId: 'TUR-01', projectId: 'tur', file: file(), filename: 'ecran.png' })
    expect(fake.storage.uploads[0].options).toMatchObject({ cacheControl: '31536000', upsert: false, contentType: 'image/png' })
  })

  it('dacă rândul nu se poate scrie, octeții urcați se retrag', async () => {
    fake.flags.failInsert = true
    await expect(
      uploadAttachment({ issueId: 'TUR-01', projectId: 'tur', file: file(), filename: 'ecran.png' }),
    ).rejects.toThrow()
    // Octeții nu au voie să rămână orfani: dacă rândul a picat, s-a chemat remove.
    expect(fake.storage.removed.flat()).toHaveLength(1)
    expect(fake.tables.attachments).toEqual([])
  })
})

describe('deleteAttachment', () => {
  it('șterge rândul întâi, apoi octeții', async () => {
    const a = await uploadAttachment({
      issueId: 'TUR-01', projectId: 'tur',
      file: new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }), filename: 'x.png',
    })
    await deleteAttachment(a)
    expect(fake.tables.attachments).toEqual([])
    expect(fake.storage.objects.has(a.path)).toBe(false)
  })
})

describe('removeObjects', () => {
  it('nu aruncă niciodată, nici când Storage întoarce eroare', async () => {
    fake.storage.failRemove = true
    await expect(removeObjects(['a', 'b'])).resolves.toBeUndefined()
  })

  it('lista goală nu lovește deloc rețeaua', async () => {
    await removeObjects([])
    expect(fake.storage.removed).toEqual([])
  })

  it('împarte în tranșe — clientul JS nu împarte singur, iar corpul are plafon', async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `p/i/${i}`)
    await removeObjects(paths)
    expect(fake.storage.removed.map((t) => t.length)).toEqual([100, 100, 50])
  })
})

describe('signedUrls', () => {
  it('cere într-un singur apel și memorează rezultatul', async () => {
    const first = await signedUrls(['tur/TUR-01/a1'])
    expect(first['tur/TUR-01/a1']).toContain('token=abc')
    // Al doilea apel vine din cache: URL identic, deci aceeași cheie de cache HTTP.
    const second = await signedUrls(['tur/TUR-01/a1'])
    expect(second).toEqual(first)
  })

  it('lista goală nu lovește rețeaua', async () => {
    expect(await signedUrls([])).toEqual({})
  })
})

describe('pathsForIssues / pathsForProject', () => {
  beforeEach(() => {
    fake.tables.attachments.push(
      { id: 'a1', issue_id: 'TUR-01', project_id: 'tur', path: 'tur/TUR-01/a1', filename: 'x', size: 1, content_type: 'image/png', created_at: 'z' },
      { id: 'a2', issue_id: 'TUR-02', project_id: 'tur', path: 'tur/TUR-02/a2', filename: 'y', size: 1, content_type: 'image/png', created_at: 'z' },
      { id: 'a3', issue_id: 'OTH-01', project_id: 'oth', path: 'oth/OTH-01/a3', filename: 'z', size: 1, content_type: 'image/png', created_at: 'z' },
    )
  })

  it('strânge căile mai multor tichete într-o singură interogare', async () => {
    expect((await pathsForIssues(['TUR-01', 'TUR-02'])).sort()).toEqual(['tur/TUR-01/a1', 'tur/TUR-02/a2'])
  })

  it('lista goală de tichete nu lovește rețeaua', async () => {
    expect(await pathsForIssues([])).toEqual([])
  })

  it('proiectul se rezolvă din project_id, nu prin plimbare în Storage', async () => {
    expect((await pathsForProject('tur')).sort()).toEqual(['tur/TUR-01/a1', 'tur/TUR-02/a2'])
  })
})
```

- [ ] **Step 2: Rulează testul ca să-l vezi picând**

Run: `npx vitest run src/data/attachments.test.ts`
Expected: FAIL — `Failed to resolve import "./attachments"`.

- [ ] **Step 3: Scrie implementarea minimă**

Creează `src/data/attachments.ts`:

```ts
// Attachment-uri: metadatele în tabelul `attachments`, octeții în bucketul
// privat cu același nume. Browserul vorbește direct cu Supabase — nu există
// server pe traseu — deci RLS-ul e singura gardă, iar el e în
// supabase/migration-attachments.sql.
//
// Modulul ăsta NU intră în interfața `Repository`: aceea are și o implementare
// locală (localRepository), iar attachment-urile n-au sens în modul local seeded.

import { requireSupabase } from '../lib/supabase'

export interface Attachment {
  id: string
  issueId: string
  projectId: string
  /** Calea obiectului din Storage. Unică. */
  path: string
  /** Numele de afișat și de descărcat. */
  filename: string
  size: number
  contentType: string
  createdAt: string
}

export const BUCKET = 'attachments'

/**
 * 8 ore, nu o oră. Tokenul stă în query string, deci un URL nou e altă cheie de
 * cache HTTP — o expirare scurtă nu aduce securitate (obiectul e accesibil
 * oricum atâta timp), doar garantează ratări de cache la fiecare deschidere.
 */
export const SIGNED_TTL_SECONDS = 8 * 60 * 60

/** Cât timp înainte de expirare considerăm un URL memorat drept inutilizabil. */
const CACHE_SAFETY_MS = 60_000

/** Storage nu împarte singur, iar corpul cererii are plafon practic. */
const REMOVE_CHUNK = 100

interface AttachmentRow {
  id: string
  issue_id: string
  project_id: string
  path: string
  filename: string
  size: number
  content_type: string
  created_at: string
}

function rowToAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    issueId: r.issue_id,
    projectId: r.project_id,
    path: r.path,
    filename: r.filename,
    size: r.size,
    contentType: r.content_type,
    createdAt: r.created_at,
  }
}

/**
 * `projectId` e primul segment **intenționat**: politica RLS de pe
 * `storage.objects` compară `(storage.foldername(name))[1]` cu
 * `project_members`. Fără extensie — `content_type` real trăiește în DB.
 */
export function buildAttachmentPath(projectId: string, issueId: string, attachmentId: string): string {
  return `${projectId}/${issueId}/${attachmentId}`
}

/**
 * Ce se randează inline. Stocăm orice, dar afișăm doar tipurile din lista albă:
 * un `.svg` sau `.html` randat pe originea Supabase ar rula pe acel domeniu.
 */
const RENDERABLE = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export function isRenderableImage(contentType: string): boolean {
  return RENDERABLE.has(contentType.toLowerCase())
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface CacheEntry {
  url: string
  expiresAt: number
}

const urlCache = new Map<string, CacheEntry>()

/**
 * Ce e deja memorat și ce trebuie cerut. Separat de rețea ca să fie testabil, și
 * ținut deloc degeaba: fără memorare, fiecare deschidere de tichet produce
 * URL-uri noi, deci chei de cache HTTP noi, deci redescarcă fiecare miniatură.
 */
export function cachedUrls(
  paths: readonly string[],
  now: number,
): { hits: Record<string, string>; misses: string[] } {
  const hits: Record<string, string> = {}
  const misses: string[] = []
  for (const path of paths) {
    const entry = urlCache.get(path)
    if (entry && entry.expiresAt - now > CACHE_SAFETY_MS) hits[path] = entry.url
    else misses.push(path)
  }
  return { hits, misses }
}

export function rememberUrls(
  entries: { path: string; url: string }[],
  now: number,
  ttlSeconds: number = SIGNED_TTL_SECONDS,
): void {
  for (const { path, url } of entries) {
    urlCache.set(path, { url, expiresAt: now + ttlSeconds * 1000 })
  }
}

export function resetUrlCache(): void {
  urlCache.clear()
}

export async function listAttachments(issueId: string): Promise<Attachment[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('attachments')
    .select('*')
    .eq('issue_id', issueId)
    .order('created_at')
  if (error) throw error
  return ((data ?? []) as AttachmentRow[]).map(rowToAttachment)
}

/**
 * Urcă octeții, apoi scrie rândul. Dacă rândul nu se poate scrie (RLS, rețea),
 * octeții urcați se retrag — altfel rămâne un obiect pe care nimic din
 * aplicație nu-l mai arată și nimic nu-l mai șterge.
 */
export async function uploadAttachment(input: {
  issueId: string
  projectId: string
  file: File
  filename: string
}): Promise<Attachment> {
  const db = requireSupabase()
  const id = crypto.randomUUID()
  const path = buildAttachmentPath(input.projectId, input.issueId, id)
  const contentType = input.file.type || 'application/octet-stream'

  const { error: upErr } = await db.storage.from(BUCKET).upload(path, input.file, {
    contentType,
    // Obiectele sunt imuabile: `id` e uuid nou la fiecare upload și nu folosim
    // niciodată upsert. Deci un cache de un an e onest, nu optimist.
    cacheControl: '31536000',
    upsert: false,
  })
  if (upErr) throw new Error(`Fișierul nu s-a putut urca: ${upErr.message}`)

  const { data, error } = await db
    .from('attachments')
    .insert({
      id,
      issue_id: input.issueId,
      project_id: input.projectId,
      path,
      filename: input.filename,
      size: input.file.size,
      content_type: contentType,
    })
    .select('*')
    .single()

  if (error || !data) {
    await removeObjects([path])
    throw new Error(`Fișierul nu s-a putut salva: ${error?.message ?? 'rând lipsă'}`)
  }
  return rowToAttachment(data as AttachmentRow)
}

/** Rândul întâi, octeții după. Vezi comentariul din `removeObjects`. */
export async function deleteAttachment(a: Attachment): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('attachments').delete().eq('id', a.id)
  if (error) throw error
  await removeObjects([a.path])
}

/**
 * Șterge octeții. **Nu aruncă niciodată.**
 *
 * Se cheamă mereu după ce rândurile au fost șterse, iar ordinea e intenționată:
 * dacă pică pasul ăsta rămân fișiere orfane — invizibile, costă doar spațiu, iar
 * `scripts/storage-report.mjs` le găsește. Invers, rânduri care arată către
 * obiecte inexistente dau URL-uri semnate care întorc 404 și miniaturi rupte,
 * adică stricăciune vizibilă. Se preferă eșecul invizibil.
 *
 * Iar dacă ar arunca, apelantul (`deleteIssue`) ar raporta eșec pentru o
 * operație care a reușit, și reîncercarea ar eșua altfel — tichetul nu mai există.
 */
export async function removeObjects(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  const db = requireSupabase()
  for (const batch of chunk(paths, REMOVE_CHUNK)) {
    try {
      const { error } = await db.storage.from(BUCKET).remove(batch as string[])
      if (error) console.warn('Fișiere rămase în stocare:', error.message, batch)
    } catch (e) {
      console.warn('Fișiere rămase în stocare:', e, batch)
    }
  }
}

/** URL-uri de afișare, cerute într-un singur apel și memorate. */
export async function signedUrls(paths: readonly string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const now = Date.now()
  const { hits, misses } = cachedUrls(paths, now)
  if (misses.length === 0) return hits

  const db = requireSupabase()
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(misses, SIGNED_TTL_SECONDS)
  if (error) throw error

  const fresh: { path: string; url: string }[] = []
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) fresh.push({ path: row.path, url: row.signedUrl })
  }
  rememberUrls(fresh, now)
  const out = { ...hits }
  for (const { path, url } of fresh) out[path] = url
  return out
}

/**
 * URL de DESCĂRCARE, generat la cerere pentru un singur fișier. Opțiunea
 * `download` pune `Content-Disposition: attachment`, deci browserul descarcă în
 * loc să încerce să randeze — obligatoriu pentru orice non-imagine, altfel un
 * `.svg` sau `.html` stocat s-ar executa pe originea Supabase.
 */
export async function signedDownloadUrl(a: Attachment): Promise<string | null> {
  const db = requireSupabase()
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(a.path, SIGNED_TTL_SECONDS, { download: a.filename })
  if (error) return null
  return data?.signedUrl ?? null
}

/** Căile fișierelor mai multor tichete, ÎNAINTE de ștergerea rândurilor. */
export async function pathsForIssues(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const db = requireSupabase()
  const { data, error } = await db.from('attachments').select('path').in('issue_id', ids as string[])
  if (error) throw error
  return ((data ?? []) as { path: string }[]).map((r) => r.path)
}

/**
 * Căile unui proiect întreg. Merge pe `project_id` denormalizat, nu prin
 * `storage.list()`: politica RLS nu e indexabilă pe scanări de prefix, iar
 * Storage n-are ștergere recursivă și paginează la 100.
 */
export async function pathsForProject(projectId: string): Promise<string[]> {
  const db = requireSupabase()
  const { data, error } = await db.from('attachments').select('path').eq('project_id', projectId)
  if (error) throw error
  return ((data ?? []) as { path: string }[]).map((r) => r.path)
}
```

- [ ] **Step 4: Rulează testele**

Run: `npx vitest run src/data/attachments.test.ts`
Expected: PASS, 25 de teste.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: cod 0.

- [ ] **Step 6: Commit**

```bash
git add src/data/attachments.ts src/data/attachments.test.ts
git commit -m "feat(attachments): Supabase storage layer with signed-url memoization"
```

---

## Task 6: `deleteIssues` și cascada care curăță octeții

**Files:**
- Modify: `src/data/repository.ts` (interfața)
- Modify: `src/data/supabaseRepository.ts:119-122` (`deleteProject`), `:304-307` (`deleteIssue`)
- Modify: `src/data/localRepository.ts:209-215`
- Modify: `src/store.tsx:73` (tipul contextului), `:339-346` (implementarea)
- Modify: `src/hooks.ts:86`, `:166-169`
- Test: `src/data/supabaseRepository.test.ts` (adaugă teste), `src/data/localRepository.test.ts` (adaugă un test)

**Interfaces:**
- Consumes: `removeObjects`, `pathsForIssues`, `pathsForProject` din Task 5.
- Produces: `Repository.deleteIssues(ids: string[]): Promise<void>` și `HorizontalState.deleteIssues(ids: string[]): Promise<void>`.

- [ ] **Step 1: Extinde fake-ul din testul de repository cu Storage**

În `src/data/supabaseRepository.test.ts`, în blocul `vi.hoisted`, adaugă `attachments` la tabele și un storage minimal. Înlocuiește clasa `FakeDB` (liniile 80-88) cu:

```ts
  class FakeStorage {
    removed: string[][] = []
    from(_bucket: string) {
      return {
        remove: async (paths: string[]) => {
          this.removed.push(paths)
          return { data: null, error: null }
        },
      }
    }
    reset() { this.removed = [] }
  }
  class FakeDB {
    tables: Record<string, Row[]> = { projects: [], waves: [], themes: [], issues: [], dependencies: [], attachments: [] }
    storage = new FakeStorage()
    from(table: string) {
      return new Query(this.tables, table)
    }
    reset() {
      this.tables = { projects: [], waves: [], themes: [], issues: [], dependencies: [], attachments: [] }
      this.storage.reset()
    }
  }
```

`Query` are deja `.in()`, deci nu trebuie schimbat.

- [ ] **Step 2: Scrie testele care picată**

La finalul `describe('supabaseRepository', ...)` din `src/data/supabaseRepository.test.ts`, adaugă:

```ts
  it('deleteIssue șterge rândul ȘI octeții fișierelor lui', async () => {
    fake_seed()
    const repo = createSupabaseRepository()
    await repo.deleteIssue('P-01')

    expect(fakeDb.tables.issues.some((i) => i.id === 'P-01')).toBe(false)
    expect(fakeDb.storage.removed.flat()).toEqual(['p/P-01/a1'])
  })

  it('deleteIssues citește căile ÎNAINTE de ștergere — cascada le-ar duce cu ea', async () => {
    fake_seed()
    const repo = createSupabaseRepository()
    await repo.deleteIssues(['P-01', 'P-02'])

    expect(fakeDb.tables.issues).toEqual([])
    expect(fakeDb.storage.removed.flat().sort()).toEqual(['p/P-01/a1', 'p/P-02/a2'])
  })

  it('deleteIssues cu listă goală nu atinge nimic', async () => {
    fake_seed()
    const repo = createSupabaseRepository()
    await repo.deleteIssues([])

    expect(fakeDb.tables.issues).toHaveLength(2)
    expect(fakeDb.storage.removed).toEqual([])
  })

  it('deleteProject curăță octeții întregului proiect, din project_id', async () => {
    fake_seed()
    const repo = createSupabaseRepository()
    await repo.deleteProject('p')

    expect(fakeDb.tables.projects).toEqual([])
    expect(fakeDb.storage.removed.flat().sort()).toEqual(['p/P-01/a1', 'p/P-02/a2'])
  })

  it('un eșec la ștergerea octeților NU face ștergerea tichetului să pară eșuată', async () => {
    fake_seed()
    const boom = { from: () => ({ remove: async () => ({ data: null, error: { message: 'reteaua a picat' } }) }) }
    const original = fakeDb.storage
    // @ts-expect-error -- înlocuire intenționată în test
    fakeDb.storage = boom
    const repo = createSupabaseRepository()
    await expect(repo.deleteIssue('P-01')).resolves.toBeUndefined()
    fakeDb.storage = original
    expect(fakeDb.tables.issues.some((i) => i.id === 'P-01')).toBe(false)
  })
```

Și, deasupra blocului `describe`, helperul de semințe:

```ts
function fake_seed() {
  fakeDb.tables.projects.push({ id: 'p', prefix: 'P', current_wave: 1, name: 'x', description: '', accent: '#fff' })
  fakeDb.tables.issues.push(
    { id: 'P-01', project_id: 'p', title: 'A', details: '', wave: 1, done: false },
    { id: 'P-02', project_id: 'p', title: 'B', details: '', wave: 1, done: false },
  )
  fakeDb.tables.attachments.push(
    { id: 'a1', issue_id: 'P-01', project_id: 'p', path: 'p/P-01/a1', filename: 'x', size: 1, content_type: 'image/png', created_at: 'z' },
    { id: 'a2', issue_id: 'P-02', project_id: 'p', path: 'p/P-02/a2', filename: 'y', size: 1, content_type: 'image/png', created_at: 'z' },
  )
}
```

În `src/data/localRepository.test.ts`, adaugă:

```ts
  it('deleteIssues șterge toate tichetele date și curăță dependențele către ele', async () => {
    const repo = createLocalRepository()
    const a = await repo.createIssue({ projectId: 'tst', title: 'A' })
    const b = await repo.createIssue({ projectId: 'tst', title: 'B' })
    const c = await repo.createIssue({ projectId: 'tst', title: 'C', deps: [a.id, b.id] })

    await repo.deleteIssues([a.id, b.id])

    const left = await repo.listIssues('tst')
    expect(left.map((i) => i.id)).not.toContain(a.id)
    expect(left.map((i) => i.id)).not.toContain(b.id)
    expect(left.find((i) => i.id === c.id)!.deps).toEqual([])
  })
```

(`'tst'` e id-ul proiectului din semințele fișierului — vezi `src/data/localRepository.test.ts:38`.)

- [ ] **Step 3: Rulează testele ca să le vezi picând**

Run: `npx vitest run src/data/supabaseRepository.test.ts src/data/localRepository.test.ts`
Expected: FAIL — `repo.deleteIssues is not a function`.

- [ ] **Step 4: Adaugă metoda în interfață**

În `src/data/repository.ts`, înlocuiește:

```ts
  /** Deletes the issue and any dependency edges referencing it. */
  deleteIssue(id: string): Promise<void>
```

cu:

```ts
  /** Deletes the issue and any dependency edges referencing it. */
  deleteIssue(id: string): Promise<void>
  /**
   * Bulk delete. On the Supabase backend this is three round trips total, not
   * three per issue — and unlike `Promise.all(ids.map(deleteIssue))` it cannot
   * half-succeed and leave the caller with a partial delete plus an error.
   */
  deleteIssues(ids: string[]): Promise<void>
```

- [ ] **Step 5: Implementează în supabaseRepository**

În `src/data/supabaseRepository.ts`, adaugă importul lângă celelalte:

```ts
import { pathsForIssues, pathsForProject, removeObjects } from './attachments'
```

Deasupra lui `return {` (după `loadDeps`), adaugă funcția partajată — o funcție locală, nu `this`, ca ambele metode să poată chema aceeași logică fără să depindă de cum e apelat obiectul:

```ts
  /**
   * Ordinea contează: căile se citesc ÎNAINTE (cascada FK le-ar duce cu ea),
   * rândurile se șterg apoi, iar octeții la final și best-effort. Cheia externă
   * șterge rândurile din `attachments`, niciodată octeții.
   */
  async function deleteIssuesImpl(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const paths = await pathsForIssues(ids)
    const { error } = await db.from('issues').delete().in('id', ids)
    if (error) throw error
    await removeObjects(paths)
  }
```

Înlocuiește `deleteProject` (liniile 119-122):

```ts
    async deleteProject(id) {
      // Ștergerea proiectului cascadează prin FK până la attachments, deci
      // căile trebuie citite acum. `project_id` denormalizat face asta o
      // singură interogare indexată, nu o plimbare paginată prin Storage.
      const paths = await pathsForProject(id)
      const { error } = await db.from('projects').delete().eq('id', id)
      if (error) throw error
      await removeObjects(paths)
    },
```

Înlocuiește `deleteIssue` (liniile 304-307):

```ts
    async deleteIssue(id: string) {
      await deleteIssuesImpl([id])
    },

    async deleteIssues(ids: string[]) {
      await deleteIssuesImpl(ids)
    },
```

- [ ] **Step 6: Implementează în localRepository**

În `src/data/localRepository.ts`, înlocuiește `deleteIssue` (liniile 209-215):

```ts
    async deleteIssue(id: string) {
      const db = load()
      db.issues = db.issues
        .filter((i) => i.id !== id)
        .map((i) => (i.deps?.includes(id) ? { ...i, deps: i.deps.filter((d) => d !== id) } : i))
      save(db)
    },

    // Fără attachment-uri: n-au sens în modul local seeded, iar `Attachments`
    // nu se randează acolo.
    async deleteIssues(ids: string[]) {
      if (ids.length === 0) return
      const gone = new Set(ids)
      const db = load()
      db.issues = db.issues
        .filter((i) => !gone.has(i.id))
        .map((i) => (i.deps?.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i))
      save(db)
    },
```

- [ ] **Step 7: Expune în store**

În `src/store.tsx`, după linia 73 (`deleteIssue(id: string): Promise<void>`), adaugă în tip:

```ts
  deleteIssues(ids: string[]): Promise<void>
```

După implementarea `deleteIssue` (linia 346), adaugă:

```ts
  const deleteIssues = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await repository.deleteIssues(ids)
    const gone = new Set(ids)
    setAllIssues((prev) =>
      prev
        .filter((i) => !gone.has(i.id))
        .map((i) => (i.deps?.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i)),
    )
  }, [])
```

Și adaugă `deleteIssues,` în obiectul returnat, imediat după `deleteIssue,` (linia 401).

- [ ] **Step 8: Folosește-o la ștergerea în masă**

În `src/hooks.ts`, linia 86, adaugă `deleteIssues` la destructurare:

```ts
  const { activeWave, deleteIssue, deleteIssues, updateIssue, byId } = useHorizontal()
```

Înlocuiește `handleBulkDelete` (liniile 166-169):

```ts
  const handleBulkDelete = useCallback(async () => {
    // Un singur apel, nu `Promise.all(map(deleteIssue))`: acela lansa 3N cereri
    // concurente și, la primul eșec, lăsa restul în zbor fără rollback —
    // ștergere parțială plus toast de eroare.
    await deleteIssues([...selectedIds])
    exitSelectMode()
  }, [selectedIds, deleteIssues, exitSelectMode])
```

`deleteIssue` rămâne în destructurare doar dacă mai e folosit în fișier; dacă `npm run typecheck` reclamă că nu e folosit, scoate-l.

- [ ] **Step 9: Rulează testele**

Run: `npm test`
Expected: PASS, inclusiv cele șase teste noi.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: cod 0.

- [ ] **Step 11: Commit**

```bash
git add src/data/repository.ts src/data/supabaseRepository.ts src/data/localRepository.ts src/data/supabaseRepository.test.ts src/data/localRepository.test.ts src/store.tsx src/hooks.ts
git commit -m "feat(attachments): cascade delete removes stored bytes, add deleteIssues"
```

---

## Task 7: Componenta `Attachments`

**Files:**
- Create: `src/components/Attachments.tsx`
- Modify: `src/styles.css` (adaugă la final)

**Interfaces:**
- Consumes: `shrinkImage`, `attachmentFilename` (Task 2/3); `pickFiles`, `carriesFiles`, `rejectMessage` (Task 4); `listAttachments`, `uploadAttachment`, `deleteAttachment`, `signedUrls`, `signedDownloadUrl`, `isRenderableImage`, `Attachment` (Task 5); `Lightbox` (Task 8).
- **Fă Task 8 înaintea acestuia.** Componenta importă `Lightbox`, deci typecheck-ul nu trece până există. Task 8 e mic și nu depinde de nimic din Task 7.
- Produces: `function Attachments(props: { issueId?: string; projectId: string; readOnly?: boolean }): JSX.Element | null`

- [ ] **Step 1: Scrie componenta**

Creează `src/components/Attachments.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteAttachment,
  isRenderableImage,
  listAttachments,
  signedDownloadUrl,
  signedUrls,
  uploadAttachment,
  type Attachment,
} from '../data/attachments'
import { carriesFiles, pickFiles, rejectMessage } from '../lib/pickFiles'
import { attachmentFilename, shrinkImage } from '../lib/shrinkImage'
import { Lightbox } from './Lightbox'

/** Doar în modul Supabase: attachment-urile n-au sens în modul local seeded. */
const ENABLED = import.meta.env.VITE_DATA_SOURCE === 'supabase'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Iconiță după tip. Nu încercăm să fim exhaustivi — doar să nu arate toate la fel. */
function iconFor(contentType: string, filename: string): string {
  if (contentType === 'application/pdf') return '📄'
  if (contentType.startsWith('image/')) return '🖼'
  if (contentType.startsWith('video/')) return '🎬'
  if (contentType.startsWith('audio/')) return '🎵'
  if (/\.(zip|rar|7z|tar|gz)$/i.test(filename)) return '🗜'
  if (/\.(json|ts|tsx|js|jsx|css|html|sql|sh|py|md)$/i.test(filename)) return '📝'
  return '📎'
}

export function Attachments({
  issueId,
  projectId,
  readOnly = false,
}: {
  issueId?: string
  projectId: string
  readOnly?: boolean
}) {
  const [items, setItems] = useState<Attachment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<Attachment | null>(null)
  /** Căile ale căror imagini n-au putut fi încărcate (tipic: offline). */
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const dragDepth = useRef(0)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canEdit = !readOnly && !!issueId

  const load = useCallback(async () => {
    if (!ENABLED || !issueId) return
    try {
      const list = await listAttachments(issueId)
      setItems(list)
      const images = list.filter((a) => isRenderableImage(a.contentType))
      if (images.length) setUrls(await signedUrls(images.map((a) => a.path)))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Fișierele nu s-au putut încărca.')
    }
  }, [issueId])

  useEffect(() => { void load() }, [load])

  /** Dezarmează X-ul după 3s, altfel un X rămas armat devine chiar capcana pe
   *  care confirmarea din două atingeri trebuia să o închidă. */
  const arm = useCallback((id: string) => {
    if (armTimer.current) clearTimeout(armTimer.current)
    setArmed(id)
    armTimer.current = setTimeout(() => setArmed(null), 3000)
  }, [])

  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current) }, [])

  const addFiles = useCallback(
    async (types: readonly string[], files: readonly File[]) => {
      if (!issueId) return
      const picked = pickFiles({ types, files })
      setMessage(rejectMessage(picked.rejected))
      if (picked.accept.length === 0) return

      setBusy((n) => n + picked.accept.length)
      for (const [index, original] of picked.accept.entries()) {
        try {
          const small = await shrinkImage(original)
          // Numele de bază e cel sintetizat dacă browserul a dat unul generic
          // (screenshot-urile lipite ajung toate `image.png`), altfel cel real.
          // Extensia urmează formatul CHIAR produs de micșorare.
          const base = picked.renamed[index] ?? original.name
          const changed = small !== original
          const filename = attachmentFilename(
            base,
            changed ? (small.type as 'image/jpeg' | 'image/webp') : null,
          )
          const saved = await uploadAttachment({ issueId, projectId, file: small, filename })
          setItems((prev) => [...prev, saved])
          if (isRenderableImage(saved.contentType)) {
            // Se așteaptă ÎNAINTE de setState: un `await` în funcția de
            // actualizare n-ar fi așteptat de React, iar `urls` ar primi o
            // promisiune în loc de un URL.
            const fresh = await signedUrls([saved.path])
            setUrls((prev) => ({ ...prev, ...fresh }))
          }
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Fișierul nu s-a putut urca.')
        } finally {
          setBusy((n) => n - 1)
        }
      }
    },
    [issueId, projectId],
  )

  // Paste. Se ascultă pe `document` fiindcă cursorul e aproape sigur în
  // descriere sau notițe, nu în zona de fișiere, deci un `onPaste` pe container
  // n-ar vedea niciodată evenimentul.
  //
  // Regula care închide ambiguitatea: dacă clipboardul poartă fișiere, e
  // attachment, ORIUNDE ar fi cursorul — un paste de imagine într-un textarea
  // n-ar face nimic oricum. Paste-ul de text rămâne complet neatins fiindcă
  // renunțăm imediat când nu există fișiere. Nicio euristică pe focus.
  //
  // Nu e nevoie de urmărirea sheet-ului din vârf: SheetHost randează exact un
  // copil, deci componenta e montată doar cât e vizibilă.
  useEffect(() => {
    if (!ENABLED || !canEdit) return
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData
      if (!dt) return
      const files = Array.from(dt.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      void addFiles(Array.from(dt.types ?? ['Files']), files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canEdit, addFiles])

  if (!ENABLED) return null

  const openItem = async (a: Attachment) => {
    if (isRenderableImage(a.contentType)) {
      setViewing(a)
      return
    }
    const url = await signedDownloadUrl(a)
    if (url) window.location.href = url
    else setMessage('Fișierul nu s-a putut descărca.')
  }

  const remove = async (a: Attachment) => {
    setArmed(null)
    try {
      await deleteAttachment(a)
      setItems((prev) => prev.filter((x) => x.id !== a.id))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Fișierul nu s-a putut șterge.')
    }
  }

  // Tichet nou: nu există id la care să lipim fișierul. Un rând de text, și am
  // scăpat de tot cazul greu — fără auto-save, fără tichete pe jumătate scrise.
  if (!issueId) {
    return (
      <div className="att-section">
        <div className="sheet-section-t">Fișiere</div>
        <p className="att-empty">Salvează tichetul, apoi atașează fișiere.</p>
      </div>
    )
  }

  if (readOnly && items.length === 0) return null

  return (
    <div
      className={`att-section ${dragging ? 'dragover' : ''}`}
      onDragEnter={canEdit ? (e) => {
        if (!carriesFiles(Array.from(e.dataTransfer.types))) return
        dragDepth.current += 1
        setDragging(true)
      } : undefined}
      onDragOver={canEdit ? (e) => {
        // Obligatoriu: fără preventDefault pe dragover, drop-ul nu e permis
        // deloc și browserul navighează la fișier.
        if (carriesFiles(Array.from(e.dataTransfer.types))) e.preventDefault()
      } : undefined}
      onDragLeave={canEdit ? () => {
        // Contor, nu boolean: dragleave se declanșează și la trecerea în
        // elementele-copil, iar un boolean face evidențierea să pâlpâie.
        dragDepth.current -= 1
        if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) }
      } : undefined}
      onDrop={canEdit ? (e) => {
        if (!carriesFiles(Array.from(e.dataTransfer.types))) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void addFiles(Array.from(e.dataTransfer.types), Array.from(e.dataTransfer.files))
      } : undefined}
    >
      <div className="sheet-section-t">Fișiere</div>

      {items.length === 0 && !busy && (
        <p className="att-empty">
          {canEdit ? 'Lipește o poză (Ctrl+V) sau trage fișiere aici.' : 'Niciun fișier.'}
        </p>
      )}

      <div className="att-grid">
        {items.map((a) => {
          const isImg = isRenderableImage(a.contentType)
          const url = urls[a.path]
          return (
            <div key={a.id} className={`att-item ${isImg ? 'img' : 'file'}`}>
              <button className="att-open" onClick={() => void openItem(a)} title={a.filename}>
                {isImg && url && !broken.has(a.path) ? (
                  <img
                    src={url}
                    alt={a.filename}
                    loading="lazy"
                    // URL-urile semnate nu funcționează offline, iar shell-ul
                    // aplicației e precachat — fără asta, sheet-ul s-ar randa
                    // cu imagini moarte, care se citesc ca pierdere de date.
                    // Marcăm calea în state și lăsăm React să randeze locul
                    // gol; nu umblăm în DOM cu mâna.
                    onError={() => setBroken((prev) => new Set(prev).add(a.path))}
                  />
                ) : isImg ? (
                  <span className="att-offline">indisponibil offline</span>
                ) : (
                  <>
                    <span className="att-ic">{iconFor(a.contentType, a.filename)}</span>
                    <span className="att-name">{a.filename}</span>
                    <span className="att-size">{humanSize(a.size)}</span>
                  </>
                )}
              </button>
              {canEdit && (
                <button
                  className={`att-del ${armed === a.id ? 'armed' : ''}`}
                  aria-label={armed === a.id ? `Confirmă ștergerea ${a.filename}` : `Șterge ${a.filename}`}
                  onClick={() => (armed === a.id ? void remove(a) : arm(a.id))}
                >
                  {armed === a.id ? 'Șterg?' : '✕'}
                </button>
              )}
            </div>
          )
        })}
        {busy > 0 && <div className="att-item busy">Se urcă {busy}…</div>}
      </div>

      {message && (
        <div className="att-msg" role="status">
          {message}
          <button className="att-msg-x" onClick={() => setMessage(null)} aria-label="Închide mesajul">✕</button>
        </div>
      )}

      {viewing && <Lightbox attachment={viewing} url={urls[viewing.path]} onClose={() => setViewing(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Adaugă stilurile**

La finalul `src/styles.css`:

```css
/* ── Attachments ─────────────────────────────────────────────────────────── */
/* Variabilele sunt cele care EXISTĂ în :root-ul de la începutul fișierului —
   --accent, --surface-2, --line, --blocked, --txt-dim. Nu inventa altele. */
.att-section { margin-top: 14px; border-radius: 10px; transition: background 0.15s, outline-color 0.15s; outline: 2px dashed transparent; outline-offset: 4px; }
.att-section.dragover { outline-color: var(--accent); background: var(--accent-soft); }
.att-empty { color: var(--txt-dim); font-size: 13px; margin: 4px 0 0; }
.att-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.att-item { position: relative; border-radius: 8px; overflow: hidden; }
.att-item.img { width: 84px; height: 84px; }
.att-item.file { width: 100%; }
.att-item.busy { width: 100%; padding: 10px; font-size: 13px; color: var(--txt-dim); }
.att-open { display: block; width: 100%; height: 100%; padding: 0; border: 1px solid var(--line); background: var(--surface-2); color: var(--txt); cursor: pointer; text-align: left; }
.att-item.img .att-open { padding: 0; }
.att-item.img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.att-item.file .att-open { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 10px; }
.att-ic { font-size: 16px; }
.att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.att-size { font-size: 11px; color: var(--txt-dim); }
.att-offline { display: grid; place-items: center; width: 100%; height: 100%; font-size: 10px; color: var(--txt-dim); text-align: center; padding: 4px; }
.att-del { position: absolute; top: 3px; right: 3px; border: 0; border-radius: 6px; padding: 2px 6px; font-size: 11px; line-height: 1.6; cursor: pointer; background: color-mix(in srgb, var(--bg) 75%, transparent); color: var(--txt); }
.att-del.armed { background: var(--blocked); color: #fff; }
.att-msg { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--accent-soft); font-size: 13px; }
.att-msg-x { margin-left: auto; border: 0; background: none; cursor: pointer; color: inherit; }

/* ── Lightbox ────────────────────────────────────────────────────────────── */
.lb-back { position: fixed; inset: 0; z-index: 60; display: grid; grid-template-rows: auto 1fr; background: rgba(0, 0, 0, 0.92); }
.lb-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; color: #fff; font-size: 13px; }
.lb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-actions { margin-left: auto; display: flex; gap: 8px; }
.lb-bar button { border: 1px solid rgba(255, 255, 255, 0.35); background: transparent; color: #fff; border-radius: 8px; padding: 5px 10px; cursor: pointer; font-size: 13px; }
.lb-body { display: grid; place-items: center; overflow: auto; padding: 8px; }
.lb-body img { max-width: 100%; max-height: 100%; object-fit: contain; }
```

Paleta din `:root`-ul lui `styles.css` are exact aceste variabile: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--line`, `--line-soft`, `--txt`, `--txt-dim`, `--txt-faint`, `--accent`, `--accent-2`, `--accent-soft`, `--done`, `--blocked`, `--active`, plus variantele `-soft`. Nu adăuga variabile noi și nu folosi nume care nu sunt în lista asta.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: cod 0. (Dacă reclamă `Cannot find module './Lightbox'`, n-ai făcut Task 8 întâi — fă-l acum, e mic.)

- [ ] **Step 4: Commit**

```bash
git add src/components/Attachments.tsx src/styles.css
git commit -m "feat(attachments): file section with paste, drop and two-tap delete"
```

---

## Task 8: `Lightbox`

**Files:**
- Create: `src/components/Lightbox.tsx`

**Interfaces:**
- Consumes: `Attachment`, `signedDownloadUrl` din Task 5.
- Produces: `function Lightbox(props: { attachment: Attachment; url?: string; onClose: () => void }): JSX.Element`

- [ ] **Step 1: Scrie componenta**

Creează `src/components/Lightbox.tsx`:

```tsx
import { useEffect } from 'react'
import { signedDownloadUrl, type Attachment } from '../data/attachments'

/**
 * Imaginea pe tot ecranul, în aplicație. Nu într-un tab nou: Horizontal e PWA
 * instalabil, iar un tab nou aruncă utilizatorul în browser, cu un URL semnat
 * urât în bară și o revenire greoaie pe telefon.
 */
export function Lightbox({
  attachment,
  url,
  onClose,
}: {
  attachment: Attachment
  url?: string
  onClose: () => void
}) {
  // Escape trebuie să închidă DOAR lightbox-ul. `SheetHost` are propriul
  // listener de Escape pe `window`, în faza de bubble, care ar închide sheet-ul
  // de dedesubt. Ascultăm în faza de CAPTURE (care rulează prima) și oprim
  // propagarea, deci al lui nu se mai declanșează.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const download = async () => {
    const href = await signedDownloadUrl(attachment)
    if (href) window.location.href = href
  }

  return (
    <div className="lb-back" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-name">{attachment.filename}</span>
        <div className="lb-actions">
          <button onClick={() => void download()}>Descarcă</button>
          <button onClick={onClose} aria-label="Închide">✕</button>
        </div>
      </div>
      <div className="lb-body">
        {url ? (
          <img src={url} alt={attachment.filename} />
        ) : (
          <span style={{ color: '#fff', fontSize: 13 }}>Imaginea nu e disponibilă offline.</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: cod 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/Lightbox.tsx
git commit -m "feat(attachments): in-app lightbox with download"
```

---

## Task 9: Legarea în aplicație

**Files:**
- Modify: `src/components/IssueForm.tsx` (după blocul `notes-section`, liniile 900-905)
- Modify: `src/components/IssueSheet.tsx`
- Modify: `src/App.tsx`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `Attachments` din Task 7.
- Produces: nimic pentru task-urile următoare.

- [ ] **Step 1: Randează secțiunea în IssueForm**

În `src/components/IssueForm.tsx`, adaugă importul lângă celelalte importuri de componente:

```tsx
import { Attachments } from './Attachments'
```

Apoi, imediat după blocul `notes-section` care se închide la linia 905 și înainte de `</div>` de la linia 907, adaugă:

```tsx
            {/* FIȘIERE — sub notițe. La tichet nou (`existing` lipsă) componenta
                afișează doar îndemnul de a salva întâi. */}
            {project && <Attachments issueId={existing?.id} projectId={project.id} />}
```

Ambele sunt deja în scope: `project` vine din destructurarea de la linia 140, iar `existing` e definit la linia 143 ca `issueId ? byId[issueId] : undefined` — exact semnalul „tichet salvat sau nu" de care are nevoie componenta.

- [ ] **Step 2: Randează lista read-only în IssueSheet**

În `src/components/IssueSheet.tsx`, adaugă importul:

```tsx
import { Attachments } from './Attachments'
```

Și, imediat înainte de blocul care începe cu `{deps.length === 0 && permits.length === 0 &&` (linia 95), adaugă:

```tsx
        <Attachments issueId={issueId} projectId={it.projectId} readOnly />
```

- [ ] **Step 3: Fă drop-urile ratate inerte**

În `src/App.tsx`, în funcția `Shell`, adaugă un efect nou după cel de `keydown` (care se termină la linia 443):

```tsx
  // Un drop care aterizează în afara zonei de fișiere lovește comportamentul
  // implicit al browserului și scoate utilizatorul din SPA — deschide fișierul
  // ca pagină, pierzând starea nesalvată. O pereche inertă la nivel de document
  // face ratarea fără efect. Înregistrată o singură dată, aici, nu în fiecare
  // componentă care acceptă fișiere.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    document.addEventListener('dragover', swallow)
    document.addEventListener('drop', swallow)
    return () => {
      document.removeEventListener('dragover', swallow)
      document.removeEventListener('drop', swallow)
    }
  }, [])
```

- [ ] **Step 4: Ține URL-urile semnate departe de service worker**

În `vite.config.ts`, în `workbox.runtimeCaching`, adaugă ca **prim** element al listei (înaintea regulilor de fonturi):

```ts
          {
            // URL-urile semnate expiră, iar tokenul stă în query string. Azi
            // nimic nu le-ar prinde oricum (nicio regulă nu se potrivește pe
            // *.supabase.co), dar o viitoare regulă CacheFirst pe imagini ar
            // servi URL-uri expirate din cache. Regula asta e documentație în cod.
            urlPattern: /\/storage\/v1\/object\/sign\//,
            handler: 'NetworkOnly',
          },
```

- [ ] **Step 5: Typecheck și teste**

Run: `npm run typecheck && npm test`
Expected: ambele trec.

- [ ] **Step 6: Verifică în aplicația reală**

Run: `npm run dev`

Apoi, în browser:
1. Deschide un tichet **existent**. Expected: secțiunea „Fișiere" cu textul „Lipește o poză (Ctrl+V) sau trage fișiere aici."
2. Fă un screenshot (`Win+Shift+S`) și apasă Ctrl+V în sheet. Expected: apare o miniatură.
3. Apasă pe miniatură. Expected: lightbox pe tot ecranul. Escape îl închide **fără** să închidă tichetul.
4. Apasă X pe miniatură. Expected: devine „Șterg?". Apasă altundeva, apoi așteaptă 3s. Expected: revine la „✕".
5. Apasă X de două ori. Expected: miniatura dispare.
6. Trage un fișier non-imagine (un `.pdf` sau `.txt`) peste sheet. Expected: conturul punctat se aprinde, iar la drop apare un rând cu nume și mărime. Click pe el descarcă fișierul cu numele original.
7. Trage un fișier peste o zonă din afara sheet-ului. Expected: **nu se întâmplă nimic** — browserul nu navighează.
8. Deschide „+ Tichet" (tichet nou). Expected: „Salvează tichetul, apoi atașează fișiere.", iar Ctrl+V nu face nimic.
9. Scrie text în descriere și apasă Ctrl+V cu text în clipboard. Expected: textul se lipește normal în textarea.
10. Deschide un tichet cu dependențe, apasă o dependență care are fișiere. Expected: miniaturile se văd, **fără** X și fără drop-zone.
11. Șterge un tichet care are fișiere. Apoi, în Supabase → Storage → `attachments`, verifică că obiectele au dispărut.

- [ ] **Step 7: Commit**

```bash
git add src/components/IssueForm.tsx src/components/IssueSheet.tsx src/App.tsx vite.config.ts
git commit -m "feat(attachments): wire the section into the ticket form and sheet"
```

---

## Task 10: `scripts/storage-report.mjs`

**Files:**
- Create: `scripts/storage-report.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: tabelul și bucketul din Task 1.
- Produces: nimic în cod.

- [ ] **Step 1: Scrie scriptul**

Creează `scripts/storage-report.mjs`:

```js
// Cât spațiu ocupă fiecare proiect, și ce obiecte n-au rând în tabel.
//
// Orfanii apar când ștergerea rândurilor a reușit dar ștergerea octeților nu
// (eșec de rețea în fereastra dintre cele două) — vezi `removeObjects` din
// src/data/attachments.ts. Sunt invizibili în interfață, deci scriptul ăsta e
// singurul mod de a-i găsi.
//
// Rulează: npm run storage:report
// Curăță:  npm run storage:report -- --clean
//
// Service-role, fiindcă enumerarea bucketului trece peste RLS. `storage.list()`
// NU se apelează niciodată din aplicație (politica nu e indexabilă pe scanări de
// prefix); aici e în regulă, e o unealtă de administrare rulată manual.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const BUCKET = 'attachments'
const PAGE = 100
const clean = process.argv.includes('--clean')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

/** Enumeră recursiv: storage.list() nu e recursiv și paginează la 100. */
async function walk(prefix = '') {
  const found = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list('${prefix}') a eșuat: ${error.message}`)
    if (!data || data.length === 0) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      // Un „folder" în Storage e o intrare fără metadate.
      if (entry.id === null || !entry.metadata) found.push(...(await walk(path)))
      else found.push({ path, size: entry.metadata.size ?? 0 })
    }
    if (data.length < PAGE) break
  }
  return found
}

const objects = await walk()

const { data: rows, error } = await supabase.from('attachments').select('path, project_id, size, filename')
if (error) {
  console.error('Nu s-a putut citi tabelul attachments:', error.message)
  process.exit(1)
}

const byPath = new Map(rows.map((r) => [r.path, r]))
const orphans = objects.filter((o) => !byPath.has(o.path))
const missing = rows.filter((r) => !objects.some((o) => o.path === r.path))

const perProject = new Map()
for (const o of objects) {
  const project = o.path.split('/')[0]
  perProject.set(project, (perProject.get(project) ?? 0) + o.size)
}

const mb = (b) => (b / 1024 / 1024).toFixed(2)
const total = objects.reduce((s, o) => s + o.size, 0)

console.log(`\nBucket \`${BUCKET}\`: ${objects.length} obiecte, ${mb(total)} MB\n`)
console.log('proiect              obiecte     marime')
for (const [project, bytes] of [...perProject].sort((a, b) => b[1] - a[1])) {
  const count = objects.filter((o) => o.path.startsWith(`${project}/`)).length
  console.log(`${project.padEnd(20)} ${String(count).padStart(7)}  ${mb(bytes).padStart(9)} MB`)
}

console.log(`\nOrfani (octeti fara rand in tabel): ${orphans.length}, ${mb(orphans.reduce((s, o) => s + o.size, 0))} MB`)
for (const o of orphans.slice(0, 20)) console.log(`  ${o.path}  ${mb(o.size)} MB`)
if (orphans.length > 20) console.log(`  … si inca ${orphans.length - 20}`)

console.log(`\nRanduri fara octeti (miniaturi rupte): ${missing.length}`)
for (const r of missing.slice(0, 20)) console.log(`  ${r.path}  ${r.filename}`)
if (missing.length > 20) console.log(`  … si inca ${missing.length - 20}`)

if (!clean) {
  if (orphans.length) console.log('\nRuleaza cu --clean ca sa stergi orfanii.')
  process.exit(0)
}

if (orphans.length === 0) {
  console.log('\nNimic de curatat.')
  process.exit(0)
}

// Doar orfanii. Rândurile fără octeți NU se ating: acolo lipsesc datele, iar
// ștergerea rândului ar ascunde problema în loc să o rezolve.
for (let i = 0; i < orphans.length; i += PAGE) {
  const batch = orphans.slice(i, i + PAGE).map((o) => o.path)
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch)
  if (rmErr) {
    console.error('Stergerea a esuat:', rmErr.message)
    process.exit(1)
  }
  console.log(`Sters: ${batch.length} obiecte`)
}
console.log(`\n${orphans.length} orfani stersi.`)
```

- [ ] **Step 2: Adaugă scriptul în package.json**

La `scripts`, după `"test:shrink"`:

```json
    "storage:report": "node scripts/storage-report.mjs",
```

- [ ] **Step 3: Rulează raportul**

Run: `npm run storage:report`
Expected: un tabel cu proiecte și mărimi, apoi `Orfani ...: 0` și `Randuri fara octeti ...: 0` dacă totul e curat. Dacă ai șters un tichet la pasul 11 din Task 9 și rețeaua a fost bună, tot ar trebui să fie 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/storage-report.mjs package.json
git commit -m "feat(attachments): storage report script with orphan cleanup"
```

---

## Task 11: Calibrarea finală și înghețarea constantelor

**Files:**
- Modify: `src/lib/shrinkImage.ts` (`SHRINK_DEFAULTS` și comentariul de calibrare)
- Modify: `src/lib/shrinkImage.test.ts` (dacă praguri noi schimbă vreo așteptare)
- Modify: `docs/superpowers/specs/2026-08-12-attachments-design.md` (rezultatele)

**Interfaces:**
- Consumes: harness-ul din Task 3.
- Produces: valorile finale din `SHRINK_DEFAULTS`.

- [ ] **Step 1: Rulează calibrarea pe cazul care contează**

Singura valoare încă necalibrată e `photoQuality`, iar cazul care o decide sunt capturile de telefon la 1080×2400 (700 KB – 1,1 MB), care cad pe ramura de recomprimare — JPEG peste JPEG, a doua generație de pierderi, pe ecrane cu text mic.

Alege trei capturi de telefon din `C:\Users\User\OneDrive\Pictures\Screenshots` (cele mai mari, peste 800 KB) și rulează pentru fiecare:

Run: `npm run test:shrink -- --calibrate "C:\Users\User\OneDrive\Pictures\Screenshots\<nume>.jpg"`
Expected: un tabel cu mărimi per combinație, plus fișierele și decupajele 1:1 în `tmp-calibrare/`.

- [ ] **Step 2: Rulează calibrarea și pe fotografia de 200 MP**

Run: `npm run test:shrink -- --calibrate "C:\Users\User\Downloads\IMG_20260805_113025.jpg"`
Expected: raport de micșorare mare (de peste 10×) și dimensiuni sub 3072 pe latura lungă.

- [ ] **Step 3: Cere decizia utilizatorului**

Deschide fișierele `tmp-calibrare/crop-*.png` și arată-le utilizatorului. **Întrebarea e a lui, nu a ta:** la care calitate textul mic încă se citește? Criteriul din spec: *textul mic dintr-un screenshot cu cod rămâne citibil la 100%, iar fișierul e cât mai mic în condiția asta.*

Nu alege singur. Dacă utilizatorul nu poate decide acum, lasă `photoQuality: 0.85` — valoarea moștenită — și notează în spec că a rămas necalibrată.

- [ ] **Step 4: Îngheață valorile**

În `src/lib/shrinkImage.ts`, pune valoarea aleasă în `SHRINK_DEFAULTS` și înlocuiește paragraful despre `photoQuality` din comentariul de deasupra cu măsurătorile reale, în forma folosită de mateSimo — fișierul de intrare, dimensiunile, și tabelul combinație → mărime, plus o frază despre de ce s-a ales valoarea aia și nu cea mai agresivă.

- [ ] **Step 5: Rulează totul**

Run: `npm test && npm run typecheck && npm run test:shrink`
Expected: toate trec. Dacă un test din Task 2 se sprijinea pe un prag pe care l-ai schimbat, actualizează așteptarea și **spune în commit ce s-a schimbat și de ce**.

- [ ] **Step 6: Scrie rezultatele în spec**

În `docs/superpowers/specs/2026-08-12-attachments-design.md`, la finalul secțiunii „Singura întrebare rămasă", adaugă un subcapitol „Rezultatul calibrării" cu tabelul măsurat și valoarea aleasă.

- [ ] **Step 7: Commit**

```bash
git add src/lib/shrinkImage.ts src/lib/shrinkImage.test.ts docs/superpowers/specs/2026-08-12-attachments-design.md
git commit -m "feat(attachments): freeze shrink constants from measured calibration"
```

---

## Verificare finală

- [ ] `npm test` — toate testele trec
- [ ] `npm run typecheck` — cod 0
- [ ] `npm run test:shrink` — `0 fail`
- [ ] `npm run storage:report` — 0 orfani, 0 rânduri fără octeți
- [ ] Cei unsprezece pași manuali din Task 9 Step 6, refăcuți pe buildul final
- [ ] `npm run build` — buildul de producție trece
