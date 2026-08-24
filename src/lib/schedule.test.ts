import { describe, expect, it } from 'vitest'
import {
  NO_SCHEDULE, buildSmartLists, compareDue, dayOffset, defaultReminder, fromInputs, isOverdue,
  reminderAt, reminderKindOf, smartListRange, startOfLocalDay, toDateInput, toTimeInput,
  toDisplayDate, fromDisplayDate, maskDateInput, displayFromInputDate,
  maskTimeInput, fromTimeText,
} from './schedule'
import type { Issue } from './types'

// Luni, 24 august 2026, 08:40 local.
const NOW = new Date(2026, 7, 24, 8, 40)

/** Scadență în ziua locală `off`, la ora dată. Fără oră = toată ziua. */
function at(off: number, h?: number, m = 0): { dueAt: string; allDay: boolean } {
  const d = new Date(2026, 7, 24 + off, h ?? 0, m, 0, 0)
  return { dueAt: d.toISOString(), allDay: h === undefined }
}

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'p', title: id, desc: '', theme: '', wave: 1, deps: [], done: false,
    selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false,
    ...NO_SCHEDULE, ...patch,
  }
}

describe('dayOffset', () => {
  it('numără zile locale, nu intervale de 24h', () => {
    expect(dayOffset(at(0, 23, 59).dueAt, NOW)).toBe(0)
    expect(dayOffset(at(1, 0, 1).dueAt, NOW)).toBe(1)
    expect(dayOffset(at(-1, 12).dueAt, NOW)).toBe(-1)
    expect(dayOffset(at(7).dueAt, NOW)).toBe(7)
  })

  it('trecerea la ora de vară nu deplasează ziua', () => {
    // În România ceasul se dă înainte în ultima duminică din martie: 29.03.2026.
    const beforeDst = new Date(2026, 2, 28, 12, 0)
    const afterDst = new Date(2026, 2, 30, 12, 0).toISOString()
    expect(dayOffset(afterDst, beforeDst)).toBe(2)
  })
})

describe('isOverdue', () => {
  it('o sarcină cu oră e restantă abia după ora ei', () => {
    expect(isOverdue(task('a', at(0, 8)), NOW)).toBe(true)
    expect(isOverdue(task('b', at(0, 9)), NOW)).toBe(false)
  })

  it('o sarcină de zi întreagă NU e restantă în ziua ei', () => {
    // Miezul nopții a trecut, dar ziua e în curs — altfel ar fi restantă de la 00:00.
    expect(isOverdue(task('c', at(0)), NOW)).toBe(false)
    expect(isOverdue(task('d', at(-1)), NOW)).toBe(true)
  })

  it('bifată sau fără scadență nu poate fi restantă', () => {
    expect(isOverdue(task('e', { ...at(-3, 9), done: true }), NOW)).toBe(false)
    expect(isOverdue(task('f'), NOW)).toBe(false)
  })
})

describe('buildSmartLists', () => {
  const issues = [
    task('late-1', at(-2, 12)),
    task('late-2', at(-1)),
    task('today-allday', at(0)),
    task('today-14', at(0, 14)),
    task('today-16', at(0, 16, 30)),
    task('today-done', { ...at(0, 9), done: true }),
    task('tmr', at(1, 9)),
    task('day6', at(6, 10)),
    task('day7-outside', at(7, 10)),
    task('no-due'),
  ]
  const L = buildSmartLists(issues, NOW)

  it('restanțele stau NUMAI în overdue', () => {
    expect(L.overdue.map((i) => i.id)).toEqual(['late-1', 'late-2'])
    expect(L.today.map((i) => i.id)).not.toContain('late-1')
    expect(L.week.flatMap((d) => d.issues.map((i) => i.id))).not.toContain('late-1')
  })

  it('ziua fără oră urcă deasupra celor cu oră', () => {
    expect(L.today.map((i) => i.id)).toEqual(['today-allday', 'today-14', 'today-16'])
  })

  it('mâine e ziua 1, iar fereastra se închide la a șaptea zi', () => {
    expect(L.tomorrow.map((i) => i.id)).toEqual(['tmr'])
    expect(L.week).toHaveLength(7)
    expect(L.week[6].issues.map((i) => i.id)).toEqual(['day6'])
    expect(L.week.flatMap((d) => d.issues.map((i) => i.id))).not.toContain('day7-outside')
  })

  it('bifatele de azi sunt separate, nu în today', () => {
    expect(L.doneToday.map((i) => i.id)).toEqual(['today-done'])
    expect(L.today.map((i) => i.id)).not.toContain('today-done')
  })

  it('un tichet fără scadență nu apare nicăieri', () => {
    const all = [...L.overdue, ...L.doneToday, ...L.week.flatMap((d) => d.issues)]
    expect(all.map((i) => i.id)).not.toContain('no-due')
  })
})

