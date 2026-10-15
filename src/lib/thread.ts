// Logica pură a firului. Fără DOM, fără rețea — ca engine.ts și schedule.ts.
import type { Assignee, InboxRow, Issue, IssueEvent } from './types'
import { dayOffset, toShortDate } from './schedule'

/**
 * Compară momente, nu șiruri: formatări diferite ale aceluiași moment
 * (Z vs +00:00, milisecunde vs microsecunde) pot veni din surse diferite
 * și trebuie să compareze corect. `null` = nimeni străin n-a scris niciodată.
 *
 * O dată coruptă (NaN) din oricare sursă e de pe latura sigură: nu-și pierde
 * o pasă prin „nu vad bulina". seenAt corupt cere aceeași alegere — dacă
 * nu-l poți citi, e ca și cum n-ai fi vizitat niciodată.
 */
export function isUnread(lastForeignAt: string | null, seenAt: string | null): boolean {
  if (!lastForeignAt) return false
  if (!seenAt) return true
  const lastForeignTime = Date.parse(lastForeignAt)
  const seenTime = Date.parse(seenAt)
  // O dată pe care nu o poți citi (NaN) e tratată ca „necitit"
  if (isNaN(lastForeignTime) || isNaN(seenTime)) return true
  return lastForeignTime > seenTime
}

/**
 * „Necitite" / „Mai devreme". Bifatele nu apar deloc: cutia de pase e o listă
 * de treabă rămasă, nu un istoric. Sortează pe momente, nu șiruri.
 *
 * `null` și date corupte (NaN) se pun la coadă listei: nu-și au loc în
 * ordinea cronologică. Comparatorul nu folosește NaN direct (ar polua ordinea
 * datelor valide din jur) — ci le detectează și le trimite la coadă explicit.
 */
export function groupInbox(rows: readonly InboxRow[]): { fresh: InboxRow[]; rest: InboxRow[] } {
  const open = rows.filter((r) => !r.done)
  const byRecency = [...open].sort((a, b) => {
    let aTime = a.lastEventAt ? Date.parse(a.lastEventAt) : null
    let bTime = b.lastEventAt ? Date.parse(b.lastEventAt) : null

    const aInvalid = aTime === null || isNaN(aTime)
    const bInvalid = bTime === null || isNaN(bTime)

    // Amândouă invalide → egal (păstrează ordinea)
    if (aInvalid && bInvalid) return 0
    // a valid, b invalid → a întâi
    if (!aInvalid && bInvalid) return -1
    // a invalid, b valid → b întâi
    if (aInvalid && !bInvalid) return 1
    // Amândouă valide → sortează descrescător (mai recent întâi)
    return bTime! - aTime!
  })
  return {
    fresh: byRecency.filter((r) => isUnread(r.lastForeignAt, r.seenAt)),
    rest: byRecency.filter((r) => !isUnread(r.lastForeignAt, r.seenAt)),
  }
}

/**
 * Reconciliază instantaneul cutiei de pase cu tichetele DEJA încărcate.
 *
 * `inbox_rows` e o a doua poză a acelorași fapte (`assignee_id`, `done`,
 * titlu), adusă o dată la pornire și la refresh. Fără reconciliere, orice
 * scriere care nu trece prin `post_to_thread` o lăsa în urmă: îți puneai
 * numele pe un tichet din formular și „Ale mele" rămânea gol, îl scoteai și
 * rândul rămânea acolo. Același tipar ca `dueIssues` din store — `allIssues`
 * e mai proaspăt pentru proiectele deschise, deci versiunea de acolo câștigă,
 * iar rezultatul e derivat: nu există al doilea loc de scris.
 *
 * Un tichet dintr-un proiect NEîncărcat nu se atinge — absența lui din
 * `issues` înseamnă „nu știu", nu „nu mai e al meu". Ștergerea îl scoate din
 * `inboxRaw` explicit (store), la fel ca la `dueRaw`.
 *
 * `myAssigneeId` null (cont nelegat de un nume, sau `assignees` încă
 * neîncărcat) nu reconciliază nimic: fără o identitate, „al meu" n-are sens
 * și am goli lista pe baza unei necunoscute.
 */
