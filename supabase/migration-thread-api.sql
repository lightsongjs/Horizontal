-- supabase/migration-thread-api.sql
-- Firul (comentarii + pase) din API-ul de tichete (`functions/api/`). Aditivă,
-- idempotentă; se rulează cu `npm run migrate supabase/migration-thread-api.sql`
-- DUPĂ migration-comments.sql și ÎNAINTE de pushul care publică
-- `POST /api/tickets/<id>/comments` (fără ea ruta răspunde `migration_missing`;
-- citirea firului merge și fără).
--
-- De ce o funcție nouă: `post_to_thread` ia autorul din `auth.uid()`, iar
-- API-ul scrie cu cheia de serviciu, fără sesiune (refuză „fara sesiune”).
-- `post_to_thread_api` face ACELAȘI gest — comentariu + pasă într-o
-- tranzacție, `for update` pe tichet, „văzut” pentru cel care scrie — dar cu
-- autorul dat explicit: contul omului în numele căruia scrie unealta (`tk`
-- trimite omul configurat pe calculator). Comentariul apare deci ca al lui
-- „Ionut”, ca și cum l-ar fi scris din aplicație.
--
-- Drepturile nu se lărgesc: funcția se poate chema NUMAI cu cheia de
-- serviciu, care oricum poate scrie orice rând (inclusiv `author_id`) direct
-- prin REST. Funcția doar face gestul corect și atomic.

create or replace function public.post_to_thread_api(
  p_issue_id       text,
  p_author         uuid,
  p_body           text    default '',
  p_handoff        boolean default false,
  p_to             uuid    default null,
  p_attachment_ids uuid[]  default '{}'
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $fn$
declare
  v_project text; v_prev uuid; v_ids uuid[] := '{}'; v_id uuid;
  v_att boolean := false; v_events jsonb; v_assignee uuid;
begin
  -- Autorul e un cont real, legat de un rând din `assignees` (altfel
  -- interfața n-ar avea ce nume să-i arate). Verificat și în API; aici e garda.
  if p_author is null or not exists (select 1 from public.assignees a where a.user_id = p_author) then
    raise exception 'autor necunoscut: %', p_author using errcode = 'HZC03';
  end if;

  -- Rândul tichetului, blocat: două pase simultane n-au voie să scrie același
  -- `handoff_from` (istoric fals) — motivul din post_to_thread.
  select i.project_id, i.assignee_id into v_project, v_prev
    from public.issues i where i.id = p_issue_id for update;
  if not found then
    raise exception 'tichet inexistent: %', p_issue_id using errcode = 'HZC01';
  end if;

  if coalesce(array_length(p_attachment_ids, 1), 0) > 0 then
    select exists (select 1 from public.attachments a
                    where a.id = any(p_attachment_ids)
                      and a.issue_id = p_issue_id and a.event_id is null) into v_att;
  end if;

  if nullif(btrim(coalesce(p_body, '')), '') is null and not v_att and not p_handoff then
    raise exception 'comentariu gol' using errcode = 'HZC02';
  end if;

  if nullif(btrim(coalesce(p_body, '')), '') is not null or v_att then
    insert into public.issue_events (issue_id, project_id, kind, author_id, body)
    values (p_issue_id, v_project, 'comment', p_author, btrim(coalesce(p_body, '')))
    returning id into v_id;
    v_ids := v_ids || v_id;
    update public.attachments a set event_id = v_id
     where a.id = any(p_attachment_ids) and a.issue_id = p_issue_id and a.event_id is null;
  end if;

  -- `handoff_from` = cine îl avea înainte (null = creatorul), ca în
  -- post_to_thread; autorul gestului e `author_id`.
  v_assignee := v_prev;
  if p_handoff and v_prev is distinct from p_to then
    update public.issues i set assignee_id = p_to where i.id = p_issue_id;
    insert into public.issue_events (issue_id, project_id, kind, author_id, body, handoff_from, handoff_to)
    values (p_issue_id, v_project, 'handoff', p_author, '', v_prev, p_to)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_assignee := p_to;
  end if;

  -- Cine scrie în fir, l-a și citit (ca în post_to_thread).
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    insert into public.issue_seen (user_id, issue_id, seen_at)
    values (p_author, p_issue_id, pg_catalog.now())
    on conflict (user_id, issue_id) do update set seen_at = pg_catalog.now();
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.kind), '[]'::jsonb)
    into v_events from public.issue_events e where e.id = any(v_ids);
  return jsonb_build_object('events', v_events, 'assignee_id', v_assignee);
end $fn$;

revoke all on function public.post_to_thread_api(text, uuid, text, boolean, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.post_to_thread_api(text, uuid, text, boolean, uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
