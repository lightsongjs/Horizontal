import type { NewIssue } from '../data/repository'
import { parseCaptureTokens, type CaptureTokens } from './captureTokens'
import { liveRejections, maskRejected, parseDue, stripSpans } from './parseDue'
import { dayOffset, defaultReminder, reminderAt, startOfLocalDay, toDisplayDate, toTimeInput } from './schedule'

/**
 * Adăugarea rapidă, fără React: ce sarcină iese din ce a scris omul și ce a
 * atins. Trei locuri o folosesc — rândul din „Azi", bara de captură de pe
 * Linux și foaia rapidă de pe telefon — iar regulile de aici sunt exact cele
 * pe care niciunul n-are voie să le spună altfel.
 */

/**
 * De unde s-a deschis captura. În listă, sarcina fără dată în text primește
 * ziua listei (altfel n-ar apărea în lista din care ai scris-o). Într-un
 * proiect, scadența e excepția — un tichet de proiect fără dată NU e o
 * restanță în devenire — deci fără dată în text rămâne fără dată, iar valul e
 * cel la care te uiți.
 */
export type QuickCtx =
  | { mode: 'list'; defaultDueAt: string }
  | { mode: 'project'; projectId: string; wave: number }

/**
 * Ce a ales omul din butoane. Lipsa cheii = n-a atins butonul; `assigneeId:
 * null` = a ales explicit „al meu". Butonul bate semnul din text: e corectura.
 */
export interface ManualPick {
  projectId?: string
  assigneeId?: string | null
  urgent?: boolean
  due?: { dueAt: string | null; allDay: boolean }
}

/** Ce a înțeles `useTitleDate` din titlu. */
export interface DraftDate {
  /** Există o dată recunoscută și nerefuzată. */
  active: boolean
  dueAt: string | null
  allDay: boolean
  rrule: string | null
  /** Textul fără fragmentele de dată. */
  title: string
}

export interface DraftInput {
  text: string
  desc: string
  date: DraftDate
  /** Semnele `#proiect @om !`, sau null unde captura nu le citește (rândul din listă). */
  tokens: CaptureTokens | null
  manual: ManualPick
  /** Proiectul deja rezolvat (buton → semn → ținut minte → personal). */
  projectId: string
  ctx: QuickCtx
}

export interface DraftSchedule {
  dueAt: string | null
  allDay: boolean
  rrule: string | null
}

/**
 * Scadența care se va salva. Butonul de dată bate textul, textul bate
 * implicitul contextului. Recurența vine numai din text și cade la o dată
 * aleasă de mână: „zilnic" scris lângă o zi aleasă din calendar nu mai spune
 * de unde pornește seria.
 */
export function draftSchedule(date: DraftDate, manual: ManualPick, ctx: QuickCtx): DraftSchedule {
  if (manual.due) return { dueAt: manual.due.dueAt, allDay: manual.due.allDay, rrule: null }
  if (date.active) return { dueAt: date.dueAt, allDay: date.allDay, rrule: date.rrule }
  return { dueAt: ctx.mode === 'list' ? ctx.defaultDueAt : null, allDay: true, rrule: null }
}

export type DraftError = 'empty' | 'bare'

/**
 * Sarcina gata de trimis, sau de ce nu se poate. `bare` = text numai-dată
 * („azi la 8"): n-are ce să salveze, iar o sarcină fără titlu e mai rea decât
 * un refuz vizibil.
 */
export function resolveDraft(input: DraftInput): NewIssue | { error: DraftError } {
  const { text, desc, date, tokens, manual, projectId, ctx } = input
  if (!text.trim()) return { error: 'empty' }
  const title = (tokens ? tokens.title : date.title).trim()
  if (!title) return { error: 'bare' }
  const { dueAt, allDay, rrule } = draftSchedule(date, manual, ctx)
  const out: NewIssue = {
    projectId,
    title,
    desc: desc.trim(),
    dueAt,
    allDay,
    remindAt: reminderAt(dueAt, defaultReminder(allDay)),
    rrule,
  }
  // Valul activ e al proiectului DESCHIS. Mutată în alt proiect din selector,
  // sarcina ia valul curent al aceluia (implicitul depozitului): numărul
  // valului de aici poate să nici nu existe acolo.
  if (ctx.mode === 'project' && projectId === ctx.projectId) out.wave = ctx.wave
  // Numai unde captura le poate alege (bara, foaia). În rândul din „Azi" nu
  // există butoanele, iar un `assigneeId: null` explicit e oricum „al creatorului".
  if (tokens) {
    out.assigneeId = manual.assigneeId !== undefined ? manual.assigneeId : tokens.assigneeId
    out.urgent = manual.urgent ?? tokens.urgent
  }
  return out
}

export type QuickKeyAction = 'submit' | 'open-desc' | 'to-title' | null

/**
 * Tastele capturii, ca tabel. Enter în titlu salvează (captura cea mai
 * rapidă); Tab deschide descrierea DOAR peste un titlu început — pe un câmp
 * gol, Tab rămâne navigarea obișnuită, altfel tastatura n-ar mai putea ieși
 * din câmp. În descriere Enter e rând nou, deci salvarea cere Ctrl/⌘+Enter;
 * Shift+Tab, sau Backspace pe o descriere goală, te întoarce la titlu.
 */
export function quickKey(k: {
  key: string
  shift: boolean
  mod: boolean
  field: 'title' | 'desc'
  titleEmpty: boolean
  descEmpty: boolean
}): QuickKeyAction {
  if (k.field === 'title') {
    if (k.key === 'Enter') return 'submit'
    if (k.key === 'Tab' && !k.shift && !k.mod && !k.titleEmpty) return 'open-desc'
    return null
  }
  if (k.key === 'Enter' && k.mod) return 'submit'
  if (k.key === 'Tab' && k.shift) return 'to-title'
  if (k.key === 'Backspace' && k.descEmpty && !k.mod) return 'to-title'
  return null
}

