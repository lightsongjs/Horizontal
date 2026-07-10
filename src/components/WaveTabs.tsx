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
        const isScratch = w.number === 0
        return (
          <button
            key={w.number}
            className={`wbtn ${isScratch ? 'wscratch' : ''} ${w.number === activeWave ? 'on' : ''}`}
            onClick={() => { setActiveWave(w.number); onWaveChange?.() }}
            title={isScratch ? w.name : undefined}
            aria-label={isScratch ? w.name : undefined}
          >
            <span className="wname">{isScratch ? '📝' : `🌊 ${w.name}`}</span>
            <span className="wsub">
              {isScratch ? cnt : `${w.label ? `${w.label} · ` : ''}${cnt}`}
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
