import { useEffect, useRef } from 'react'
import { useHorizontal } from '../store'
import { toShortDate } from '../lib/schedule'
import { isUnread } from '../lib/thread'
import type { InboxRow } from '../lib/types'
import { SplitView } from './SplitView'

/**
 * Cât ține bulina aprinsă după ce ai deschis rândul. Nu instant: altfel
 * dispare sub deget înainte să apuci să vezi DE CE era acolo.
 */
const MARK_SEEN_DELAY_MS = 900

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMin = Math.floor((Date.now() - then) / 60_000)
  if (diffMin < 1) return 'acum'
  if (diffMin < 60) return `acum ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `acum ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `acum ${diffD} z`
  return toShortDate(iso)
}

/**
 * Cutia de pase — al patrulea ecran, „Pe mine". NU e un `SmartListKind` (vezi
 * `Screen` din App.tsx): n-are zi, deci n-are quick add și n-are FAB.
 *
 * Scurtă PRIN DEFINIȚIE, nu prin filtrare deșteaptă: `assignee_id` gol
 * înseamnă „al meu, prin creație", deci tichetele pe care ți le faci singur
 * n-au cum să ajungă aici niciodată. Golul e vestea bună — de-aia cele două
 * stări de mai jos vorbesc despre asta în loc să tacă.
 */
export function InboxView({ onOpen }: { onOpen(issueId: string): void }) {
  const { inbox, inboxLoaded, myAssigneeId, assignees, markInboxSeen } = useHorizontal()
  // Un singur timer: a doua deschidere (navigare rapidă înainte-înapoi)
  // anulează marcarea celei dintâi, ca să nu stingem o bulină la care omul
  // n-a apucat să se uite.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])

  const open = (issueId: string) => {
    onOpen(issueId)
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(() => { void markInboxSeen(issueId) }, MARK_SEEN_DELAY_MS)
  }

  const authorName = (userId: string | null) =>
    (userId && assignees.find((a) => a.userId === userId)?.name) || 'cineva'

  const row = (r: InboxRow) => (
    <button key={r.issueId} className="list-row inbox-row" onClick={() => open(r.issueId)}>
      <span className={`inbox-dot${isUnread(r.lastForeignAt, r.seenAt) ? '' : ' read'}`} aria-hidden="true" />
      <span className="origin-avatar">{authorName(r.lastForeignAuthor).slice(0, 2).toUpperCase()}</span>
      <div className="inbox-body">
        <div className="list-title">{r.title}</div>
        <div className="inbox-meta">
          <span className="mono">{r.issueId}</span>
          <span>de la {authorName(r.lastForeignAuthor)}</span>
          <time className="mono">{timeAgo(r.lastEventAt)}</time>
        </div>
      </div>
    </button>
  )

  // `<SplitView>` învelește ORICE stare, nu doar cea cu rânduri — inclusiv
  // „nelegat" și „gol". Fără asta, un tichet docat dintr-o vizitare anterioară
  // (sau chiar din firul care tocmai a golit cutia — o pasă marchează un rând
  // „gata" și el dispare din listă) pierde `registerSplitHost` exact când
  // conținutul dispare, și SARE la modal peste mesajul gol. Verificat cu date
  // reale: fără învelișul ăsta, exact asta se întâmplă.
  return (
    <SplitView>
      <div className="panel inbox-pad">
        {!myAssigneeId ? (
          // Starea de azi, în producție: tabela `assignees` e goală, deci
          // asta e ce vede toată lumea. Nu e o eroare — e „nimeni nu te-a
          // legat încă de un nume", deci se spune direct, cu drumul de rezolvat.
          <p className="empty inbox-empty">
            <span className="big">Nu ești legat de niciun nume</span>
            Rulează <code>scripts/link-assignees.mjs</code> ca să legi contul de un assignee.
          </p>
        ) : !inboxLoaded ? (
          <p className="empty">Se încarcă…</p>
        ) : !inbox.fresh.length && !inbox.rest.length ? (
          <p className="empty inbox-empty">
            <span className="big">Nimic pe tine</span>
            Aici ajunge doar ce ți-a pasat cineva.<br />
            Tichetele pe care ți le faci singur nu apar niciodată.
          </p>
        ) : (
          <>
            {inbox.fresh.length > 0 && (
              <div className="list-group">
                <div className="list-group-head">
                  <span className="list-group-num">{inbox.fresh.length}</span>
                  <span className="list-group-label">Necitite</span>
                </div>
                {inbox.fresh.map(row)}
              </div>
            )}
            {inbox.rest.length > 0 && (
              <div className="list-group">
                <div className="list-group-head">
                  <span className="list-group-num">{inbox.rest.length}</span>
                  <span className="list-group-label">Mai devreme</span>
                </div>
                {inbox.rest.map(row)}
              </div>
            )}
          </>
        )}
      </div>
    </SplitView>
  )
}
