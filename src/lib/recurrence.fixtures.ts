// Cazurile de recurență, o singură dată, pentru două limbi.
//
// `recurrence.test.ts` le trece prin motorul TS; `scripts/test-recurrence-sql.mjs`
// prin `next_occurrence()` din Postgres. Un caz adăugat aici e verificat automat
// în amândouă. Fișierul NU importă vitest: scriptul îl încarcă din Node.

/** Ziua locală `y-m-d` la ora `h:mi`, ca ISO. Luna e 1-based aici, ca în vorbire. */
function iso(y: number, m: number, d: number, h = 9, mi = 0): string {
  return new Date(y, m - 1, d, h, mi, 0, 0).toISOString()
}

export interface Fixture {
  name: string
  rrule: string
  /** Scadența de dinainte de salt. */
  due: string
  /** „Acum" — ziua din care se calculează saltul. */
  from: string
  /** Ziua locală așteptată, `YYYY-MM-DD HH:mm`, sau `null` dacă nu se sare. */
  want: string | null
}

export const FIXTURES: Fixture[] = [
  { name: 'zilnic, bifată în ziua scadenței', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-25 09:00' },
  { name: 'zilnic, trei zile sărite — sare din AZI, nu din scadență', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 27), want: '2026-08-28 09:00' },
  { name: 'zilnic, bifată înainte de scadență — tot un pas mai departe', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 26), from: iso(2026, 8, 24), want: '2026-08-27 09:00' },
  { name: 'la 2 zile, cu zile sărite — rămâne pe grila scadenței', rrule: 'FREQ=DAILY;INTERVAL=2',
    due: iso(2026, 8, 24), from: iso(2026, 8, 27), want: '2026-08-28 09:00' },
  { name: 'săptămânal fără BYDAY — ziua vine din scadență', rrule: 'FREQ=WEEKLY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-31 09:00' },
  { name: 'lunea și joia, bifată luni', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-27 09:00' },
  { name: 'lunea și joia, bifată joi', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    due: iso(2026, 8, 27), from: iso(2026, 8, 27), want: '2026-08-31 09:00' },
  { name: 'zile lucrătoare, bifată vineri — sare peste weekend', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    due: iso(2026, 8, 28), from: iso(2026, 8, 28), want: '2026-08-31 09:00' },
  { name: 'zile lucrătoare, restanța de vineri bifată sâmbătă', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    due: iso(2026, 8, 28), from: iso(2026, 8, 29), want: '2026-08-31 09:00' },
  { name: 'zile lucrătoare, bifată marți', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    due: iso(2026, 8, 25), from: iso(2026, 8, 25), want: '2026-08-26 09:00' },
  { name: 'la 2 săptămâni, lunea', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-09-07 09:00' },
  { name: 'lunar pe 15', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
    due: iso(2026, 8, 15), from: iso(2026, 8, 24), want: '2026-09-15 09:00' },
  { name: 'lunar pe 31 → februarie se retează la 28', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
    due: iso(2027, 1, 31), from: iso(2027, 1, 31), want: '2027-02-28 09:00' },
  { name: 'lunar pe 31 → retezarea NU se memorează, martie revine pe 31', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
    due: iso(2027, 2, 28), from: iso(2027, 2, 28), want: '2027-03-31 09:00' },
  { name: 'anual pe 29 februarie → an nebisect, 28', rrule: 'FREQ=YEARLY',
    due: iso(2028, 2, 29), from: iso(2028, 2, 29), want: '2029-02-28 09:00' },
  { name: 'anual obișnuit', rrule: 'FREQ=YEARLY',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2027-08-24 09:00' },
  { name: 'zi întreagă — ora 00:00 se păstrează', rrule: 'FREQ=DAILY',
    due: iso(2026, 8, 24, 0, 0), from: iso(2026, 8, 24), want: '2026-08-25 00:00' },
  { name: 'peste trecerea la ora de vară — ora locală rămâne 09:00', rrule: 'FREQ=DAILY',
    due: iso(2027, 3, 27), from: iso(2027, 3, 27), want: '2027-03-28 09:00' },
  { name: 'peste trecerea la ora de iarnă — ora locală rămâne 09:00', rrule: 'FREQ=DAILY',
    due: iso(2026, 10, 24), from: iso(2026, 10, 24), want: '2026-10-25 09:00' },
  { name: 'RRULE nerecunoscut — nu sare', rrule: 'FREQ=DAILY;COUNT=3',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },

  // Fix round 1: divergențe TS↔SQL pe intrări din afara subsetului acceptat.
  // Lista e ALBĂ (chei cunoscute), nu neagră — o cheie nouă, necunoscută,
  // trebuie să respingă tot RRULE-ul, nu doar cele patru enumerate explicit.
  { name: 'cheie necunoscută — respinsă, nu ignorată', rrule: 'FREQ=DAILY;FOO=BAR',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'INTERVAL negativ — nu e „implicit 1"', rrule: 'FREQ=DAILY;INTERVAL=-1',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'INTERVAL nenumeric', rrule: 'FREQ=DAILY;INTERVAL=abc',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'BYMONTHDAY peste 31', rrule: 'FREQ=MONTHLY;BYMONTHDAY=99',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'cod de zi necunoscut în BYDAY — respinge tot, nu doar codul', rrule: 'FREQ=WEEKLY;BYDAY=MO,XX',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'FREQ scris minuscul — identic cu FREQ=DAILY', rrule: 'freq=daily',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-25 09:00' },
  { name: 'UNTIL — respins prin absența din lista albă, nu prin listă neagră', rrule: 'FREQ=DAILY;UNTIL=20261231T000000Z',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },

  // Fix round 2: literale numerice care nu încap în `int4`. În SQL, castul
  // ARUNCA — iar un trigger `before update` care aruncă anulează tot
  // update-ul, deci rândul nu se mai putea bifa deloc. În TS, aritmetica dădea
  // `Invalid Date` și `toISOString()` arunca, contrar specului („Nu aruncă").
  // Amândouă spun acum „nu știu": `null`. Ajung din TEXT, nu doar din bază.
  { name: 'INTERVAL peste int4 — null, nu eroare', rrule: 'FREQ=DAILY;INTERVAL=99999999999',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'INTERVAL în int4, dar peste plafon — tot null', rrule: 'FREQ=DAILY;INTERVAL=2000000000',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'BYMONTHDAY peste int4 — null înaintea castului', rrule: 'FREQ=MONTHLY;BYMONTHDAY=99999999999',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'INTERVAL la plafon — încă valid', rrule: 'FREQ=DAILY;INTERVAL=999',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2029-05-19 09:00' },
  { name: 'INTERVAL peste plafon cu o unitate', rrule: 'FREQ=DAILY;INTERVAL=1000',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: null },
  { name: 'zerouri în față — plafonul se citește pe cifrele care contează', rrule: 'FREQ=DAILY;INTERVAL=0005',
    due: iso(2026, 8, 24), from: iso(2026, 8, 24), want: '2026-08-29 09:00' },
]
