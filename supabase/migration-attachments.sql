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
