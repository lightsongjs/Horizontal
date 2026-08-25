import { useEffect } from 'react'
import { parseDue } from '../lib/parseDue'
import { dayOffset, toDisplayDate, toTimeInput } from '../lib/schedule'

/**
 * Panoul de referință (Ctrl+,): ce scurtături există și ce înțelege
 * recunoașterea datei.
 *
 * Tabelul de exemple NU e scris de mână — se calculează la randare, cu
 * `parseDue`, față de ora curentă. Un tabel scris ar rămâne în urmă la prima
 * schimbare a parserului și ar începe să mintă exact în locul în care oamenii
 * vin să afle adevărul. Așa, dacă parserul se schimbă, panoul se schimbă cu el.
 */

interface Group {
  title: string
  note?: string
  examples: string[]
}

const GROUPS: Group[] = [
  {
    title: 'Ziua',
    examples: ['azi', 'mâine', 'poimâine', 'vineri', 'luni viitoare', 'tomorrow', 'peste 2 zile'],
  },
  {
    title: 'De acum înainte',
    note: 'Cantitatea poate fi scrisă în litere.',
    examples: ['in 5 min', 'peste 20 de minute', 'in 1 hour', 'in 3 hours', 'într-o oră', 'in an hour'],
  },
  {
    title: 'Ora',
    note: 'Fără zi, o oră care a trecut înseamnă mâine.',
    examples: ['la 14:00', 'la 14', 'ora 9', 'at 1500', 'la 0830', '9am', 'at 5pm', 'at 8 am'],
  },
  {
    title: 'Recurență',
    note: 'Se recunoaște și se salvează; motorul care o repetă vine mai târziu.',
    examples: ['în fiecare luni', 'zilnic'],
  },
  {
    title: 'Ce NU e o dată',
    note: 'Cazurile în care parserul trebuie să tacă.',
    examples: ['Întâlnire la Podul 5', 'cumpără 1500 de șuruburi', 'în 5 mai', 'într-o zi', 'at 2500'],
  },
]

const SHORTCUTS: { keys: string; action: string; where?: string }[] = [
  { keys: 'Ctrl+,', action: 'Deschide panoul acesta' },
  { keys: '?', action: 'Același panou' },
  { keys: 'C', action: 'Tichet nou', where: 'în proiect' },
  { keys: 'O', action: 'Caută tichet', where: 'în proiect' },
  { keys: 'P', action: 'Proiect nou', where: 'admin' },
  { keys: '1 2 3 4', action: 'Taburile List / Cards / Graf / Teme', where: 'în proiect' },
  { keys: 'T', action: 'Tree view', where: 'în Cards' },
  { keys: 'H J K L', action: 'Navighează între tichete', where: 'în Cards / List' },
  { keys: '↵', action: 'Deschide tichetul focusat', where: 'în navigare' },
  { keys: 'Y', action: 'Copiază linkul tichetului', where: 'card deschis' },
  { keys: 'Ctrl+S', action: 'Salvează, cardul rămâne deschis', where: 'card deschis' },
  { keys: 'Ctrl+↵', action: 'Salvează și închide', where: 'card deschis' },
  { keys: 'Esc', action: 'Închide ce e deasupra' },
]

const RULES: { title: string; body: string }[] = [
  {
    title: 'Listele',
    body: 'Azi, Mâine și Next 7 days taie transversal toate proiectele. Restanțele apar NUMAI în Azi, deasupra sarcinilor zilei, și ca badge roșu în sidebar — o restanță e o problemă de azi, dar „Next 7 days" e o listă despre ce urmează.',
  },
  {
    title: 'Fără Inbox',
    body: 'Fiecare sarcină are un proiect. Rândul de adăugare rapidă ține minte ultima alegere.',
  },
  {
    title: 'Toată ziua',
    body: 'O sarcină fără oră e „cândva azi" și stă deasupra celor cu oră. Nu devine restantă la miezul nopții, ci abia a doua zi.',
  },
  {
    title: 'Mementouri',
    body: 'O sarcină cu oră sună implicit la scadență. Una de zi întreagă nu sună singură — ar suna la miezul nopții. Notificarea are „Gata" și „Amână 10 min", care se rezolvă fără să deschidă aplicația.',
  },
  {
    title: 'Data din titlu',
    body: 'În adăugarea rapidă, fragmentul recunoscut se scoate din titlu. În formularul unui tichet NOU, câmpurile se completează dar titlul rămâne cum l-ai scris — ai butonul „curăță titlul". La editarea unui tichet existent recunoașterea tace, ca o retușare de titlu să nu schimbe planificarea.',
  },
]

