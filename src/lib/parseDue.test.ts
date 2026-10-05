import { describe, expect, it } from 'vitest'
import { liveRejections, maskRejected, parseDue, stripSpans } from './parseDue'
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
      title: 'raport săptămânal', date: '2026-08-31', rrule: 'FREQ=WEEKLY;BYDAY=MO',
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
    expect(p('sună în 2 h')).toMatchObject({ title: 'sună', time: '10:40' })
    expect(p('sună in 2h')).toMatchObject({ title: 'sună', time: '10:40' })
  })

  it('ore și minute într-un singur fragment', () => {
    expect(p('sună in 1h30')).toMatchObject({ title: 'sună', time: '10:10' })
    expect(p('sună peste 1 h 15 min')).toMatchObject({ title: 'sună', time: '09:55' })
    expect(p('sună în 1 oră și 30 min')).toMatchObject({ title: 'sună', time: '10:10' })
    expect(p('plecăm într-o oră și 30 de minute')).toMatchObject({ title: 'plecăm', time: '10:10' })
    expect(p('plecăm peste o oră și jumătate')).toMatchObject({ title: 'plecăm', time: '10:10' })
    expect(p('leave in 2 hours and 5 minutes')).toMatchObject({ title: 'leave', time: '10:45' })
    // „și" fără minute după el nu e al orei: rămâne în titlu.
    expect(p('sună în 1 oră și pleacă')).toMatchObject({ title: 'sună și pleacă', time: '09:40' })
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

describe('refuzul se uită când fragmentul dispare', () => {
  /**
   * Secvența pe care o trăiește omul, pas cu pas: fiecare pas primește textul
   * de acum și întoarce ce vede parserul, cu refuzurile curățate de cele care
   * nu mai au acoperire — exact regula din `useTitleDate`.
   */
  function run(steps: { text: string; reject?: string }[]) {
    let rejected: string[] = []
    return steps.map(({ text, reject }) => {
      rejected = liveRejections(text, rejected)
      const r = parseDue(maskRejected(text, rejected), NOW)
      const seen = r.spans.map(([a, b]) => text.slice(a, b))
      if (reject) rejected = [...rejected, reject]
      return seen
    })
  }

  it('șterg fragmentul refuzat și îl scriu la loc: se recunoaște din nou', () => {
    expect(run([
      { text: 'reminder la 10', reject: 'la 10' }, // îl văd, îl refuz
      { text: 'reminder la 10 ' },                 // refuzat: nu se mai vede
      { text: 'reminder ' },                       // l-am șters: refuzul se uită
      { text: 'reminder la 12' },                  // altă oră, recunoscută
      { text: 'reminder ' },                       // șters și el
      { text: 'reminder la 10' },                  // vechiul fragment, din nou viu
    ])).toEqual([['la 10'], [], [], ['la 12'], [], ['la 10']])
  })

  it('cât timp fragmentul stă în text, refuzul ține', () => {
    expect(run([
      { text: 'test la 11', reject: 'la 11' },
      { text: 'test la 11 ' },
      { text: 'test la 11 la 12' },
    ])).toEqual([['la 11'], [], ['la 12']])
  })
})

describe('recurență în text', () => {
  const r = (s: string) => parseDue(s, NOW).rrule

  it('zilnic și intervalul de zile', () => {
    expect(r('zilnic bea apă')).toBe('FREQ=DAILY')
    expect(r('în fiecare zi bea apă')).toBe('FREQ=DAILY')
    expect(r('daily standup')).toBe('FREQ=DAILY')
    expect(r('la 2 zile udă florile')).toBe('FREQ=DAILY;INTERVAL=2')
    expect(r('din 3 în 3 zile verifică')).toBe('FREQ=DAILY;INTERVAL=3')
    expect(r('every 2 days water')).toBe('FREQ=DAILY;INTERVAL=2')
  })

  it('ziua săptămânii, una sau mai multe', () => {
    expect(r('în fiecare luni raport')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r('lunea raport')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r('every monday report')).toBe('FREQ=WEEKLY;BYDAY=MO')
    expect(r('lunea și joia sala')).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
    expect(r('săptămânal sinteza')).toBe('FREQ=WEEKLY')
    expect(r('la 2 săptămâni retrospectivă')).toBe('FREQ=WEEKLY;INTERVAL=2')
  })

  it('lunar și anual', () => {
    expect(r('lunar plătește chiria')).toBe('FREQ=MONTHLY')
    expect(r('pe 15 ale lunii plătește factura')).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(r('anual revizie')).toBe('FREQ=YEARLY')
    expect(r('în fiecare an revizie')).toBe('FREQ=YEARLY')
  })

  it('„luni" e o zi, „lunea" e o recurență — forma articulată e semnalul', () => {
    expect(r('luni raport')).toBeNull()
    expect(parseDue('luni raport', NOW).dueAt).not.toBeNull()
  })

  it('o recurență fără dată pornește de azi — motorul are nevoie de un start', () => {
    const p = parseDue('zilnic bea apă', NOW)
    expect(p.dueAt).not.toBeNull()
    expect(new Date(p.dueAt!).getDate()).toBe(24)
    expect(p.title).toBe('bea apă')
  })

  it('fragmentul de recurență se poate refuza ca oricare altul', () => {
    const p = parseDue('la 2 zile de concediu', NOW)
    expect(p.spans).toEqual([[0, 9]])
    expect(p.title).toBe('de concediu')
    const rejected = ['la 2 zile']
    expect(parseDue(maskRejected('la 2 zile de concediu', rejected), NOW).rrule).toBeNull()
  })

  it('„pe N ale lunii" nu suprascrie o recurență deja recunoscută', () => {
    // Fără gardă, blocul de mai jos rulează necondiționat și înlocuiește
    // „zilnic" cu „lunar pe 15", pierzând recurența scrisă de om.
    expect(r('zilnic pe 15 ale lunii plateste')).toBe('FREQ=DAILY')
  })

  it('enumerare de trei sau mai multe zile — golul dintre ele se punte, nu se caută „și" în tot textul', () => {
    // Finding critic #1: cu trei zile, legătura era prinsă o singură dată,
    // iar restul rămânea în titlu ca resturi.
    const p = parseDue('lunea, marțea, miercurea și joia curățenie', NOW)
    expect(p.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH')
    expect(p.title).toBe('curățenie')
  })

  it('un „și" legitim din restul titlului nu e confundat cu legătura dintre zile', () => {
    // Finding critic #2: legătura se căuta în tot textul, deci un „și"
    // scris de om înainte de enumerare era prins și șters în locul ei.
    const p = parseDue('trimite și primește, lunea și joia sala', NOW)
    expect(p.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
    expect(p.title).toBe('trimite și primește, sala')
  })

  it('două zile separate de altceva decât separatori NU se punte', () => {
    // Text real între ele (nu doar spații/virgule/un „și") — nu fac parte
    // din aceeași enumerare, deci rămân spanuri separate.
    const p = parseDue('lunea plătește, apoi separat joia livrează', NOW)
    expect(p.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
    expect(p.spans.length).toBe(2)
  })

  it('„sâmbătă" și „duminică" rămân DATE — articularea nu le deosebește', () => {
    // Regresia cea mai scumpă a ramurii: după `fold()`, „sâmbătă" și „sâmbăta"
    // sunt același șir, la fel „duminică"/„duminica". Tratate ca recurență,
    // dădeau o sarcină pe care bifa n-o mai închidea niciodată.
    expect(r('sâmbătă tuns')).toBeNull()
    expect(r('sambata tuns')).toBeNull()
    expect(r('duminică la bunici')).toBeNull()
    expect(r('duminica la bunici')).toBeNull()
    expect(p('sâmbătă tuns')).toMatchObject({ title: 'tuns', date: '2026-08-29' })
    expect(p('duminica la bunici')).toMatchObject({ title: 'la bunici', date: '2026-08-30' })
  })

  it('aceleași două zile DEVIN recurență cu marcaj explicit', () => {
    expect(p('în fiecare sâmbătă tuns')).toMatchObject({
      title: 'tuns', date: '2026-08-29', rrule: 'FREQ=WEEKLY;BYDAY=SA',
    })
    expect(p('every saturday haircut')).toMatchObject({
      title: 'haircut', date: '2026-08-29', rrule: 'FREQ=WEEKLY;BYDAY=SA',
    })
    expect(p('în fiecare duminică la bunici')).toMatchObject({
      date: '2026-08-30', rrule: 'FREQ=WEEKLY;BYDAY=SU',
    })
  })

  it('o recurență care NUMEȘTE o zi pornește de la ea, nu de azi', () => {
    // NOW = luni 24 aug. Fără alinierea la BYDAY/BYMONTHDAY, toate patru
    // cădeau azi — adică în „Azi", pe o zi pe care n-a cerut-o nimeni.
    expect(p('vinerea raport')).toMatchObject({ date: '2026-08-28', rrule: 'FREQ=WEEKLY;BYDAY=FR' })
    expect(p('joia la 18 sala')).toMatchObject({ date: '2026-08-27', time: '18:00' })
    expect(p('pe 15 ale lunii la 10 factura')).toMatchObject({ date: '2026-09-15', time: '10:00' })
    expect(p('on the 15th pay the bill')).toMatchObject({ date: '2026-09-15' })
  })

  it('„în fiecare X" și „Xa" dau ACEEAȘI zi — nu mai e o întâmplare', () => {
    // Înainte, „în fiecare joi" nimerea joia doar fiindcă `\bjoi\b` se
    // potrivea a doua oară, ca zi obișnuită; „joia" nu se potrivea și cădea
    // azi. Acum ziua vine din motor pentru amândouă.
    expect(p('în fiecare joi sala').date).toBe('2026-08-27')
    expect(p('joia sala').date).toBe('2026-08-27')
    // Și într-o vineri, unde ambele formulări trebuie să spună „vinerea
    // viitoare", ca „vineri" spus vineri.
    const FRI = new Date(2026, 7, 28, 8, 40)
    expect(parseDue('vinerea raport', FRI).dueAt).toBe(parseDue('vineri raport', FRI).dueAt)
    expect(parseDue('în fiecare vineri raport', FRI).dueAt).toBe(parseDue('vineri raport', FRI).dueAt)
  })

  it('o zi scrisă explicit învinge alinierea recurenței', () => {
    // „mâine" e o dată cerută cu mâna; recurența doar spune cât de des.
    expect(p('mâine lunea raport')).toMatchObject({ date: '2026-08-25', rrule: 'FREQ=WEEKLY;BYDAY=MO' })
  })

  it('„pe N ale lunii" pornește din luna ASTA dacă ziua n-a trecut', () => {
    // NOW = luni 24 august. „Strict după azi" (regula pentru zilele
    // săptămânii) ar fi însemnat aici, pe tăcute, „strict după luna asta".
    expect(p('pe 28 ale lunii factura')).toMatchObject({ date: '2026-08-28' })
    expect(p('pe 24 ale lunii factura')).toMatchObject({ date: '2026-08-24' })
    expect(p('pe 15 ale lunii factura')).toMatchObject({ date: '2026-09-15' })
    const UNU = new Date(2026, 7, 1, 8, 40)
    expect(parseDue('pe 15 ale lunii factura', UNU).dueAt).toBe(new Date(2026, 7, 15).toISOString())
  })

  it('un interval absurd nu devine recurență — ar fi blocat bifarea', () => {
    // `INTERVAL=99999999999` nu încape în `int4`: `next_occurrence()` arunca,
    // iar un trigger care aruncă anulează tot update-ul. Rândul nu se mai
    // putea bifa deloc. Fragmentul rămâne text, ceea ce e onest.
    expect(r('la 99999999999 zile ceva')).toBeNull()
    expect(parseDue('la 99999999999 zile ceva', NOW).dueAt).toBeNull()
    expect(r('la 999 zile ceva')).toBe('FREQ=DAILY;INTERVAL=999')
  })

  it('un interval prea mare nu devine ORĂ — patru cifre lipite arată ca „la 1000"', () => {
    // „la 1000 zile" pică din tiparul de recurență (plafonul de trei cifre) și
    // cădea în tiparul de oră militară: „azi la 10:00", o scadență inventată.
    const p1000 = parseDue('la 1000 zile ceva', NOW)
    expect(p1000.rrule).toBeNull()
    expect(p1000.dueAt).toBeNull()
    expect(p1000.title).toBe('la 1000 zile ceva')
    // Iar ora militară adevărată rămâne întreagă.
    expect(p('la 1000 sună')).toMatchObject({ title: 'sună', time: '10:00' })
  })
})

describe('excluderea de recurență din tiparul de oră liberă', () => {
  // Fix anterior, netestat permanent: „la N <unitate>" nu are voie să fie
  // citit și ca oră liberă „la N", pentru fiecare unitate din listă și în
  // ambele limbi — altfel „la 2 zile" ajungea și scadență la ora 2:00.
  it('unitățile în română nu devin oră', () => {
    for (const text of [
      'la 2 zile uda florile', 'la 2 saptamani retrospectiva',
      'la 2 luni revizie', 'la 2 ani revizie',
    ]) {
      const r = parseDue(text, NOW)
      expect(r.allDay, text).toBe(true)
    }
  })

  it('unitățile în engleză nu devin oră', () => {
    for (const text of [
      'la 2 days water', 'la 2 weeks retro', 'la 2 months rent', 'la 2 years review',
    ]) {
      const r = parseDue(text, NOW)
      expect(r.allDay, text).toBe(true)
    }
  })

  it('dar o oră adevărată — fără unitate de recurență după — rămâne oră', () => {
    expect(p('sună la 2')).toMatchObject({ time: '02:00' })
    expect(p('mergi la cumpărături la 14:00')).toMatchObject({ time: '14:00' })
  })
})

describe('parseDue — zile lucrătoare', () => {
  // NOW = luni 24 august 2026, 08:40.
  const WD = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  it.each([
    ['standup în zilele lucrătoare', 'standup'],
    ['standup zilele lucrătoare', 'standup'],
    ['standup în fiecare zi lucrătoare', 'standup'],
    ['standup de luni până vineri', 'standup'],
    ['standup luni-vineri', 'standup'],
    ['standup luni - vineri', 'standup'],
    ['standup every weekday', 'standup'],
    ['standup on weekdays', 'standup'],
    ['standup weekdays', 'standup'],
    ['standup every workday', 'standup'],
    ['standup on workdays', 'standup'],
    ['standup workdays', 'standup'],
    ['standup every working day', 'standup'],
    ['standup every business day', 'standup'],
    ['standup monday to friday', 'standup'],
    ['standup mon-fri', 'standup'],
  ])('%s', (text, title) => {
    const p = parseDue(text, NOW)
    expect(p.rrule).toBe(WD)
    expect(p.title).toBe(title)
  })
  it('„Daily" rămâne nume de ședință când zilele sunt scrise explicit', () => {
    const p = parseDue('Daily cu șeful în zilele lucrătoare la 10', NOW)
    expect(p.rrule).toBe(WD)
    expect(p.title).toBe('Daily cu șeful')
    expect(p.hasTime).toBe(true)
  })
  it('sâmbătă: prima apariție e lunea următoare', () => {
    const p = parseDue('raport zilele lucrătoare', new Date(2026, 7, 29, 10, 0))
    expect(new Date(p.dueAt!).getDate()).toBe(31)
  })
  it('„luni" singur rămâne o dată, nu o recurență', () => {
    expect(parseDue('ședință luni', NOW).rrule).toBeNull()
  })
})

describe('parseDue — prima apariție: cu oră, azi contează; fără oră, de după azi', () => {
  const at = (t: string, now: Date) => {
    const d = new Date(parseDue(t, now).dueAt!)
    return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const MON = new Date(2026, 7, 24, 8, 40)
  const FRI_AM = new Date(2026, 7, 28, 9, 0)
  const FRI_PM = new Date(2026, 7, 28, 13, 0)
  it('luni dimineața, ora încă n-a venit → azi', () => expect(at('status every workday at 1230', MON)).toBe('24 12:30'))
  it('luni, ora a trecut → marți', () => expect(at('status every workday at 8', MON)).toBe('25 08:00'))
  it('luni, fără oră → marți', () => expect(at('status în zilele lucrătoare', MON)).toBe('25 00:00'))
  it('vineri dimineața → vineri', () => expect(at('status every workday at 1230', FRI_AM)).toBe('28 12:30'))
  it('vineri după oră → luni, nu sâmbătă', () => expect(at('status every workday at 1230', FRI_PM)).toBe('31 12:30'))
  it('„în fiecare luni" spus luni, fără oră → lunea viitoare', () => expect(at('raport în fiecare luni', MON)).toBe('31 00:00'))
  it('„în fiecare luni la 15" spus luni dimineața → azi', () => expect(at('raport în fiecare luni la 15', MON)).toBe('24 15:00'))
  it('„lunea și joia la 8" spus luni la 08:40 → joi', () => expect(at('sala lunea și joia la 8', MON)).toBe('27 08:00'))
  it('„pe 24 ale lunii la 8" spus pe 24 la 08:40 → luna viitoare, nu restant', () => {
    const d = new Date(parseDue('factura pe 24 ale lunii la 8', MON).dueAt!)
    expect([d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([9, 24, 8])
  })
  it('„pe 24 ale lunii la 10" spus pe 24 la 08:40 → azi', () => expect(at('factura pe 24 ale lunii la 10', MON)).toBe('24 10:00'))
})