describe('compareDue', () => {
  it('ziua bate regula „fără oră întâi" — o restanță veche cu oră rămâne prima', () => {
    const older = task('older', at(-3, 12))
    const newerAllDay = task('newer', at(-1))
    expect([newerAllDay, older].sort(compareDue).map((i) => i.id)).toEqual(['older', 'newer'])
  })

  it('la aceeași scadență, urgentul urcă', () => {
    const a = task('a', at(0, 14))
    const b = task('b', { ...at(0, 14), urgent: true })
    expect([a, b].sort(compareDue).map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('smartListRange', () => {
  it('cere șapte zile în viitor și bifatele doar de azi', () => {
    const r = smartListRange(NOW)
    expect(r.to).toBe(new Date(2026, 7, 31).toISOString())
    expect(r.doneFrom).toBe(startOfLocalDay(NOW).toISOString())
  })
})

describe('inputurile native', () => {
  it('fac dus-întors fără să piardă ziua locală', () => {
    const { dueAt, allDay } = fromInputs('2026-08-24', '14:30')
    expect(allDay).toBe(false)
    expect(toDateInput(dueAt!)).toBe('2026-08-24')
    expect(toTimeInput(dueAt!)).toBe('14:30')
  })

  it('ora goală înseamnă toată ziua, la 00:00 local', () => {
    const { dueAt, allDay } = fromInputs('2026-08-24', '')
    expect(allDay).toBe(true)
    expect(new Date(dueAt!).getHours()).toBe(0)
    expect(toDateInput(dueAt!)).toBe('2026-08-24')
  })

  it('fără dată nu există scadență, oricâtă oră ar fi scrisă', () => {
    expect(fromInputs('', '14:30')).toEqual({ dueAt: null, allDay: true })
  })
})

describe('memento', () => {
  it('cu oră sună la scadență, de zi întreagă nu sună singur', () => {
    expect(defaultReminder(false)).toBe('due')
    expect(defaultReminder(true)).toBe('none')
  })

  it('offset-urile fac dus-întors', () => {
    const { dueAt } = fromInputs('2026-08-25', '09:00')
    for (const kind of ['due', 'm30', 'd1'] as const) {
      expect(reminderKindOf(dueAt, reminderAt(dueAt, kind))).toBe(kind)
    }
    expect(reminderAt(dueAt, 'none')).toBeNull()
    expect(reminderKindOf(dueAt, null)).toBe('none')
  })

  it('fără scadență nu există memento', () => {
    expect(reminderAt(null, 'due')).toBeNull()
  })
})

describe('data în forma zz/ll/aaaa', () => {
  it('dus-întors', () => {
    const iso = new Date(2026, 7, 24, 15, 0).toISOString()
    expect(toDisplayDate(iso)).toBe('24/08/2026')
    expect(fromDisplayDate('24/08/2026')).toBe('2026-08-24')
    expect(displayFromInputDate('2026-08-24')).toBe('24/08/2026')
  })

  it('o dată incompletă nu e o dată', () => {
    for (const bad of ['', '24', '24/08', '24/08/20', 'zz/ll/aaaa', '2026/08/24']) {
      expect(fromDisplayDate(bad)).toBeNull()
    }
  })

  it('respinge datele care nu există în calendar', () => {
    // Aici greșește o verificare naivă: JS mută 31 februarie pe 3 martie fără să
    // se plângă, deci „acceptat" ar însemna „salvat cu altă zi".
    expect(fromDisplayDate('31/02/2026')).toBeNull()
    expect(fromDisplayDate('32/01/2026')).toBeNull()
    expect(fromDisplayDate('01/13/2026')).toBeNull()
    // 2028 e bisect, 2026 nu.
    expect(fromDisplayDate('29/02/2026')).toBeNull()
    expect(fromDisplayDate('29/02/2028')).toBe('2028-02-29')
  })

  it('masca pune barele și taie ce nu e cifră', () => {
    expect(maskDateInput('2')).toBe('2')
    expect(maskDateInput('24')).toBe('24/')
    expect(maskDateInput('2408')).toBe('24/08/')
    expect(maskDateInput('24082026')).toBe('24/08/2026')
    expect(maskDateInput('24/08/2026')).toBe('24/08/2026')
    expect(maskDateInput('2a4-b08')).toBe('24/08/')
    // Nu se scurge peste anul de patru cifre.
    expect(maskDateInput('240820261234')).toBe('24/08/2026')
  })

  it('acceptă și cratime sau puncte la lipit, dar afișează cu bare', () => {
    expect(fromDisplayDate('24-08-2026')).toBe('2026-08-24')
    expect(fromDisplayDate('24.08.2026')).toBe('2026-08-24')
    expect(maskDateInput('24-08-2026')).toBe('24/08/2026')
  })

  it('nu completează cifrele: primul 1 nu devine 01, altfel ziua 14 e imposibilă', () => {
    expect(maskDateInput('1')).toBe('1')
    expect(maskDateInput('14')).toBe('14/')
  })

  it('ștergerea nu reintroduce bara peste care ai dat backspace', () => {
    // Utilizatorul a șters bara: rămân două cifre, deci masca o pune înapoi —
    // dar dacă mai șterge o cifră, nu revine.
    expect(maskDateInput('240')).toBe('24/0')
    expect(maskDateInput('24')).toBe('24/')
    expect(maskDateInput('2')).toBe('2')
  })
})

describe('ora în forma hh:mm', () => {
  it('masca pune două puncte și taie ce nu e cifră', () => {
    expect(maskTimeInput('1')).toBe('1')
    expect(maskTimeInput('15')).toBe('15:')
    expect(maskTimeInput('1530')).toBe('15:30')
    expect(maskTimeInput('15:30')).toBe('15:30')
    expect(maskTimeInput('15h30m99')).toBe('15:30')
    expect(maskTimeInput('3 PM')).toBe('3')
  })

  it('validează 24 de ore, nu 12', () => {
    expect(fromTimeText('15:30')).toBe('15:30')
    expect(fromTimeText('9:05')).toBe('09:05')
    expect(fromTimeText('00:00')).toBe('00:00')
    expect(fromTimeText('23:59')).toBe('23:59')
  })

  it('respinge orele care nu există', () => {
    // 24:00 ar fi ziua următoare — nu-l salvăm ca oră a zilei curente.
    for (const bad of ['24:00', '25:00', '12:60', '', '15', '15:3', 'hh:mm']) {
      expect(fromTimeText(bad)).toBeNull()
    }
  })
})