/** Ce a înțeles parserul, în cuvinte. */
function explain(text: string, now: Date): { title: string; due: string | null } {
  const r = parseDue(text, now)
  if (!r.dueAt) return { title: r.title, due: null }
  const off = dayOffset(r.dueAt, now)
  const day = off === 0 ? 'azi' : off === 1 ? 'mâine' : toDisplayDate(r.dueAt)
  const time = r.allDay ? '' : ` ${toTimeInput(r.dueAt)}`
  const rec = r.rrule ? (r.rrule === 'FREQ=DAILY' ? ' · zilnic' : ' · săptămânal') : ''
  return { title: r.title, due: `${day}${time}${rec}` }
}

export function InfoPanel({ onClose }: { onClose: () => void }) {
  /**
   * Escape îl închide pe EL, și numai pe el.
   *
   * Cardul de tichet are propriul ascultător de Escape pe `window`, iar un
   * `return` din alt ascultător nu-l oprește — măsurat: un Escape închidea
   * panoul ȘI cardul de dedesubt. Faza de captură rulează înaintea celor de
   * bubbling, iar `stopImmediatePropagation` oprește evenimentul de tot.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])

  const now = new Date()
  return (
    <div className="info-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Referință">
      <div className="info-card" onClick={(e) => e.stopPropagation()}>
        <div className="info-head">
          <h2>Referință</h2>
          <span className="info-now">
            calculat acum, {now.getDate()}/{String(now.getMonth() + 1).padStart(2, '0')} {toTimeInput(now.toISOString())}
          </span>
          <button className="info-close" onClick={onClose} aria-label="Închide">✕</button>
        </div>

        <div className="info-body">
          <section className="info-sec">
            <h3>Scurtături</h3>
            <table className="info-keys">
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.keys}>
                    <td className="info-kbd">
                      {s.keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}
                    </td>
                    <td>
                      {s.action}
                      {s.where && <span className="info-where"> · {s.where}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="info-sec">
            <h3>Recunoașterea datei din titlu</h3>
            <p className="info-lead">
              Scrii data în titlu, iar scadența se completează singură. Fragmentul recunoscut se
              evidențiază; o atingere pe el sau pe <strong>✕</strong> îl refuză, și atunci
              rămâne text în titlu — parserul propune, tu confirmi.
              Tabelul de mai jos e calculat acum, de parserul care rulează în aplicație.
            </p>
            {GROUPS.map((g) => (
              <div key={g.title} className="info-grp">
                <div className="info-grp-head">
                  <span className="info-grp-title">{g.title}</span>
                  {g.note && <span className="info-grp-note">{g.note}</span>}
                </div>
                <table className="info-ex">
                  <tbody>
                    {g.examples.map((ex) => {
                      const r = explain(ex, now)
                      return (
                        <tr key={ex}>
                          <td><code>{ex}</code></td>
                          <td className="info-ex-arrow" aria-hidden="true">→</td>
                          <td>
                            {r.due
                              ? <><span className="info-due">{r.due}</span>{r.title && <span className="info-title-left"> · titlu „{r.title}"</span>}</>
                              : <span className="info-none">rămâne text</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          <section className="info-sec">
            <h3>Reguli care nu se văd</h3>
            <dl className="info-rules">
              {RULES.map((r) => (
                <div key={r.title}>
                  <dt>{r.title}</dt>
                  <dd>{r.body}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
