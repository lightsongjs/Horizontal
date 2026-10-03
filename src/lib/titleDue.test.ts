import { describe, expect, it } from 'vitest'
import { parseDue } from './parseDue'
import { mergeTitleDue, type DueState } from './titleDue'
import { toDateInput, toTimeInput } from './schedule'

// Luni, 24 august 2026, 18:40 local — după 17, ca „la 17" să se rostogolească
// pe mâine la adăugarea rapidă, iar aici să NU.
const NOW = new Date(2026, 7, 24, 18, 40)
const iso = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()
const at = (s: string | null) => (s ? `${toDateInput(s)} ${toTimeInput(s)}` : null)

const NONE: DueState = { dueAt: null, allDay: true, remindAt: null, rrule: null }
/** Joi 27 aug, toată ziua, fără memento. */
const THU_ALLDAY: DueState = { dueAt: iso(2026, 8, 27), allDay: true, remindAt: null, rrule: null }
/** Joi 27 aug 10:00, memento cu 30 min înainte. */
const THU_10: DueState = { dueAt: iso(2026, 8, 27, 10), allDay: false, remindAt: iso(2026, 8, 27, 9, 30), rrule: null }
const DAILY_9: DueState = { dueAt: iso(2026, 8, 25, 9), allDay: false, remindAt: iso(2026, 8, 25, 9), rrule: 'FREQ=DAILY' }

/**
 * Tabelul de cazuri. Un caz nou se adaugă aici, nu într-un `it` separat —
 * ca toate regulile să se citească una sub alta.
 */
const FIXTURES: {
  name: string
  existing: DueState
  text: string
  due: string | null
  allDay: boolean
  remind: string | null
  rrule: string | null
}[] = [
  { name: 'fără scadență, numai oră → regula adăugării rapide (rostogolire pe mâine)',
    existing: NONE, text: 'ședință la 17', due: '2026-08-25 17:00', allDay: false, remind: '2026-08-25 17:00', rrule: null },
  { name: 'fără scadență, numai zi → zi întreagă, fără memento',
    existing: NONE, text: 'ședință mâine', due: '2026-08-25 00:00', allDay: true, remind: null, rrule: null },
  { name: 'zi întreagă + oră → aceeași zi, cu oră, memento implicit la scadență',
    existing: THU_ALLDAY, text: 'ședință la 17', due: '2026-08-27 17:00', allDay: false, remind: '2026-08-27 17:00', rrule: null },
  { name: 'cu oră + altă oră → aceeași zi, decalajul mementoului rămâne',
    existing: THU_10, text: 'ședință la 17', due: '2026-08-27 17:00', allDay: false, remind: '2026-08-27 16:30', rrule: null },
  { name: 'cu oră + numai zi → zi nouă, ora rămâne',
    existing: THU_10, text: 'ședință mâine', due: '2026-08-25 10:00', allDay: false, remind: '2026-08-25 09:30', rrule: null },
  { name: 'zi întreagă + numai zi → zi nouă, tot zi întreagă',
    existing: THU_ALLDAY, text: 'ședință vineri', due: '2026-08-28 00:00', allDay: true, remind: null, rrule: null },
  { name: 'zi și oră → înlocuiește',
    existing: THU_10, text: 'ședință mâine la 8', due: '2026-08-25 08:00', allDay: false, remind: '2026-08-25 07:30', rrule: null },
  { name: 'recurentă + oră → toată seria la noua oră, `rrule` rămâne',
    existing: DAILY_9, text: 'sala la 7', due: '2026-08-25 07:00', allDay: false, remind: '2026-08-25 07:00', rrule: 'FREQ=DAILY' },
  { name: 'recurentă + zi → mută doar apariția curentă, `rrule` rămâne',
    existing: DAILY_9, text: 'sala poimâine', due: '2026-08-26 09:00', allDay: false, remind: '2026-08-26 09:00', rrule: 'FREQ=DAILY' },
  { name: 'numai recurență pe un tichet cu scadență → scadența rămâne, se pune repetarea',
    existing: THU_10, text: 'raport zilnic', due: '2026-08-27 10:00', allDay: false, remind: '2026-08-27 09:30', rrule: 'FREQ=DAILY' },
  { name: 'recurență care numește ziua → prima apariție, ora rămâne',
    existing: THU_10, text: 'raport vinerea', due: '2026-08-28 10:00', allDay: false, remind: '2026-08-28 09:30', rrule: 'FREQ=WEEKLY;BYDAY=FR' },
  { name: '„peste 2 ore" are și zi, și oră → înlocuiește',
    existing: THU_ALLDAY, text: 'sună peste 2 ore', due: '2026-08-24 20:40', allDay: false, remind: '2026-08-24 20:40', rrule: null },
]

describe('mergeTitleDue', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const r = mergeTitleDue(f.existing, parseDue(f.text, NOW))
      expect({ due: at(r.dueAt), allDay: r.allDay, remind: at(r.remindAt), rrule: r.rrule })
        .toEqual({ due: f.due, allDay: f.allDay, remind: f.remind, rrule: f.rrule })
    })
  }

  it('fără dată recunoscută → scadența neatinsă', () => {
    expect(mergeTitleDue(THU_10, parseDue('ședință', NOW))).toEqual(THU_10)
  })
})

describe('parseDue — ce a fost SCRIS (hasDay/hasTime)', () => {
  const flags = (t: string) => {
    const r = parseDue(t, NOW)
    return [r.hasDay, r.hasTime]
  }
  it('numai oră', () => expect(flags('x la 17')).toEqual([false, true]))
  it('numai oră, rostogolită pe mâine — tot fără zi', () => {
    const r = parseDue('x la 8', NOW)
    expect(toDateInput(r.dueAt!)).toBe('2026-08-25')
    expect([r.hasDay, r.hasTime]).toEqual([false, true])
  })
  it('numai zi', () => expect(flags('x mâine')).toEqual([true, false]))
  it('zi și oră', () => expect(flags('x vineri la 9')).toEqual([true, true]))
  it('decalaj în ore = zi și oră', () => expect(flags('x peste 3 ore')).toEqual([true, true]))
  it('recurență fără zi', () => expect(flags('x zilnic')).toEqual([false, false]))
  it('recurență care numește ziua', () => expect(flags('x joia')).toEqual([true, false]))
  it('nimic', () => expect(flags('x')).toEqual([false, false]))
})

describe('dateFragments — ce e deja în titlu la deschidere', () => {
  it('toate fragmentele, ca refuzate', async () => {
    const { dateFragments, maskRejected } = await import('./parseDue')
    const t = 'Ședință la 17 mâine'
    const frags = dateFragments(t, NOW)
    expect(frags.sort()).toEqual(['la 17', 'mâine'].sort())
    expect(parseDue(maskRejected(t, frags), NOW).dueAt).toBeNull()
  })
  it('fără dată → nimic', async () => {
    const { dateFragments } = await import('./parseDue')
    expect(dateFragments('Ședință', NOW)).toEqual([])
  })
})
