import { useTheme, type Theme } from '../theme'
import { TEXT_SCALES } from '../lib/textScale'
import { Icon } from './Icon'
import { CalendarSettings } from './CalendarSettings'
import { useAuth } from '../auth'
import { useUI } from '../ui'

/**
 * Cererea „deschide Utilizatori”, ascultată de Shell (`App.tsx`). Ca la
 * filtre (`OPEN_FILTER_EVENT`): foaia nu navighează singură — se închide, iar
 * Shell-ul schimbă ecranul DUPĂ randare, cu stiva de foi deja goală.
 */
export const OPEN_USERS_EVENT = 'hz:open-users'

const THEMES: { key: Theme; label: string }[] = [
  { key: 'light', label: 'Luminos' },
  { key: 'dark', label: 'Întunecat' },
]

/**
 * Rotița de setări: fundalul și mărimea textului. Amândouă se țin pe
 * dispozitiv și se aplică pe loc — omul vede efectul în foaia însăși, deci
 * n-are nevoie de un buton de salvare.
 */
export function AppSettings() {
  const { theme, setTheme, textScale, setTextScale } = useTheme()
  const { isAdmin } = useAuth()
  const { closeSheet } = useUI()
  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow"><Icon name="settingsApp" size={13} /> Pe acest dispozitiv</div>
        <h2>Setări</h2>
      </div>
      <div className="sheet-scroll app-settings">
        <div className="sheet-section-t">Fundal</div>
        <div className="seg-row" role="group" aria-label="Fundal">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`seg ${theme === t.key ? 'on' : ''}`}
              aria-pressed={theme === t.key}
              onClick={() => setTheme(t.key)}
            >
              <Icon name={t.key === 'light' ? 'themeLight' : 'themeDark'} size={15} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="sheet-section-t">Mărimea textului</div>
        <div className="seg-row" role="group" aria-label="Mărimea textului">
          {TEXT_SCALES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`seg ${textScale === s.value ? 'on' : ''}`}
              aria-pressed={textScale === s.value}
              onClick={() => setTextScale(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="app-settings-sample">Așa arată textul unei sarcini.</p>

        {/* Ale contului, nu ale dispozitivului — dar aici le caută omul. */}
        <CalendarSettings />

        {/* Utilizatorii au stat în bara laterală, ca rând permanent, deși îi
            deschide doar adminul și rar. Locul lor e lângă celelalte setări. */}
        {isAdmin && (
          <>
            <div className="sheet-section-t">Administrare</div>
            <button
              type="button"
              className="btn-ghost app-settings-link"
              onClick={() => {
                closeSheet()
                window.dispatchEvent(new Event(OPEN_USERS_EVENT))
              }}
            >
              <Icon name="members" size={15} />
              Utilizatori
            </button>
          </>
        )}
      </div>
    </>
  )
}
