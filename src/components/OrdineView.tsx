import { layerKeys } from '../lib/engine'
import { useDepFlow } from '../store'
import { useUI } from '../ui'
import { TicketCard } from './TicketCard'

export function OrdineView() {
  const { waves, issues, activeWave, setActiveWave, layers } = useDepFlow()
  const { openWaveManage } = useUI()
  const wave = waves.find((w) => w.number === activeWave)
  const keys = layerKeys(layers)

  return (
    <div className="view">
      <div className="wave-sel">
        {waves.map((w) => {
          const cnt = issues.filter((i) => i.wave === w.number).length
          return (
            <button
              key={w.number}
              className={`wbtn ${w.number === activeWave ? 'on' : ''}`}
              onClick={() => setActiveWave(w.number)}
            >
              <span className="wname">{w.name}</span>
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

      {waves.length === 0 ? (
        <p className="empty">
          Niciun val încă. Apasă ⚙ ca să adaugi primul val (sprint).
        </p>
      ) : (
        <>
          <div className="layer-intro">
            📍 <b>{wave ? `${wave.name}${wave.label ? ' — ' + wave.label : ''}.` : ''}</b> Ordinea de mai jos e
            calculată doar din tichetele acestui val. Dependențele din alte valuri rămân, dar nu te blochează
            aici.
          </div>

          {keys.length === 0 ? (
            <p className="empty">Niciun tichet în acest val. Apasă + ca să adaugi unul.</p>
          ) : (
            keys.map((L, i) => {
              const ids = layers[L]
              const ready = i === 0
              return (
                <div key={L} className={`layer ${ready ? 'ready' : ''}`}>
                  <div className="layer-head">
                    <div className="layer-num">{L + 1}</div>
                    <div>
                      <h4>{ready ? 'Începe aici' : `Layer ${L + 1}`}</h4>
                      <div className="sub">
                        {ready ? 'Nu depinde de nimic din acest val' : `Depinde de layer ${L}`} · {ids.length}{' '}
                        tichete
                      </div>
                    </div>
                    {ready && <span className="badge-now">Acum</span>}
                  </div>
                  {ids.map((id) => (
                    <TicketCard key={id} id={id} contextWave={activeWave} />
                  ))}
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