/**
 * Cât din fereastră acoperă tastatura. Pe Android cu WebView care se
 * micșorează, `innerHeight` scade odată cu `visualViewport` și rezultatul e 0
 * (fundul ferestrei e deja deasupra tastaturii). Unde nu se micșorează
 * (iOS, edge-to-edge forțat), diferența e exact tastatura.
 */
export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))
}

const DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm']

/**
 * Ce scrie jetonul de scadență.
 *
 * Pentru zilele apropiate, cuvântul e mai clar decât cifrele: „Azi 15:00" se
 * citește dintr-o privire, „24-08-2026 15:00" cere o secundă de socoteală.
 * Mai departe de mâine, data numerică e cea neambiguă — cu ziua săptămânii
 * înaintea ei, fiindcă întrebarea reală e adesea „în ce zi cade?". Anul doar
 * dacă nu e cel curent: în rândul de controale de pe un telefon de 390px,
 * „/2026" lua exact locul în care ar fi încăput numele proiectului.
 */
export function dueLabel(iso: string, allDay: boolean, now: Date): string {
  const { day, time } = dueLabelParts(iso, allDay, now)
  return time ? `${day} ${time}` : day
}

/**
 * Ziua și ora jetonului, separat: pe rândul îngust ora e prima care cedează
 * locul (`.qs-due-h`, ascunsă dintr-un container query), fiindcă se vede
 * oricum în panoul de dată deschis de jeton.
 */
export function dueLabelParts(iso: string, allDay: boolean, now: Date): { day: string; time: string | null } {
  const off = dayOffset(iso, now)
  const d = new Date(iso)
  const full = toDisplayDate(iso)
  const date = d.getFullYear() === now.getFullYear() ? full.slice(0, 5) : full
  const day =
    off === 0 ? 'Azi'
      : off === 1 ? 'Mâine'
        : off === -1 ? 'Ieri'
          : `${DAYS[d.getDay()]} ${date}`
  return { day, time: allDay ? null : toTimeInput(iso) }
}

export interface CaptureInput {
  text: string
  desc: string
  /** Fragmentele refuzate de om (`useTitleDate`); cele care nu mai sunt în text se uită. */
  rejected: string[]
  manual: ManualPick
  projects: { id: string; name: string; prefix: string; type?: string }[]
  assignees: { id: string; name: string }[]
  /** Proiectul cu care pornește captura (Daily, ținut minte, al proiectului deschis). */
  defaultProjectId: string | null
  nowMs: number
  /** Citește `#proiect @om !` (bara, foile, fereastra de pe telefon). */
  tokens: boolean
  /** Implicit: lista „Azi" — fără dată, sarcina primește ziua de azi. */
  ctx?: QuickCtx
}

export interface CaptureResult {
  /** Refuzurile încă prezente în text. */
  live: string[]
  /** Fragmentele de dată recunoscute, în textul original — ce se evidențiază. */
  spans: [number, number][]
  title: string
  projectId: string | null
  assigneeId: string | null
  urgent: boolean
  unknown: string[]
  dueAt: string | null
  allDay: boolean
  rrule: string | null
  remindAt: string | null
  issue: NewIssue | null
  error: DraftError | null
}

/**
 * Captura întreagă, fără React și fără ceas implicit: ce a scris omul, ce a
 * refuzat și ce a atins → sarcina. Aceeași funcție rulează în pagină (prin
 * `useQuickDraft`) și în fereastra nativă de pe telefon (pachetul
 * `src/capture/engine.ts`, în motorul JS) — regulile de dată și semne au o
 * singură sursă. Fixtures: `capture.fixtures.json`.
 */
export function computeDraft(i: CaptureInput): CaptureResult {
  const now = new Date(i.nowMs)
  const live = liveRejections(i.text, i.rejected)
  const parsed = parseDue(maskRejected(i.text, live), now)
  const active = parsed.dueAt !== null
  const spans = active ? parsed.spans : []
  const dateTitle = active ? stripSpans(i.text, spans) : i.text.trim()
  const tokens = i.tokens ? parseCaptureTokens(dateTitle, i.projects, i.assignees) : null
  const wanted = i.manual.projectId ?? tokens?.projectId ?? i.defaultProjectId
  const project = i.projects.find((p) => p.id === wanted)
    ?? i.projects.find((p) => p.type === 'personal')
    ?? i.projects[0]
  const ctx: QuickCtx = i.ctx ?? { mode: 'list', defaultDueAt: startOfLocalDay(now).toISOString() }
  const date: DraftDate = { active, dueAt: parsed.dueAt, allDay: parsed.allDay, rrule: parsed.rrule ?? null, title: dateTitle }
  const resolved = resolveDraft({ text: i.text, desc: i.desc, date, tokens, manual: i.manual, projectId: project?.id ?? '', ctx })
  const schedule = draftSchedule(date, i.manual, ctx)
  return {
    live,
    spans,
    title: (tokens ? tokens.title : dateTitle).trim(),
    projectId: project?.id ?? null,
    assigneeId: i.manual.assigneeId !== undefined ? i.manual.assigneeId : tokens?.assigneeId ?? null,
    urgent: i.manual.urgent ?? tokens?.urgent ?? false,
    unknown: tokens?.unknown ?? [],
    dueAt: schedule.dueAt,
    allDay: schedule.allDay,
    rrule: schedule.rrule,
    remindAt: reminderAt(schedule.dueAt, defaultReminder(schedule.allDay)),
    issue: 'error' in resolved ? null : resolved,
    error: 'error' in resolved ? resolved.error : null,
  }
}
