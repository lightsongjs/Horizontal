import { toRoman } from '../lib/roman'
import { useHorizontal } from '../store'
import { useUI } from '../ui'

/**
 * The wave selector row (wave buttons + manage gear). Shared by board + list.
 * Delivery waves are labelled by Roman numeral (I, II, III…) in position order.
 */
export function WaveTabs({ onWaveChange }: { onWaveChange?: () => void }) {
  const { waves, issues, activeWave, setActiveWave } = useHorizontal()
  const { openWaveManage } = useUI()
  const deliveryWaves = waves.filter((w) => w.number !== 0)
  return (
    <div className="wave-tabs">
      {waves.map((w) => {
        const cnt = issues.filter((i) => i.wave === w.number).length
        const isScratch = w.number === 0
        const roman = isScratch ? '' : toRoman(deliveryWaves.indexOf(w) + 1)
        return (
          <button
            key={w.number}
            className={`wbtn ${isScratch ? 'wscratch' : ''} ${w.number === activeWave ? 'on' : ''}`}
            onClick={() => { setActiveWave(w.number); onWaveChange?.() }}
            title={w.name}
            aria-label={w.name}
          >
            <span className="wname">{isScratch ? '📝' : roman}</span>
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
