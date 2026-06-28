import { useState } from 'react'
import { OrdineView } from './OrdineView'
import { GraphView } from './GraphView'
import { ThemesView } from './ThemesView'

type Tab = 'ordine' | 'graf' | 'teme'

const TABS: { key: Tab; label: string }[] = [
  { key: 'ordine', label: 'Ordine' },
  { key: 'graf', label: 'Graf' },
  { key: 'teme', label: 'Teme' },
]

export function ProjectDetail() {
  const [tab, setTab] = useState<Tab>('ordine')
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
      {tab === 'graf' && <GraphView />}
      {tab === 'teme' && <ThemesView />}
    </div>
  )
}
