import { useTheme, type Theme } from '../theme'
import { TEXT_SCALES } from '../lib/textScale'
import { Icon } from './Icon'

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
      </div>
    </>
  )
}
