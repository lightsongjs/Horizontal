import { useCanWrite } from '../hooks'
import { useUI } from '../ui'
import { Icon } from './Icon'

/**
 * Proiect fără niciun val de livrare: fără bandă (n-ai ce comuta), iar în
 * locul listei un buton care deschide foaia „Valuri" cu câmpul de val nou.
 */
export function NoWaves() {
  const canWrite = useCanWrite()
  const { openWaveManage } = useUI()
  return (
    <div className="empty no-waves">
      <p><b>Niciun val încă.</b> Valurile sunt sprinturile proiectului: ce livrezi acum.</p>
      {canWrite && (
        <button type="button" className="btn-primary" onClick={() => openWaveManage('new')}>
          <Icon name="add" size={16} /> Primul val
        </button>
      )}
    </div>
  )
}