export function reconcileInbox(
  rows: readonly InboxRow[],
  issues: readonly Issue[],
  myAssigneeId: string | null,
): InboxRow[] {
  if (!myAssigneeId) return [...rows]
  const fresh = new Map(issues.map((i) => [i.id, i]))
  const known = new Set(rows.map((r) => r.issueId))
  const merged: InboxRow[] = []
  for (const r of rows) {
    const live = fresh.get(r.issueId)
    if (!live) { merged.push(r); continue }
    if (live.assigneeId !== myAssigneeId) continue
    merged.push({ ...r, title: live.title, done: live.done, assigneeId: live.assigneeId })
  }
  for (const i of issues) {
    if (i.assigneeId !== myAssigneeId || known.has(i.id)) continue
    // Un tichet care tocmai a devenit al meu n-are fir în poza asta: momentele
    // rămân null (se completează la următorul refresh). E cinstit — „—" în loc
    // de o oră inventată — și îl duce la coada listei, nu în „Necitite".
    merged.push({
      issueId: i.id, projectId: i.projectId, title: i.title, done: i.done,
      assigneeId: i.assigneeId, lastEventAt: null, lastForeignAt: null,
      lastForeignAuthor: null, seenAt: null,
    })
  }
  return merged
}

/**
 * Numele de afișat al unui autor de eveniment. `authorId` e un id de cont
 * (`auth.users`), NU un id de assignee — se mapează prin `assignees.userId`.
 * `null` = notă migrată din vechiul câmp `notes` (vezi migration-comments.sql).
 */
export function authorDisplay(
  authorId: string | null,
  assignees: readonly Assignee[],
  myUserId: string,
): { name: string; initials: string | null; mine: boolean } {
  if (authorId === null) return { name: 'Notă mutată', initials: null, mine: false }
  const mine = authorId === myUserId
  const found = assignees.find((a) => a.userId === authorId)
  if (found) return { name: found.name, initials: found.name.slice(0, 2).toUpperCase(), mine }
  return { name: mine ? 'Eu' : 'Cineva', initials: mine ? 'EU' : '?', mine }
}

/** Numele unui assignee pentru o pasă (`handoffFrom`/`handoffTo` sunt id-uri
 *  de ASSIGNEE, nu de cont — spre deosebire de `authorId`). */
export function assigneeLabel(id: string | null, assignees: readonly Assignee[]): string {
  if (id === null) return 'Nimeni'
  return assignees.find((a) => a.id === id)?.name ?? 'necunoscut'
}

/**
 * Ce știe foaia de telefon despre fir fără să-l încarce: numărul de
 * evenimente, ultimele două și vizita mea (`issue_seen.seen_at`).
 *
 * Două, nu unul: `post_to_thread` scrie comentariul și pasa în aceeași
 * tranzacție, deci cu același `created_at` — „ți l-am pasat, uite de ce" sunt
 * două rânduri, iar ordinea dintre ele la egalitate e arbitrară.
 */
export interface ThreadSummary {
  count: number
  /** Cele mai noi evenimente, cel mai nou întâi (cel mult două). */
  recent: IssueEvent[]
  /** `null` = n-am deschis niciodată firul tichetului. */
  seenAt: string | null
}

/** Cine sunt, pentru „al meu" (cont) și „către mine" (rândul din `assignees`). */
export interface ThreadMe {
  userId: string
  assigneeId: string | null
}

export type ThreadRowView =
  | { kind: 'hidden' }
  | {
      kind: 'unread' | 'read'
      authorId: string | null
      at: string
      /** Textul comentariului; la o pasă fără mesaj, gol. */
      body: string
      handoff: { from: string | null; to: string | null; toMe: boolean } | null
      /** `null` = încă nu se știe (primul cadru, din cutia de pase). */
      count: number | null
    }

const sameMoment = (a: string, b: string) => {
  const x = Date.parse(a)
  const y = Date.parse(b)
  return !isNaN(x) && x === y
}

/**
 * Starea rândului de fir din foaia de tichet.
 *
 * Necitit = ultimul eveniment e al ALTCUIVA și e mai nou decât vizita mea —
 * regula lui `isUnread`. Dacă ultimul e al meu, am răspuns, deci am citit:
 * nu e nevoie de un „ultimul străin" separat (și deci nici de o migrare). O
 * notă migrată (`authorId` null) nu e o veste: n-o scrie nimeni acum.
 */
export function threadRowState(summary: ThreadSummary | null | undefined, me: ThreadMe): ThreadRowView {
  if (!summary || summary.count <= 0 || summary.recent.length === 0) return { kind: 'hidden' }
  const last = summary.recent[0]
  const next = summary.recent[1]
  // Perechea unei pase cu mesaj: același gest, același autor, același moment.
  const pair = next && next.kind !== last.kind && next.authorId === last.authorId && sameMoment(next.createdAt, last.createdAt)
    ? next
    : null
  const hand = last.kind === 'handoff' ? last : pair?.kind === 'handoff' ? pair : null
  const comment = last.kind === 'comment' ? last : pair?.kind === 'comment' ? pair : null
  const foreign = last.authorId !== null && last.authorId !== me.userId
  return {
    kind: foreign && isUnread(last.createdAt, summary.seenAt) ? 'unread' : 'read',
    authorId: last.authorId,
    at: last.createdAt,
    body: comment?.body.trim() ?? '',
    handoff: hand
      ? { from: hand.handoffFrom, to: hand.handoffTo, toMe: me.assigneeId !== null && hand.handoffTo === me.assigneeId }
      : null,
    count: summary.count,
  }
}

