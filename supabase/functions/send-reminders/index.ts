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
//
// Seriile de mementouri (`ping_every`, „la fiecare 15 minute până la 10") au
// drumul lor, în aceeași rulare: `remind_at` e ancora grilei, nu un moment care
// trece o dată, deci „netrimis" nu mai e `reminder_sent_at is null`, ci „pingul
// curent e mai nou decât ultimul trimis". Acolo ordinea e INVERSĂ, deliberat:
// pingul se REVENDICĂ întâi (un update condiționat), apoi se trimite. Două
// rulări suprapuse ar trimite altfel același ping de două ori, iar un ping
// pierdut la o eroare de rețea e recuperat de următorul, peste câteva minute.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// `npm:` — Edge Runtime rulează pachetul npm prin compatibilitatea Node.
// Dacă un deploy eșuează la import, alternativa e `https://esm.sh/web-push@3.6.7`
// (același pachet, alt rezolvator).
import webpush from 'npm:web-push@3.6.7'
import { mintToken } from '../_shared/reminderToken.ts'
import {
  decideEventReminder, eventNotificationTitle, eventReminderId,
  EVENT_LATE_MINUTES, EVENT_PRE_MINUTES, type EventReminderRow, type EventStage,
} from '../_shared/eventReminders.ts'
import { pingFreshMs, pings } from '../_shared/pings.ts'

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
  wave: number
  /** Doar pe o serie: pasul, în minute. */
  ping_every?: number | null
}

interface SeriesRow extends IssueRow {
  remind_at: string
  ping_every: number
  reminder_sent_at: string | null
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

