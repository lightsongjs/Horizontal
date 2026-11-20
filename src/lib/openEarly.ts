/**
 * O sarcină cerută din afara proiectului ei („Azi", Inbox, un filtru, un deep
 * link): cât are voie foaia să NU aștepte proiectul din rețea.
 *
 * Proiectul se încarcă oricum (formularul complet are nevoie de valuri, teme,
 * dependențe), dar pe telefon runda asta înseamnă ~600 KB și ~1s pentru un
 * proiect mare — iar ea se repeta la FIECARE deschidere din „Azi", fiindcă
 * închiderea foii descarcă proiectul (`openScreen` → `selectProject(null)`).
 * Măsurătorile: `docs/agent/viteza-deschidere.md`.
 *
 * Ce decide e cine își citește câmpurile și când:
 *
 * - `now` — foaia scurtă de telefon (`EditSheet`), cu sarcina deja în listă:
 *   citește tichetul din `byId`, altfel din `dueIssues`/`openIssues`, și își
 *   rebazează ciorna din store la fiecare randare. N-are nevoie de proiect ca
 *   să se arate, deci se deschide la atingere.
 * - `when-present` — foaia scurtă fără copie în listă, sau formularul DOCAT:
 *   se deschide de îndată ce tichetul e în `byId`, din orice cadru (memoria
 *   sesiunii sau baza locală). Formularul docat se remontează singur când
 *   sosesc câmpuri noi de la server și nu e murdar (`formPrint` din
 *   `SplitView`), deci un cadru vechi nu rămâne pe ecran.
 * - `when-loaded` — formularul MODAL: își copiază câmpurile o singură dată, la
 *   montare, fără remontare. Deschis dintr-un cadru vechi al bazei locale, ar
 *   fi rămas pe el, iar o salvare ar fi scris înapoi valorile vechi. Așteaptă
 *   lista autoritară, ca înainte.
 *
 * Verdictul „tichetul nu mai există" se dă tot numai pe lista autoritară: un
 * tichet absent dintr-un cadru din cache poate fi doar mai nou decât cache-ul.
 */
export type OpenPlan = 'now' | 'when-present' | 'when-loaded'

export function planOpen({ compact, docked, inList }: {
  /** Foaia scurtă de telefon (`compactIssueIdFrom`): îngust și stiva goală. */
  compact: boolean
  /** O vizualizare găzduiește panoul lateral (`registerSplitHost`). */
  docked: boolean
  /** Sarcina e în `dueIssues`/`openIssues`, de unde o citește `EditSheet`. */
  inList: boolean
}): OpenPlan {
  if (compact && inList) return 'now'
  if (compact || docked) return 'when-present'
  return 'when-loaded'
}
