import { useTheme, type Theme } from '../theme'
import { TEXT_SCALES } from '../lib/textScale'
import { Icon } from './Icon'
import { CalendarSettings } from './CalendarSettings'
import { AndroidShadeSetting } from './AndroidShadeSetting'
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

/** Un comutator Pornit / Oprit, cu aceeași cochilie ca fundalul (`.seg-row`). */
function OnOff({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <div className="seg-row app-settings-onoff" role="group" aria-label={label}>
      <span className="app-settings-onoff-label">{label}</span>
      {([true, false] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          className={`seg ${value === v ? 'on' : ''}`}
          aria-pressed={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
        >
          {v ? 'Pornit' : 'Oprit'}
        </button>
      ))}
    </div>
  )
}

/**
 * Rotița de setări: fundalul și mărimea textului. Amândouă se țin pe
 * dispozitiv și se aplică pe loc — omul vede efectul în foaia însăși, deci
 * n-are nevoie de un buton de salvare.
 */
export function AppSettings() {
  const { theme, setTheme, textScale, setTextScale, vim, setVim, follow, setFollow } = useTheme()
  const { isAdmin } = useAuth()
  const { closeSheet, pushSheet } = useUI()
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

        {/* Navigarea din tastatură (`src/vim.tsx`): pe dispozitiv, ca fundalul.
            Oprită, rămân tastele de dinainte (C, O, `,` `.`, V, h j k l). */}
        <div className="sheet-section-t">Tastatură</div>
        <OnOff label="Mod Vim" value={vim} onChange={setVim} />
        <p className="app-settings-note">j k h l, gg, ga, z, Esc pas cu pas. Oprit: tastele de azi (C, O, F, <kbd>,</kbd> <kbd>.</kbd>).</p>
        <OnOff label="Panoul urmează cursorul" value={follow} onChange={setFollow} disabled={!vim} />
        <p className="app-settings-note">Cu un tichet deschis în panou, j / k schimbă și tichetul — dacă n-ai modificări nesalvate.</p>

        {/* Doar în cutia de Android (API 5): notificarea fixă din bară e a telefonului. */}
        <AndroidShadeSetting />

        {/* Ale contului, nu ale dispozitivului — dar aici le caută omul. */}
        <CalendarSettings />

        {/* Coșul: o ștergere din greșeală se repară de aici. Rar, deci în
            rotiță, nu în bara laterală; foaia se împinge peste setări, iar
            „Înapoi" duce aici. */}
        <div className="sheet-section-t">Date</div>
        <button type="button" className="btn-ghost app-settings-link app-settings-trash" onClick={() => pushSheet({ kind: 'trash' })}>
          <Icon name="trash" size={15} />
          Coș · tichete șterse
        </button>

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