/**
 * Primul cadru, cât rezumatul e încă pe drum: un tichet pasat mie are rând în
 * cutia de pase, iar acela știe deja dacă e necitit. Numai starea necitită se
 * arată dinainte — un „citit" din poza cutiei ar putea fi un fir gol.
 */
export function threadRowFromInbox(row: InboxRow | undefined): ThreadRowView {
  if (!row?.lastForeignAt || !isUnread(row.lastForeignAt, row.seenAt)) return { kind: 'hidden' }
  return { kind: 'unread', authorId: row.lastForeignAuthor, at: row.lastForeignAt, body: '', handoff: null, count: null }
}

/**
 * Ce scrie pe rând. Pasa către mine spune de ce tichetul e acum al meu („Ți
 * l-a pasat Ionuț"); una către altcineva e „Ionuț → Ana". Mesajul, dacă e,
 * rămâne corpul.
 */
export function threadRowText(
  view: Extract<ThreadRowView, { kind: 'unread' | 'read' }>,
  assignees: readonly Assignee[],
  myUserId: string,
): { who: string; initials: string; body: string } {
  const a = authorDisplay(view.authorId, assignees, myUserId)
  const name = a.mine ? 'Eu' : a.name
  const initials = a.initials ?? '·'
  if (!view.handoff) return { who: name, initials, body: view.body }
  if (view.handoff.toMe) return { who: `Ți l-a pasat ${name}`, initials, body: view.body }
  return { who: `${name} → ${assigneeLabel(view.handoff.to, assignees)}`, initials, body: view.body }
}

/**
 * Primul eveniment necitit din fir, pentru separatorul „nou": al altcuiva
 * (nu o notă migrată) și mai nou decât vizita. `seenAt` `undefined` = nu se
 * știe (rezumatul n-a venit) → niciun separator, ca să nu mintă.
 */
export function firstUnreadId(events: readonly IssueEvent[], seenAt: string | null | undefined, myUserId: string): string | null {
  if (seenAt === undefined) return null
  const e = events.find((x) => x.authorId !== null && x.authorId !== myUserId && isUnread(x.createdAt, seenAt))
  return e?.id ?? null
}

/** Ora scurtă de pe rândul firului: „acum", „5 min", „2 h", „ieri", „3 z", apoi data. */
export function shortAgo(iso: string, now: Date): string {
  const then = Date.parse(iso)
  if (isNaN(then)) return ''
  const min = Math.floor((now.getTime() - then) / 60_000)
  if (min < 1) return 'acum'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const days = -dayOffset(iso, now)
  if (days === 1) return 'ieri'
  if (days < 7) return `${days} z`
  return toShortDate(iso)
}

/**
 * Merită marcat firul citit? Doar dacă e ceva străin de citit: un fir numai al
 * meu e deja „văzut" (`post_to_thread` marchează), iar o vizită știută ca mai
 * nouă nu cere încă o scriere. Vizita necunoscută (`undefined`, rezumatul n-a
 * venit) nu oprește marcarea — mai bine o scriere în plus decât un „nou" care
 * nu se mai stinge.
 */
export function needsSeen(events: readonly IssueEvent[], seenAt: string | null | undefined, myUserId: string): boolean {
  const foreign = events.filter((e) => e.authorId !== null && e.authorId !== myUserId)
  const last = foreign[foreign.length - 1]
  if (!last) return false
  return seenAt === undefined || seenAt === null || Date.parse(last.createdAt) > Date.parse(seenAt)
}

/**
 * Rândul de fir rămâne „necitit" cât stă tichetul deschis, ca separatorul
 * „nou" din fir (și el o poză de la deschidere). În panou firul se marchează
 * citit când intră în vedere — adesea chiar la deschidere —, iar rândul ar fi
 * clipit „nou" o clipă și s-ar fi stins. `unreadAt` = momentul ultimului
 * eveniment văzut necitit la montare; un eveniment mai nou (răspunsul meu)
 * lasă rândul să treacă pe „citit".
 */
export function keepUnread(view: ThreadRowView, unreadAt: string | null): ThreadRowView {
  if (view.kind !== 'read' || unreadAt === null) return view
  return Date.parse(view.at) === Date.parse(unreadAt) ? { ...view, kind: 'unread' } : view
}
