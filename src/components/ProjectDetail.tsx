import { OrdineView } from './OrdineView'
import { ListView } from './ListView'
import { GraphView } from './GraphView'
import { ThemesView } from './ThemesView'

export type Tab = 'ordine' | 'list' | 'graf' | 'teme'

const TABS: { key: Tab; label: string }[] = [
  { key: 'ordine', label: 'Cards' },
  { key: 'list', label: 'List' },
  { key: 'graf', label: 'Graf' },
  { key: 'teme', label: 'Teme' },
]

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
      {tab === 'graf' && <GraphView />}
      {tab === 'teme' && <ThemesView />}
    </div>
  )
}
