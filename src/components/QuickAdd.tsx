import { useEffect, useRef, useState } from 'react'
import { useHorizontal } from '../store'
import { useWritableProjects } from '../hooks'
import { parseDue } from '../lib/parseDue'
import { dayOffset, defaultReminder, reminderAt, toDisplayDate, toTimeInput } from '../lib/schedule'

const LAST_PROJECT_KEY = 'horizontal:last-task-project'
const DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm']

/**
 * Ce scrie jetonul de scadență.
 *
 * Pentru zilele apropiate, cuvântul e mai clar decât cifrele: „Azi 15:00" se
 * citește dintr-o privire, „24-08-2026 15:00" cere o secundă de socoteală.
 * Mai departe de mâine, data numerică e cea neambiguă — cu ziua săptămânii
 * înaintea ei, fiindcă întrebarea reală e adesea „în ce zi cade?".
 */
function dueLabel(iso: string, allDay: boolean, now: Date): string {
  const off = dayOffset(iso, now)
  const day =
    off === 0 ? 'Azi'
      : off === 1 ? 'Mâine'
        : off === -1 ? 'Ieri'
          : `${DAYS[new Date(iso).getDay()]} ${toDisplayDate(iso)}`
  return allDay ? day : `${day} ${toTimeInput(iso)}`
}

interface Props {
  /** Scadența implicită când textul nu conține niciuna (ziua listei deschise). */
  defaultDueAt: string
  onAdded?(): void
  /** Se schimbă la fiecare cerere de focus din afară (butonul „+" din bara de jos). */
  focusSignal?: number
}

/**
 * Rândul de adăugare rapidă. Parsează data din titlu pe măsură ce se scrie și
 * o arată în două locuri: fragmentul recunoscut, evidențiat CHIAR ÎN input
 * printr-un strat-oglindă poziționat identic, și un jeton cu ce a înțeles, cu
 * un × care îl respinge.
 *
 * Fără cele două, un parser bun devine dușman la primul „Întâlnire la Podul 5":
 * userul trebuie să vadă ce s-a interpretat înainte să apese Enter, și să poată
 * spune nu.
 *
 * Fără Inbox, fiecare sarcină are un proiect — de asta rândul poartă un
 * selector care ține minte ultima alegere.
 */
