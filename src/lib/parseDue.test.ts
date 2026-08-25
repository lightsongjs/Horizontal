import { describe, expect, it } from 'vitest'
import { maskRejected, parseDue, stripSpans } from './parseDue'
import { toDateInput, toTimeInput } from './schedule'

// Luni, 24 august 2026, 08:40 local. Toate așteptările sunt relative la ea.
const NOW = new Date(2026, 7, 24, 8, 40)

/** Scurtătură de citit: ce a înțeles parserul, în termeni omenești. */
function p(text: string) {
  const r = parseDue(text, NOW)
  return {
    title: r.title,
    date: r.dueAt ? toDateInput(r.dueAt) : null,
    time: r.dueAt && !r.allDay ? toTimeInput(r.dueAt) : null,
    rrule: r.rrule,
    spans: r.spans,
  }
}

describe('parseDue — română', () => {
  it('oră la sfârșit', () => {
    expect(p('mergi la cumpărături la 14:00')).toMatchObject({
      title: 'mergi la cumpărături', date: '2026-08-24', time: '14:00',
    })
  })

  it('zi și oră la început, titlul rămâne întreg', () => {
    expect(p('mâine la 9 du mașina la ITP')).toMatchObject({
      title: 'du mașina la ITP', date: '2026-08-25', time: '09:00',
    })
  })

  it('„la" din titlu nu e confundat cu „la ora"', () => {
    // Primul „la" e urmat de cuvinte, nu de cifre — regexul trece peste el.
    expect(p('mergi la piață la 8:30')).toMatchObject({ title: 'mergi la piață', time: '08:30' })
  })

  it('zi a săptămânii cu oră', () => {
    expect(p('vineri 18:30 cinema cu Simo')).toMatchObject({
      title: 'cinema cu Simo', date: '2026-08-28', time: '18:30',
    })
  })

  it('„luni" spus într-o luni înseamnă lunea viitoare', () => {
    expect(p('luni ședință')).toMatchObject({ title: 'ședință', date: '2026-08-31' })
  })

  it('„luni viitoare" tot atunci — nu peste două săptămâni', () => {
    expect(p('luni viitoare ședință de sprint')).toMatchObject({
      title: 'ședință de sprint', date: '2026-08-31',
    })
  })

  it('„vineri viitoare" sare peste vinerea asta', () => {
    expect(p('vineri viitoare raport')).toMatchObject({ title: 'raport', date: '2026-09-04' })
  })

  it('peste N zile', () => {
    expect(p('peste 2 zile sună la bancă')).toMatchObject({
      title: 'sună la bancă', date: '2026-08-26', time: null,
    })
  })

  it('peste N ore păstrează minutele curente', () => {
    expect(p('peste 3 ore ia pachetul')).toMatchObject({
      title: 'ia pachetul', date: '2026-08-24', time: '11:40',
    })
  })

  it('poimâine', () => {
    expect(p('plătește chiria poimâine')).toMatchObject({
      title: 'plătește chiria', date: '2026-08-26',
    })
  })

  it('„ora N"', () => {
    expect(p('marți ora 7 alergare')).toMatchObject({ title: 'alergare', date: '2026-08-25', time: '07:00' })
  })

  it('recurență + prima apariție', () => {
    expect(p('în fiecare luni raport săptămânal')).toMatchObject({
      title: 'raport săptămânal', date: '2026-08-31', rrule: 'FREQ=WEEKLY',
    })
    expect(p('zilnic bea apă')).toMatchObject({ title: 'bea apă', rrule: 'FREQ=DAILY' })
  })

  it('fără diacritice merge identic', () => {
    expect(p('maine la 9 du masina la ITP')).toMatchObject({ date: '2026-08-25', time: '09:00' })
  })
})

