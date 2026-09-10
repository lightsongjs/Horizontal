import { useMemo } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { openObstacles, waitingDays } from '../lib/obstacles'
import { Icon } from './Icon'
import type { Obstacle } from '../lib/types'

/** Câte obstacole depășite se arată în poartă. Restul se văd pe hartă. */
const RECENT_CLOSED = 3

/**
 * Obstacolele deschise ale valului activ, peste grupurile de layere.
 *
 * Valul unui obstacol nu există — obstacolul n-are val. „Al valului" înseamnă
 * „atinge cel puțin un tichet din valul activ". De-aia același obstacol apare
 * în poarta mai multor valuri, și e corect: B1 chiar blochează în toate.
 */
export function WaveGate() {
  const { obstacles, obstacleLinks, issues, activeWave } = useHorizontal()
  const { pushSheet } = useUI()

  const { open, closed, elsewhere } = useMemo(() => {
    const inWave = new Set(issues.filter((i) => i.wave === activeWave).map((i) => i.id))
    const touching = new Set(
      obstacleLinks.filter((l) => inWave.has(l.issueId)).map((l) => l.obstacleId),
    )
    const mine = obstacles.filter((o) => touching.has(o.id))
    const openIds = openObstacles(obstacles)
    const open = mine.filter((o) => openIds.has(o.id) && o.blocking)
    // Notă intenționată: `closed`, spre deosebire de `open`, nu filtrează pe
    // `blocking`. E arhiva „ce am depășit deja" — un obstacol retrogradat la
    // neblocant și apoi depășit tot a fost depășit; `blocking` răspunde la
    // „oprește acum", o întrebare fără sens pentru ceva deja închis.
    const closed = mine
      .filter((o) => !openIds.has(o.id))
      // `position` e ordinea manuală din listă (reordonabilă de utilizator),
      // fără nicio legătură cu momentul depășirii — sortarea după ea ar
      // arăta cele trei cele mai SUS în listă, nu cele mai RECENTE. Sortăm
      // deci după `resolvedAt`, cel mai recent primul; un `resolvedAt` gol
      // (rânduri vechi sau o cale care nu l-a completat) se duce la coadă.
      // Egalitatea (inclusiv doi `null`) se rupe pe `id`, ca ordinea să fie
      // totală și lista să nu se reamestece la re-randări.
      .sort((a, b) => {
        if (a.resolvedAt === b.resolvedAt) return a.id.localeCompare(b.id)
        if (a.resolvedAt === null) return 1
        if (b.resolvedAt === null) return -1
        return b.resolvedAt.localeCompare(a.resolvedAt)
      })
      .slice(0, RECENT_CLOSED)
    // „La alții": owner scris și diferit de gol. Numărul care răspunde la
    // „de ce nu merge mai repede" fără să-l spui tu.
    const elsewhere = open.filter((o) => o.owner.trim() !== '').length
    return { open, closed, elsewhere }
  }, [obstacles, obstacleLinks, issues, activeWave])

  if (open.length === 0 && closed.length === 0) return null

  const row = (o: Obstacle, ok: boolean) => {
    const days = waitingDays(o, new Date())
    return (
      <button
        key={o.id}
        className={`obst-row ${ok ? 'ok' : ''}`}
        onClick={() => pushSheet({ kind: 'obstacle-form', obstacleId: o.id })}
      >
        <span className="obst-row-id">{o.id}</span>
        <span className="obst-row-title">{o.title}</span>
        <span className="obst-row-own">
          {ok ? (o.state === 'ocolit' ? 'ocolit' : 'depășit') : days !== null ? `${days} zile` : o.owner}
        </span>
      </button>
    )
  }

  return (
    <div className="wave-gate">
      <div className="wave-gate-top">
        <Icon name="obstacle" size={15} />
        <span className="wave-gate-n">{open.length}</span>
        <span className="wave-gate-l">
          {open.length === 1 ? 'obstacol deschis' : 'obstacole deschise'} în acest val
        </span>
        {elsewhere > 0 && <span className="wave-gate-c">{elsewhere} la alții</span>}
      </div>
      <div className="obst-list">
        {open.map((o) => row(o, false))}
        {closed.map((o) => row(o, true))}
      </div>
    </div>
  )
}
