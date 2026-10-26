/**
 * Vârsta buildului care rulează, scrisă relativ, în română: „acum 2 min”,
 * „acum 1 oră”, „ieri”, „acum 3 zile”. Stă sub numele omului (sertar, bara
 * laterală), ca să vadă dintr-o privire dacă ultimul push a ajuns pe
 * dispozitiv (service worker-ul aplică buildul nou la revenirea în tab).
 *
 * Pur: `now` și `built` vin din afară. Zilele se numără pe CALENDARUL local
 * („ieri” = ziua de dinainte, nu „acum 24–48 h”), orele și minutele pe ceas.
 */

const MIN = 60_000
const HOUR = 60 * MIN

/** „20 de ore”, „100 de zile” — în română „de” vine după 20…99, 100, 120… */
const de = (n: number) => (n % 100 === 0 || n % 100 >= 20 ? 'de ' : '')

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Zile de calendar între cele două date (rotunjit — o zi cu schimbare de oră are 23/25 h). */
const calendarDays = (from: Date, to: Date) => Math.round((startOfDay(to) - startOfDay(from)) / (24 * HOUR))

/**
 * Sub o oră: secunde / minute. Apoi orele, cât buildul e de azi — sau de cel
 * mult 6 ore, peste miezul nopții („acum 2 ore” spune mai mult decât „ieri”
 * la 01:00). Altfel „ieri” și „acum N zile”, pe calendar. Un build „din
 * viitor” (ceasul dispozitivului în urmă) e tot „chiar acum”. Afișat ca
 * „Versiune · acum 2 min”.
 */
export function formatBuildAge(built: Date, now: Date): string {
  const ms = now.getTime() - built.getTime()
  if (Number.isNaN(ms)) return ''
  if (ms < MIN) return 'chiar acum'
  if (ms < HOUR) {
    // Cu prescurtarea „min” fără „de” (ca pe ceas): rândul e îngust.
    return `acum ${Math.floor(ms / MIN)} min`
  }
  const days = calendarDays(built, now)
  if (days <= 0 || ms < 6 * HOUR) {
    const h = Math.floor(ms / HOUR)
    return h === 1 ? 'acum 1 oră' : `acum ${h} ${de(h)}ore`
  }
  if (days === 1) return 'ieri'
  return `acum ${days} ${de(days)}zile`
}

/** Tooltipul: data exactă a buildului, plus commitul scurt dacă îl știm. */
export function buildTitle(built: Date, commit: string): string {
  if (Number.isNaN(built.getTime())) return 'Versiune necunoscută'
  const when = built.toLocaleString('ro-RO', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return `Versiunea construită pe ${when}${commit ? ` · ${commit}` : ''}`
}