describe('parseDue — decalaje de la acum', () => {
  // NOW = luni 24 august 2026, 08:40.
  it('minute, română și engleză', () => {
    expect(p('mergi la baie in 5 min')).toMatchObject({
      title: 'mergi la baie', date: '2026-08-24', time: '08:45',
    })
    expect(p('peste 20 de minute sună')).toMatchObject({ title: 'sună', time: '09:00' })
    expect(p('in 10 minutes call Ana')).toMatchObject({ title: 'call Ana', time: '08:50' })
  })

  it('ore', () => {
    expect(p('ședință in 1 hour')).toMatchObject({ title: 'ședință', time: '09:40' })
    expect(p('ședință in 3 hours')).toMatchObject({ title: 'ședință', time: '11:40' })
    expect(p('peste 2 ore plecăm')).toMatchObject({ title: 'plecăm', time: '10:40' })
  })

  it('cantitatea scrisă în litere înseamnă 1', () => {
    expect(p('plecăm într-o oră')).toMatchObject({ title: 'plecăm', time: '09:40' })
    expect(p('plecăm peste o oră')).toMatchObject({ title: 'plecăm', time: '09:40' })
    expect(p('leave in an hour')).toMatchObject({ title: 'leave', time: '09:40' })
    expect(p('sună peste un minut')).toMatchObject({ title: 'sună', time: '08:41' })
  })

  it('depășirea de miezul nopții mută ziua', () => {
    const late = new Date(2026, 7, 24, 23, 50)
    const r = parseDue('culcare in 30 min', late)
    expect(toDateInput(r.dueAt!)).toBe('2026-08-25')
    expect(toTimeInput(r.dueAt!)).toBe('00:20')
  })

  it('secundele se rotunjesc, ca mementoul să sune la minut întreg', () => {
    const odd = new Date(2026, 7, 24, 10, 47, 33)
    const r = parseDue('ceva in 5 min', odd)
    expect(new Date(r.dueAt!).getSeconds()).toBe(0)
    expect(toTimeInput(r.dueAt!)).toBe('10:52')
  })

  it('un decalaj înseamnă o oră anume, deci nu e „toată ziua"', () => {
    expect(parseDue('ceva in 5 min', NOW).allDay).toBe(false)
  })

  it('„în 5 mai" rămâne o lună, nu cinci minute', () => {
    // Aici greșește un `m` prea lacom: „mai" nu e „min".
    expect(p('in 5 mai ceva')).toMatchObject({ time: null })
  })

  it('„într-o zi" rămâne idiom, nu scadență', () => {
    // În română „într-o zi" înseamnă „cândva", nu „peste o zi".
    expect(p('într-o zi o să învăț germană')).toMatchObject({
      title: 'într-o zi o să învăț germană', date: null,
    })
  })

  it('„peste o zi" e mâine', () => {
    expect(p('peste o zi ceva')).toMatchObject({ title: 'ceva', date: '2026-08-25' })
  })
})

describe('parseDue — oră militară lipită', () => {
  it('„at 1500" e 15:00, iar titlul rămâne curat', () => {
    expect(p('Pleca acasa at 1500')).toMatchObject({
      title: 'Pleca acasa', date: '2026-08-24', time: '15:00',
    })
  })

  it('merge la fel cu „la" și cu „ora"', () => {
    expect(p('Pleca acasa la 1500')).toMatchObject({ title: 'Pleca acasa', time: '15:00' })
    expect(p('ora 900 ședință')).toMatchObject({ title: 'ședință', time: '09:00' })
    expect(p('la 0830 alergare')).toMatchObject({ title: 'alergare', time: '08:30' })
  })

  it('o oră imposibilă nu devine scadență', () => {
    expect(p('at 2500 ceva')).toMatchObject({ title: 'at 2500 ceva', date: null })
    expect(p('la 1099 ceva')).toMatchObject({ date: null })
  })

  it('patru cifre FĂRĂ prefix rămân o cantitate', () => {
    // Ăsta e motivul pentru care prefixul e obligatoriu la forma lipită.
    expect(p('cumpără 1500 de șuruburi')).toMatchObject({
      title: 'cumpără 1500 de șuruburi', date: null,
    })
  })

  it('nu strică forma cu două puncte', () => {
    expect(p('at 15:00 ceva')).toMatchObject({ time: '15:00' })
  })
})

describe('parseDue — engleză', () => {
  it('tomorrow 9am', () => {
    expect(p('tomorrow 9am standup')).toMatchObject({ title: 'standup', date: '2026-08-25', time: '09:00' })
  })

  it('„at 8 am" cu spațiu, și trece pe mâine dacă ora a trecut', () => {
    // NOW e 08:40, deci 08:00 de azi e trecut.
    expect(p('at 8 am plimbare')).toMatchObject({
      title: 'plimbare', date: '2026-08-25', time: '08:00',
    })
    // Iar dacă ora e în viitor, rămâne azi.
    expect(p('at 9 am plimbare')).toMatchObject({ date: '2026-08-24', time: '09:00' })
  })

  it('at 5pm', () => {
    expect(p('at 5pm call with Ana')).toMatchObject({ title: 'call with Ana', time: '17:00' })
  })

  it('12am e miezul nopții, 12pm e amiaza', () => {
    expect(p('at 12am ceva')).toMatchObject({ time: '00:00' })
    expect(p('at 12pm ceva')).toMatchObject({ time: '12:00' })
  })

  it('in 2 days', () => {
    expect(p('in 2 days ship it')).toMatchObject({ title: 'ship it', date: '2026-08-26' })
  })
})

