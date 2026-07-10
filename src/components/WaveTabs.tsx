import { useHorizontal } from '../store'
import { useUI } from '../ui'

/** The wave selector row (wave buttons + manage gear). Shared by board + list. */
export function WaveTabs({ onWaveChange }: { onWaveChange?: () => void }) {
  const { waves, issues, activeWave, setActiveWave } = useHorizontal()
  const { openWaveManage } = useUI()
  return (
    <div className="wave-tabs">
      {waves.map((w) => {
        const cnt = issues.filter((i) => i.wave === w.number).length
        return (
          <button
            key={w.number}
            className={`wbtn ${w.number === activeWave ? 'on' : ''}`}
            onClick={() => { setActiveWave(w.number); onWaveChange?.() }}
          >
            <span className="wname">
              {w.number === 0 ? '📝' : '🌊'} {w.name}
            </span>
            <span className="wsub">
              {w.label ? `${w.label} · ` : ''}
              {cnt}
            </span>
          </button>
        )
      })}
      <button className="wbtn wmanage" aria-label="Gestionează valuri" onClick={openWaveManage}>
        <span className="wname">⚙</span>
        <span className="wsub">valuri</span>
      </button>
    </div>
  )
}
