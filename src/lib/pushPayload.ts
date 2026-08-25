// Contractul dintre serverul care trimite mementoul și service worker-ul care
// îl arată. Pur, ca să fie testabil: în service worker nu se poate intra cu
// depanatorul, iar un memento greșit se vede o singură dată, la ora nepotrivită.
//
// Serverul (supabase/functions/send-reminders) trimite EXACT `ReminderPayload`.
// Service worker-ul nu interpretează nimic altceva: orice câmp lipsă are un
// comportament definit mai jos, fiindcă un push malformat n-are voie să lase
// utilizatorul fără notificare (sau, mai rău, cu una goală).

export interface ReminderPayload {
  /** Id-ul tichetului, ex. `EX-03`. Devine adâncimea link-ului și `tag`-ul. */
  id: string
  title: string
  /** ISO. Absent = sarcină fără oră. */
  dueAt?: string | null
  allDay?: boolean
  projectName?: string
  /**
   * Cheia care lasă workerul să rezolve „Gata"/„Amână" fără nicio filă deschisă.
   * Absentă = comportamentul vechi (prin pagină, sau deschide tichetul).
   * Formatul și de ce e sigur: `supabase/functions/_shared/reminderToken.ts`.
   */
  actionToken?: string
  /** Adresa absolută a funcției care acceptă tokenul. Serverul o știe, workerul nu. */
  actionUrl?: string
}

export interface NotificationPlan {
  title: string
  body: string
  /** Adresa deschisă la click — deep link-ul existent al aplicației. */
  url: string
  /**
   * Două mementouri pentru aceeași sarcină se ÎNLOCUIESC, nu se adună: `tag`
   * e id-ul tichetului. Altfel un cron care repetă din orice motiv ar umple
   * bara de notificări cu același rând.
   */
  tag: string
  actions: { action: 'done' | 'snooze'; title: string }[]
  /**
   * Cererea pe care workerul o face când nu există nicio filă. `null` dacă
   * serverul n-a trimis token — atunci se cade pe deschiderea tichetului.
   */
  request: ActionRequest | null
}

/** Ce trimite workerul către `reminder-action`. Pur, ca să fie testabil. */
export interface ActionRequest {
  url: string
  token: string
  id: string
}

/**
 * Cât amână butonul „Amână". Aici, ca serverul și clientul să spună la fel —
 * eticheta butonului se construiește din constantă exact ca să nu poată minți.
 *
 * Cinci, nu zece: o amânare e „nu acum, imediat". Cronul rulează la fiecare
 * minut (`supabase/migration-cron.sql`), deci întârzierea până la reapariție e
 * de ordinul unui minut peste ce scrie pe buton — acceptabil la cinci.
 */
export const SNOOZE_MINUTES = 5

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Ce scrie notificarea. Ora se formatează în fusul DISPOZITIVULUI, nu al
 * serverului: mementoul e citit de un om care se uită la ceasul lui.
 */
export function planNotification(p: ReminderPayload): NotificationPlan {
  const title = p.title?.trim() || 'Sarcină fără titlu'
  const parts: string[] = []
  if (p.dueAt && !p.allDay) {
    const d = new Date(p.dueAt)
    if (!Number.isNaN(d.getTime())) parts.push(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }
  if (p.projectName) parts.push(p.projectName)
  return {
    title,
    // Un corp gol lasă notificarea să arate ruptă pe unele platforme; id-ul e
    // întotdeauna disponibil și e informație reală.
    body: parts.length ? parts.join(' · ') : p.id,
    url: `/${p.id}`,
    tag: p.id,
    actions: [
      { action: 'done', title: 'Gata' },
      { action: 'snooze', title: `Amână ${SNOOZE_MINUTES} min` },
    ],
    request: p.actionToken && p.actionUrl
      ? { url: p.actionUrl, token: p.actionToken, id: p.id }
      : null,
  }
}

/** Mesajul pe care service worker-ul îl trimite paginii pentru butoanele notificării. */
export interface ReminderActionMessage {
  type: 'reminder-action'
  action: 'done' | 'snooze'
  id: string
}

export function isReminderAction(data: unknown): data is ReminderActionMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  return m.type === 'reminder-action'
    && (m.action === 'done' || m.action === 'snooze')
    && typeof m.id === 'string' && m.id.length > 0
}

/**
 * Mesajul trimis paginii când sosește un memento și fila e VIZIBILĂ.
 *
 * Există pentru sunet, și numai pentru sunet. Notificările web nu pot avea sunet
 * propriu: câmpul `sound` a rămas în draftul de spec și niciun browser nu l-a
 * implementat. Cu aplicația închisă auzi sunetul sistemului și nu se poate
 * schimba. Cu o filă deschisă, pagina poate cânta ea — de asta workerul o
 * anunță, iar notificarea pleacă `silent` (vezi `src/sw.ts`): altfel s-ar auzi
 * de două ori, sunetul sistemului peste al nostru, adică mai rău decât înainte.
 */
export interface ReminderArrivedMessage {
  type: 'reminder-arrived'
  id: string
}

export function isReminderArrived(data: unknown): data is ReminderArrivedMessage {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  return m.type === 'reminder-arrived' && typeof m.id === 'string' && m.id.length > 0
}

// ── „poate pagina să cânte?" ────────────────────────────────────────────────
//
// Workerul are nevoie de răspuns înainte de a face notificarea mută, fiindcă
// costul unei greșeli e asimetric: un „nu" greșit dă două sunete (al sistemului
// peste al nostru), enervant; un „da" greșit dă LINIȘTE, adică mementoul ratat
// — exact defectul pe care toată mașinăria asta există ca să-l prevină.
//
// PRIMA VARIANTĂ, care nu funcționează, ca să nu fie rescrisă: workerul întreba
// pagina la sosirea mementoului și aștepta răspunsul. Nici pe un `MessagePort`
// atașat întrebării, nici printr-un mesaj separat cu `nonce` pe canalul obișnuit.
// Cauza, măsurată cu `npm run test:chime`: **cât timp promisiunea dată lui
// `waitUntil` din `push` e în așteptare, workerul nu primește evenimente
// `message`.** Pagina răspundea (verificat interceptând `postMessage`), dar
// răspunsul nu era livrat nici după trei secunde. Orice formă de întrebare-și-
// răspuns în timpul unui `push` se blochează identic.
//
// DECI: pagina ANUNȚĂ din timp, workerul doar citește. Anunțul e o intrare în
// `Cache`, singura memorie la care ajung amândoi și care supraviețuiește
// repornirii workerului.
//
// Ce ține minciuna sub control — pagina ȘTERGE intrarea la fiecare pornire,
// înainte de orice deblocare. Un refresh fără niciun click lasă deci intrarea
// ștearsă, iar notificarea sună normal. O filă închisă nu mai e vizibilă, și
// workerul cere ambele: intrarea prezentă ȘI o filă vizibilă.

/** Numele cache-ului. Separat de precache, ca `cleanupOutdatedCaches` să nu-l atingă. */
export const CHIME_READY_CACHE = 'horizontal-chime-v1'

/** Cheia din cache. O cerere fictivă — contează doar prezența ei. */
export const CHIME_READY_KEY = '/__chime-ready'