describe('parseDue — ce NU are voie să facă', () => {
  it('un număr care nu e oră lasă titlul neatins', () => {
    expect(p('Întâlnire la Podul 5')).toMatchObject({
      title: 'Întâlnire la Podul 5', date: null, spans: [],
    })
  })

  it('text fără nicio dată nu inventează una', () => {
    expect(p('cumpără lapte')).toMatchObject({ title: 'cumpără lapte', date: null })
  })

  it('o oră trecută, fără zi, înseamnă mâine', () => {
    // 08:40 e deja trecut de 08:00 — o sarcină nu se naște restantă.
    expect(p('la 8 alergare')).toMatchObject({ date: '2026-08-25', time: '08:00' })
    // Dar peste o oră e tot azi.
    expect(p('la 10 alergare')).toMatchObject({ date: '2026-08-24', time: '10:00' })
  })

  it('o zi scrisă explicit învinge regula de mai sus', () => {
    expect(p('azi la 8 alergare')).toMatchObject({ date: '2026-08-24', time: '08:00' })
  })

  it('titlul are voie să rămână gol când textul e numai dată', () => {
    expect(p('azi la 8')).toMatchObject({ title: '', date: '2026-08-24', time: '08:00' })
  })

  it('ore imposibile sunt ignorate', () => {
    expect(p('la 99:00 ceva')).toMatchObject({ date: null })
  })
})

describe('parseDue — spans', () => {
  it('fiecare fragment e marcat separat — interfața le evidențiază pe rând', () => {
    const text = 'sună mâine la 9 pe Andrei'
    const r = parseDue(text, NOW)
    expect(r.title).toBe('sună pe Andrei')
    // Despărțite de un spațiu, deci nu se unesc. Fiecare acoperă exact un tipar.
    expect(r.spans.map(([a, b]) => text.slice(a, b))).toEqual(['mâine', 'la 9'])
  })

  it('spans-urile sunt sortate și nu se suprapun', () => {
    const r = parseDue('în fiecare luni la 10 raport', NOW)
    for (let i = 1; i < r.spans.length; i++) {
      expect(r.spans[i][0]).toBeGreaterThanOrEqual(r.spans[i - 1][1])
    }
    expect(r.title).toBe('raport')
  })

  it('două fragmente depărtate nu mănâncă titlul dintre ele', () => {
    const r = parseDue('vineri sună la bancă la 10', NOW)
    expect(r.title).toBe('sună la bancă')
    expect(r.spans).toHaveLength(2)
  })
})

describe('refuzul unui fragment', () => {
  /** Ce vede parserul după ce omul a spus „nu e o dată" despre un fragment. */
  function afterReject(text: string, rejected: string[]) {
    const r = parseDue(maskRejected(text, rejected), NOW)
    return {
      spans: r.spans.map(([a, b]) => text.slice(a, b)),
      time: r.dueAt && !r.allDay ? toTimeInput(r.dueAt) : null,
      title: stripSpans(text, r.spans),
    }
  }

  it('fragmentul refuzat rămâne text, oricât se mai scrie după el', () => {
    // Bug-ul reparat: refuzul era o stare globală, ștearsă la următoarea tastă,
    // deci „la 11" se reaprindea singur imediat ce se scria mai departe.
    expect(afterReject('test la 11', ['la 11'])).toMatchObject({ spans: [], time: null })
    expect(afterReject('test la 11 la 12', ['la 11'])).toMatchObject({
      spans: ['la 12'], time: '12:00', title: 'test la 11',
    })
  })

  it('masca păstrează lungimea, deci indicii rămân valizi în textul original', () => {
    const text = 'sună la 11 pe Andrei mâine'
    expect(maskRejected(text, ['la 11'])).toHaveLength(text.length)
    expect(afterReject(text, ['la 11'])).toMatchObject({
      spans: ['mâine'], title: 'sună la 11 pe Andrei',
    })
  })

  it('masca prinde toate aparițiile aceluiași fragment', () => {
    expect(afterReject('la 11 și la 11', ['la 11'])).toMatchObject({ spans: [] })
  })

  it('fără refuzuri, textul trece neatins', () => {
    expect(maskRejected('mâine la 9', [])).toBe('mâine la 9')
    expect(maskRejected('mâine la 9', [''])).toBe('mâine la 9')
  })

  it('stripSpans e chiar tăietura pe care o face parserul', () => {
    const r = parseDue('vineri sună la bancă la 10', NOW)
    expect(stripSpans('vineri sună la bancă la 10', r.spans)).toBe(r.title)
  })
})