  // Absența lui NU oprește mementourile: fără token, butoanele cad pe
  // comportamentul vechi (prin pagină, sau deschid tichetul). Un memento
  // nelivrat ar fi o pagubă mai mare decât un buton mai puțin comod, deci asta
  // e un avertisment, nu o eroare 500.
  const actionSecret = Deno.env.get('REMINDER_ACTION_SECRET')
  if (!actionSecret) {
    console.warn('REMINDER_ACTION_SECRET nesetat — butoanele notificării vor cere o filă deschisă')
  }
  const actionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/reminder-action`

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const nowIso = new Date().toISOString()
  const { data: due, error } = await db
    .from('issues')
    .select('id, project_id, title, due_at, all_day, wave')
    .not('remind_at', 'is', null)
    .lte('remind_at', nowIso)
    .is('reminder_sent_at', null)
    // Seriile au drumul lor, mai jos: `reminder_sent_at` e acolo ultimul ping.
    .is('ping_every', null)
    .eq('done', false)
    .order('remind_at')
    .limit(BATCH)
  if (error) return json({ error: error.message }, 500)
  const series = await claimSeriesPings(db, Date.now())
  if ('error' in series) return json({ error: series.error }, 500)
  // Evenimentele de calendar întâi și independent: o zi fără niciun tichet cu
  // memento nu înseamnă o zi fără ședințe.
  const events = await sendEventReminders(db, Date.now()).catch((e) => {
    console.error(`mementourile de calendar: ${String(e)}`)
    return { error: String(e) }
  })
  const rows = [...(due as IssueRow[]), ...series.rows]
  if (!rows.length) return json({ sent: 0, reminders: 0, events })

  const projectIds = [...new Set(rows.map((r) => r.project_id))]

  const [{ data: projects }, { data: members }, { data: subs }] = await Promise.all([
    db.from('projects').select('id, name').in('id', projectIds),
    db.from('project_members').select('user_id, project_id, can_see_notes').in('project_id', projectIds),
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

  // Notițele (valul 0) sună doar la cine le poate citi — aceeași regulă ca
  // `notes_ok` din migration-notes-access.sql.
  const membersByProject = new Map<string, Set<string>>()
  const notesByProject = new Map<string, Set<string>>()
  for (const m of members ?? []) {
    const set = membersByProject.get(m.project_id) ?? new Set<string>()
    set.add(m.user_id)
    membersByProject.set(m.project_id, set)
    if (m.can_see_notes) {
      const notes = notesByProject.get(m.project_id) ?? new Set<string>()
      notes.add(m.user_id)
      notesByProject.set(m.project_id, notes)
    }
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
      ...((issue.wave === 0 ? notesByProject : membersByProject).get(issue.project_id) ?? []),
    ])
    // Un token pe TICHET, nu pe dispozitiv: fiecare payload pleacă criptat
    // pentru abonamentul lui (RFC 8291), deci nu se scurge de la un dispozitiv
    // la altul, iar toate aparțin oricum aceluiași om.
    const payload = JSON.stringify({
      id: issue.id,
      title: issue.title,
      dueAt: issue.due_at,
      allDay: issue.all_day,
      projectName: projectName.get(issue.project_id) ?? '',
      // Un ping de serie: `dueAt` e capătul ferestrei, iar butonul e doar „Gata" = am văzut (nu bifează).
      ...(issue.ping_every ? { series: true } : {}),
      ...(actionSecret
        ? { actionToken: await mintToken(actionSecret, issue.id, Date.now()), actionUrl }
        : {}),
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
            {
              // `high`, fiindcă un memento la ora cerută E urgent, iar implicitul
              // (`normal`) permite serviciului de push să-l amâne. Nu e o
              // garanție: Chrome pe Android NU trezește un dispozitiv adormit
              // nici cu asta, iar managerele de baterie ale producătorilor pot
              // întârzia livrarea cu ore. Ajută unde se poate, nu unde nu.
              urgency: 'high',
              // O oră, nu implicitul de patru săptămâni. Un telefon închis peste
              // noapte n-are voie să primească dimineața mementourile de ieri:
              // un memento răsuflat nu mai e informație, e zgomot care învață
              // omul să ignore notificările. Aceeași durată ca a tokenului.
              TTL: issue.ping_every ? seriesTtl(issue.ping_every) : 3600,
              // Un ping încă nelivrat (telefon adormit) e ÎNLOCUIT la serviciul
              // de push de următorul, nu livrat lângă el la trezire.
              ...(issue.ping_every ? { topic: pushTopic(issue.id) } : {}),
            },
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
    // Pingurile de serie sunt deja revendicate (`claimSeriesPings`).
    if (!issue.ping_every) deliveredIssueIds.push(issue.id)
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

  return json({ reminders: rows.length, series: series.rows.length, sent, pruned: deadEndpoints.length, events })
})

/**
 * Cât trăiește un ping la serviciul de push: cel mult până vine următorul, și
 * nu peste o oră (aceeași regulă ca la un memento obișnuit). Un ping livrat
 * după ce a venit următorul e zgomot.
 */
const seriesTtl = (everyMin: number) => Math.min(everyMin * 60, 3600)

/** `Topic` (RFC 8030 §5.4): cel mult 32 de caractere din alfabetul base64url. */
const pushTopic = (id: string) => `hz-${id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32)

/**
 * Pingurile de serie de trimis ACUM, deja revendicate. Pentru fiecare serie
 * deschisă care a început (`remind_at <= now`): pingul curent de pe grilă
 * (`pings`, regula comună cu pagina și cu Kotlin), dacă e mai nou decât ultimul
 * trimis și încă proaspăt (`pingFreshMs`: min(pas, 10 min) — unul mai vechi
 * nu mai e informație, iar următorul vine oricum).
 *
 * Revendicarea e un update condiționat (`reminder_sent_at < ping`), cu
 * `returning`: numai rulările care chiar au scris trimit. Schimbă DOAR
 * `reminder_sent_at`, deci `issues_reset_reminder_sent` (care urmărește
 * `remind_at`) și saltul de recurență nu se amestecă.
 */
async function claimSeriesPings(db: ReturnType<typeof createClient>, nowMs: number): Promise<{ rows: IssueRow[] } | { error: string }> {
  const { data, error } = await db
    .from('issues')
    .select('id, project_id, title, due_at, all_day, wave, remind_at, ping_every, reminder_sent_at')
    .not('ping_every', 'is', null)
    .not('remind_at', 'is', null)
    .not('due_at', 'is', null)
    .lte('remind_at', new Date(nowMs).toISOString())
    .eq('done', false)
    .order('remind_at')
    .limit(BATCH)
  if (error) return { error: error.message }
  const out: IssueRow[] = []
  for (const r of (data ?? []) as SeriesRow[]) {
    const { current } = pings(Date.parse(r.remind_at), r.ping_every, Date.parse(r.due_at!), nowMs)
    if (current === null || nowMs - current > pingFreshMs(r.ping_every)) continue
    if (r.reminder_sent_at && Date.parse(r.reminder_sent_at) >= current) continue
    const ping = new Date(current).toISOString()
    const { data: claimed, error: cErr } = await db
      .from('issues')
      .update({ reminder_sent_at: ping })
      .eq('id', r.id)
      .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${ping}`)
      .select('id')
    if (cErr) { console.error(`revendicarea pingului ${r.id}@${ping}: ${cErr.message}`); continue }
    if (claimed?.length) out.push(r)
  }
  return { rows: out }
}

/** Aceleași opțiuni ca la tichete — de-ce-urile sunt acolo. */
const PUSH_OPTS = { urgency: 'high' as const, TTL: 3600 }

/**
 * Mementourile evenimentelor din Google Calendar: cu 10 minute înainte și la
 * start (`decideEventReminder`, pur, cu teste). Destinatarul e DOAR omul
 * căruia îi aparține calendarul — nu există membri sau admini pe un calendar.
 *
 * Payload-ul are `kind: 'event'` și FĂRĂ token de acțiune: un eveniment nu se
 * bifează și nu se amână, deci notificarea n-are butoane. `title` vine deja
 * compus („Peste 10 min: …"), ca un service worker vechi, care încă nu știe de
 * `kind`, să arate totuși textul corect.
 *
 * Ordinea e aceeași ca la tichete: marcarea DUPĂ trimitere.
 */
async function sendEventReminders(db: ReturnType<typeof createClient>, nowMs: number) {
  const from = new Date(nowMs - (EVENT_LATE_MINUTES + 5) * 60_000).toISOString()
  const to = new Date(nowMs + EVENT_PRE_MINUTES * 60_000).toISOString()
  const { data, error } = await db
    .from('calendar_events')
    .select('id, user_id, title, all_day, start_at, end_at, location, response, pre_sent_at, start_sent_at')
    .eq('all_day', false)
    .gte('start_at', from)
    .lte('start_at', to)
    .or('pre_sent_at.is.null,start_sent_at.is.null')
    .limit(BATCH)
  // Tabelul lipsește pe o bază fără migration-calendar.sql: nu e o eroare a mementourilor de tichete.
  if (error) return { error: error.message }
  const rows = (data ?? []) as (EventReminderRow & { user_id: string; title: string; end_at: string; location: string | null })[]
  if (!rows.length) return { events: 0, sent: 0 }

  const plans = rows.map((r) => ({ row: r, d: decideEventReminder(r, nowMs) }))
  const users = [...new Set(plans.filter((p) => p.d.send).map((p) => p.row.user_id))]
  const { data: subs } = users.length
    ? await db.from('push_subscriptions').select('user_id, endpoint, p256dh, auth').in('user_id', users)
    : { data: [] }

  let sent = 0
  const dead: string[] = []
  for (const { row, d } of plans) {
    if (!d.send) continue
    const stage: EventStage = d.send
    const payload = JSON.stringify({
      kind: 'event',
      id: eventReminderId(row.id),
      stage,
      title: eventNotificationTitle(stage, row.title),
      eventTitle: row.title,
      startAt: row.start_at,
      endAt: row.end_at,
      location: row.location,
    })
    for (const s of (subs ?? []).filter((x) => x.user_id === row.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, PUSH_OPTS)
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(s.endpoint)
        else console.error(`push eșuat pentru eveniment ${row.id}: ${String(e)}`)
      }
    }
  }

  const stamp = new Date(nowMs).toISOString()
  const pre = plans.filter((p) => p.d.mark.pre).map((p) => p.row.id)
  const start = plans.filter((p) => p.d.mark.start).map((p) => p.row.id)
  if (pre.length) await db.from('calendar_events').update({ pre_sent_at: stamp }).in('id', pre)
  if (start.length) await db.from('calendar_events').update({ start_sent_at: stamp }).in('id', start)
  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead)
  return { events: rows.length, sent }
}
