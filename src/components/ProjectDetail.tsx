import { OrdineView } from './OrdineView'
import { ListView } from './ListView'
import { MapView } from './MapView'
import { ThemesView } from './ThemesView'

export type Tab = 'ordine' | 'list' | 'graf' | 'teme'

const TABS: { key: Tab; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'ordine', label: 'Cards' },
  { key: 'graf', label: 'Hartă' },
  { key: 'teme', label: 'Teme' },
]

/**
 * `setTab` NU e `useState`-ul brut: e `changeTab` din `App.tsx`, care închide
 * foaia deschisă înainte să comute. Un tichet docat în panoul lateral al
 * „Listei" ar sări altfel ca modal peste tabul următor. Motivul întreg e
 * documentat acolo, lângă implementare, fiindcă tastele 1–4 intră pe același
 * drum.
 */
export function ProjectDetail({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="view">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ordine' && <OrdineView />}
      {tab === 'list' && <ListView />}
      {tab === 'graf' && <MapView />}
      {tab === 'teme' && <ThemesView />}
    </div>
  )
}
