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
}

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
      { action: 'snooze', title: 'Amână 10 min' },
    ],
  }
}

/** Cât amână butonul „Amână". Aici, ca serverul și clientul să spună la fel. */
export const SNOOZE_MINUTES = 10

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
