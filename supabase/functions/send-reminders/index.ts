// supabase/functions/send-reminders/index.ts
//
// Trimite mementourile scadente. Chemată de pg_cron la fiecare minut — vezi
// supabase/migration-cron.sql.
//
// Contractul: selectează tichetele cu `remind_at <= now()`, netrimise și
// nebifate, trimite un web push către fiecare dispozitiv al utilizatorilor care
// AU DREPTUL să vadă tichetul, apoi marchează `reminder_sent_at`.
//
// Ordinea contează: marcarea se face DUPĂ trimitere, iar un eșec de rețea lasă
// tichetul nemarcat, deci se reîncearcă la minutul următor. Invers (marchează
// apoi trimite) un minut ratat ar înghiți mementoul pentru totdeauna — și un
// memento ratat e singurul mod în care funcția asta poate fi inutilă.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// `npm:` — Edge Runtime rulează pachetul npm prin compatibilitatea Node.
// Dacă un deploy eșuează la import, alternativa e `https://esm.sh/web-push@3.6.7`
// (același pachet, alt rezolvator).
import webpush from 'npm:web-push@3.6.7'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Câte mementouri se procesează într-o rulare. Un minut nu poate aduce mii. */
const BATCH = 200

interface IssueRow {
  id: string
  project_id: string
  title: string
  due_at: string | null
  all_day: boolean
}

Deno.serve(async (req) => {
  // Numai cine are service role are dreptul să declanșeze trimiterea. Fără
  // garda asta, oricine care cunoaște URL-ul ar putea goli coada.
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return json({ error: 'forbidden' }, 403)
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  // Fără valoare de rezervă, deliberat. Un `?? 'mailto:admin@example.com'` ar
  // trece validarea din `web-push` și ar ascunde un secret nesetat: notificările
  // ar pleca cu un contact fals, iar pe iPhone Apple poate răspunde
  // `403 BadJwtToken` — un eșec care arată ca o problemă de dispozitiv, nu de
  // configurare. RFC 8292 §2.1 cere `mailto:` sau `https:`.
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey) return json({ error: 'VAPID keys missing' }, 500)
  if (!subject) return json({ error: 'VAPID_SUBJECT missing' }, 500)
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const nowIso = new Date().toISOString()
  const { data: due, error } = await db
    .from('issues')
    .select('id, project_id, title, due_at, all_day')
    .not('remind_at', 'is', null)
    .lte('remind_at', nowIso)
    .is('reminder_sent_at', null)
    .eq('done', false)
    .order('remind_at')
    .limit(BATCH)
  if (error) return json({ error: error.message }, 500)
  if (!due?.length) return json({ sent: 0, reminders: 0 })

  const rows = due as IssueRow[]
  const projectIds = [...new Set(rows.map((r) => r.project_id))]

  const [{ data: projects }, { data: members }, { data: subs }] = await Promise.all([
    db.from('projects').select('id, name').in('id', projectIds),
    db.from('project_members').select('user_id, project_id').in('project_id', projectIds),
    db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth'),
  ])

  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name as string]))

  // Cine primește mementoul: membrii proiectului, plus administratorii.
  //
  // Regula OGLINDEȘTE politica RLS din migration-access.sql — cine poate vedea
  // tichetul poate primi mementoul, și nimeni altcineva. Consecința, asumată
  // explicit: într-o instanță cu MAI MULȚI admini, fiecare admin primește
  // mementourile tuturor, fiindcă modelul nu are noțiunea de „proprietar al
  // tichetului". Pentru o instanță personală (un admin) e exact corect. Când
  // devine deranjant, leacul e o coloană de proprietar pe `issues`, nu o
  // excepție aici.
  const { data: userList } = await db.auth.admin.listUsers()
  const adminIds = (userList?.users ?? [])
    .filter((u) => u.app_metadata?.role === 'admin')
    .map((u) => u.id)

  const membersByProject = new Map<string, Set<string>>()
  for (const m of members ?? []) {
    const set = membersByProject.get(m.project_id) ?? new Set<string>()
    set.add(m.user_id)
    membersByProject.set(m.project_id, set)
  }

  const subsByUser = new Map<string, typeof subs>()
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? []
    list.push(s)
    subsByUser.set(s.user_id, list)
  }

  let sent = 0
  const deadEndpoints: string[] = []
  const deliveredIssueIds: string[] = []

  for (const issue of rows) {
    const recipients = new Set<string>([
      ...adminIds,
      ...(membersByProject.get(issue.project_id) ?? []),
    ])
    const payload = JSON.stringify({
      id: issue.id,
      title: issue.title,
      dueAt: issue.due_at,
      allDay: issue.all_day,
      projectName: projectName.get(issue.project_id) ?? '',
    })

    // Un tichet fără niciun dispozitiv abonat se marchează TOT ca trimis:
    // altfel ar rămâne în coadă la fiecare minut, pentru totdeauna.
    let anyAttempt = false
    for (const userId of recipients) {
      for (const s of subsByUser.get(userId) ?? []) {
        anyAttempt = true
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          )
          sent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          // 404/410 = endpoint mort (dispozitiv șters, permisiune retrasă).
          // Se curăță, altfel coada de abonamente crește la infinit și fiecare
          // rulare pierde timp pe adrese care nu vor răspunde niciodată.
          if (status === 404 || status === 410) deadEndpoints.push(s.endpoint)
          else console.error(`push eșuat pentru ${issue.id} → ${s.endpoint}: ${String(e)}`)
        }
      }
    }
    void anyAttempt
    deliveredIssueIds.push(issue.id)
  }

  // Marcarea, într-un singur update. Trigger-ul `issues_reset_reminder_sent` NU
  // se declanșează aici în mod problematic: el resetează doar când `remind_at`
  // se schimbă, iar noi nu-l atingem.
  if (deliveredIssueIds.length) {
    await db.from('issues').update({ reminder_sent_at: nowIso }).in('id', deliveredIssueIds)
  }
  if (deadEndpoints.length) {
    await db.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }

  return json({ reminders: rows.length, sent, pruned: deadEndpoints.length })
})