export function QuickAdd({ defaultDueAt, onAdded, focusSignal = 0 }: Props) {
  const { createIssue } = useHorizontal()
  // Numai proiectele în care se poate scrie: un selector care oferă un proiect
  // read-only ar produce o salvare respinsă de RLS, după ce userul a scris tot.
  const projects = useWritableProjects()
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  // Data recunoscută a fost respinsă manual pentru textul curent. Se resetează
  // la orice tastă: o nouă intenție merită o nouă propunere.
  const [rejected, setRejected] = useState(false)
  const [shake, setShake] = useState(false)
  // Mausul stă peste fragmentul evidențiat. Numai pentru cursor și pentru
  // culoarea de „asta dispare dacă apeși" — atingerea pe telefon n-are hover.
  const [onDate, setOnDate] = useState(false)
  // Indiciul care spune că evidențierea se poate refuza cu o atingere. Apare o
  // dată, la prima recunoaștere, și pleacă singur: e o instrucțiune, nu o stare.
  const [tip, setTip] = useState(false)
  const [saving, setSaving] = useState(false)
  const [projectId, setProjectId] = useState<string>(() => {
    const saved = localStorage.getItem(LAST_PROJECT_KEY)
    return saved ?? ''
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLSpanElement>(null)

  // Focus cerut din afară. Sare peste primul randare (`focusSignal` 0) ca
  // deschiderea listei să nu ridice tastatura pe telefon nechemată.
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus()
  }, [focusSignal])

  const project = projects.find((p) => p.id === projectId)
    ?? projects.find((p) => p.type === 'personal')
    ?? projects[0]

  const parsed = parseDue(text)
  const useParsed = !rejected && parsed.dueAt !== null

  // Indiciul apare când recunoașterea se aprinde și pleacă singur. Depinde de
  // TRECEREA în „am înțeles ceva", nu de fiecare tastă: altfel ar sta lipit pe
  // ecran cât timp scrii, adică exact peste textul pe care îl citești.
  useEffect(() => {
    if (!useParsed) return
    setTip(true)
    const t = setTimeout(() => setTip(false), 4200)
    return () => clearTimeout(t)
  }, [useParsed])
  const dueAt = useParsed ? parsed.dueAt! : defaultDueAt
  const allDay = useParsed ? parsed.allDay : true
  const title = (rejected ? text : parsed.title).trim()
  // Text numai-dată: „azi la 8" n-are ce să salveze.
  const bare = text.trim() !== '' && title === ''

  const reset = () => { setText(''); setRejected(false); setTip(false) }

  /** „Nu e o dată." Textul rămâne întreg în titlu, scadența cade pe ziua listei. */
  const rejectDate = () => {
    setRejected(true)
    setTip(false)
    setOnDate(false)
    inputRef.current?.focus()
  }

  /**
   * Cade punctul atins pe un fragment evidențiat?
   *
   * Se măsoară dreptunghiurile REALE ale marcajelor din oglindă, nu poziția
   * cursorului din input: un click la marginea fragmentului pune cursorul exact
   * pe graniță, iar „înainte" și „după" nu se pot deosebi din indice. Geometria
   * știe, fiindcă oglinda desenează chiar textul pe care îl vede omul.
   */
  const hitsDate = (x: number, y: number) => {
    const marks = mirrorRef.current?.querySelectorAll('mark')
    if (!marks) return false
    return Array.from(marks).some((el) => {
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    })
  }

  const submit = async () => {
    if (saving || !project) return
    if (!text.trim()) return
    if (bare) { setShake(true); setTimeout(() => setShake(false), 320); return }
    setSaving(true)
    try {
      await createIssue({
        projectId: project.id,
        title,
        dueAt,
        allDay,
        remindAt: reminderAt(dueAt, defaultReminder(allDay)),
        rrule: useParsed ? parsed.rrule : null,
      })
      localStorage.setItem(LAST_PROJECT_KEY, project.id)
      reset()
      onAdded?.()
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  if (!project) {
    // Fie nu există niciun proiect, fie userul e read-only în toate. Ambele
    // înseamnă același lucru aici: nu se poate adăuga nimic.
    return (
      <p className="qa-noproject">
        O sarcină are nevoie de un proiect în care poți scrie.
      </p>
    )
  }

  // Straturile: oglinda desenează evidențierea, inputul stă transparent deasupra.
  const spans = useParsed ? parsed.spans : []
  const pieces: { text: string; mark: boolean }[] = []
  let at = 0
  for (const [s, e] of spans) {
    if (s > at) pieces.push({ text: text.slice(at, s), mark: false })
    pieces.push({ text: text.slice(s, e), mark: true })
    at = e
  }
  if (at < text.length) pieces.push({ text: text.slice(at), mark: false })

  return (
    <div className={`qa ${focus ? 'focus' : ''} ${shake ? 'shake' : ''}`}>
      <div className="qa-row">
        <span className="qa-plus" aria-hidden="true">+</span>
        <span
          className={`qa-wrap ${onDate ? 'on-date' : ''}`}
          // Titlul stă pe înveliș, nu pe input: inputul e transparent și acoperă
          // tot rândul, deci un `title` pe el ar explica „atinge ca să anulezi"
          // și acolo unde nu e nicio dată de anulat.
          title={onDate ? 'Nu e o dată — atinge ca să rămână text în titlu' : undefined}
        >
          {tip && (
            <span className="qa-tip" role="status">
              Am recunoscut o dată — atinge fragmentul evidențiat ca să o anulezi.
            </span>
          )}
          <span className="qa-mirror" ref={mirrorRef} aria-hidden="true">
            {pieces.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          </span>
          <input
            ref={inputRef}
            className="qa-input"
            value={text}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Adaugă o sarcină… încearcă „mâine la 9”"
            onChange={(e) => { setText(e.target.value); setRejected(false) }}
            onFocus={() => setFocus(true)}
            onBlur={() => { setFocus(false); setOnDate(false) }}
            // O atingere PE fragmentul recunoscut înseamnă „nu e o dată".
            // `pointerdown`, nu `click`: pe telefon degetul ridicat mai la
            // stânga ar rata marcajul pe care a apăsat.
            onPointerDown={(e) => {
              if (useParsed && hitsDate(e.clientX, e.clientY)) rejectDate()
            }}
            // Numai maus: pe atingere n-are ce să însemne „stau deasupra", iar
            // un `pointermove` de la deget ar aprinde culoarea de refuz cu o
            // clipă înainte ca refuzul să se întâmple oricum.
            onPointerMove={(e) => {
              if (e.pointerType !== 'mouse') return
              const over = useParsed && hitsDate(e.clientX, e.clientY)
              if (over !== onDate) setOnDate(over)
            }}
            onPointerLeave={() => { if (onDate) setOnDate(false) }}
            // Oglinda nu se derulează singură: fără asta, evidențierea rămâne
            // în urmă la un titlu mai lung decât inputul.
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submit() }
              else if (e.key === 'Escape' && text) { e.preventDefault(); reset() }
            }}
          />
        </span>
      </div>

      {text.trim() !== '' && (
        <div className="qa-meta">
          <span className="chip date">
            <span className="chip-ico" aria-hidden="true">▤</span>
            {dueLabel(dueAt, allDay, new Date())}
            {useParsed && (
              <button
                className="chip-x"
                title="Nu e o dată — lasă textul în titlu"
                aria-label="Respinge data recunoscută"
                onClick={rejectDate}
              >
                ✕
              </button>
            )}
          </span>

          {!allDay && (
            <span className="chip bell">
              <span className="chip-ico" aria-hidden="true">◔</span> memento la oră
            </span>
          )}

          {useParsed && parsed.rrule && (
            <span className="chip">↻ {parsed.rrule === 'FREQ=DAILY' ? 'zilnic' : 'săptămânal'}</span>
          )}

          <label className="qa-proj" title="Proiectul sarcinii">
            <span className="t-dot" style={{ background: project.accent }} />
            <select
              value={project.id}
              onChange={(e) => { setProjectId(e.target.value); localStorage.setItem(LAST_PROJECT_KEY, e.target.value) }}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <span className={`qa-hint ${bare ? 'warn' : ''}`}>
            {bare ? 'și ce ai de făcut?' : saving ? 'se salvează…' : <><kbd>↵</kbd> adaugă</>}
          </span>
        </div>
      )}
    </div>
  )
}
