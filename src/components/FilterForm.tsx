import { useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { errorMessage } from '../lib/errorMessage'
import {
  DUE_BUCKETS, EMPTY_RULES, FILTER_ICONS, filterIssues, ME,
  type DueBucket, type FilterIcon, type FilterRules,
} from '../lib/savedFilters'
import { Icon } from './Icon'
import { ProjectMark } from './ProjectMark'

/** Cere Shell-ului să deschidă filtrul (navigarea și istoricul stau în App.tsx). */
export const OPEN_FILTER_EVENT = 'hz:open-filter'
/** Filtrul a fost șters: dacă era pe ecran, Shell-ul pleacă de pe el. */
export const FILTER_DELETED_EVENT = 'hz:filter-deleted'

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

const ICON_LABEL: Record<FilterIcon, string> = {
  filter: 'Filtru', people: 'Om', urgent: 'Urgent', star: 'Stea', flag: 'Steag',
  work: 'Serviciu', home: 'Acasă', tag: 'Etichetă', today: 'Calendar', inbox: 'Inbox',
}

/**
 * Editorul unui filtru salvat: nume, iconiță, cele patru rânduri de jetoane
 * (OR în rând, AND între rânduri — vezi `lib/savedFilters`) și numărul de
 * tichete care trec, calculat pe loc peste aceleași `openIssues` pe care le
 * va arăta ecranul filtrului. Un rând gol înseamnă „oricare", și o spune.
 */
export function FilterForm({ filterId }: { filterId?: string }) {
  const { savedFilters, projects, assignees, myAssigneeId, openIssues, filterContext, createSavedFilter, updateSavedFilter, deleteSavedFilter } = useHorizontal()
  const { closeSheet } = useUI()
  const existing = filterId ? savedFilters.find((f) => f.id === filterId) ?? null : null
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState<FilterIcon>(existing?.icon ?? 'filter')
  const [rules, setRules] = useState<FilterRules>(existing?.rules ?? EMPTY_RULES)
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = useMemo(() => filterIssues(openIssues, rules, filterContext).length, [openIssues, rules, filterContext])
  const valid = name.trim().length > 0
  // „Eu" ține locul rândului meu din `assignees`: același om de două ori ar fi
  // două jetoane care fac același lucru.
  const others = assignees.filter((a) => a.id !== myAssigneeId)

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const input = { name: name.trim(), icon, rules }
      const saved = existing ? await updateSavedFilter(existing.id, input) : await createSavedFilter(input)
      closeSheet()
      window.dispatchEvent(new CustomEvent(OPEN_FILTER_EVENT, { detail: saved.id }))
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    // Două atingeri, nu un dialog: prima armează, a doua șterge.
    if (!armed) { setArmed(true); return }
    setSaving(true)
    setError(null)
    try {
      await deleteSavedFilter(existing.id)
      closeSheet()
      window.dispatchEvent(new CustomEvent(FILTER_DELETED_EVENT, { detail: existing.id }))
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
      setArmed(false)
    }
  }

  const set = (patch: Partial<FilterRules>) => setRules((r) => ({ ...r, ...patch }))
  const any = <span className="ff-any">oricare</span>

  return (
    <>
      <div className="sh-header">
        <button className="sh-close" onClick={closeSheet} aria-label="Închide"><Icon name="close" size={16} /></button>
        <input
          className="sh-title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
          placeholder="Numele filtrului…"
          aria-label="Numele filtrului"
          autoFocus={!existing}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="sh-save" onClick={() => void save()} disabled={!valid || saving} title={saving ? 'Se salvează…' : 'Salvează'} aria-label="Salvează">
          <Icon name="arrowUp" size={16} />
        </button>
      </div>

      <div className="sheet-scroll filter-form">
        <div className="sheet-section-t">Iconiță</div>
        <div className="chips ff-icons" role="radiogroup" aria-label="Iconiță">
          {FILTER_ICONS.map((ic) => (
            <button key={ic} type="button" role="radio" aria-checked={icon === ic} aria-label={ICON_LABEL[ic]} title={ICON_LABEL[ic]}
              className={`chip ff-icon ${icon === ic ? 'on' : ''}`} onClick={() => setIcon(ic)}>
              <Icon name={ic} size={16} />
            </button>
          ))}
        </div>

        <div className="sheet-section-t">Proiecte {rules.projects.length === 0 && any}</div>
        <div className="chips">
          {projects.map((p) => (
            <button key={p.id} type="button" aria-pressed={rules.projects.includes(p.id)}
              className={`chip ${rules.projects.includes(p.id) ? 'on' : ''}`}
              onClick={() => set({ projects: toggle(rules.projects, p.id) })}>
              <ProjectMark project={p} dot="cdot" size={13} />{p.name}
            </button>
          ))}
        </div>

        <div className="sheet-section-t">Persoane {rules.people.length === 0 && any}</div>
        <div className="chips">
          <button type="button" aria-pressed={rules.people.includes(ME)}
            className={`chip ${rules.people.includes(ME) ? 'on' : ''}`}
            onClick={() => set({ people: toggle(rules.people, ME) })}>
            <Icon name="people" size={13} /> Eu
          </button>
          {others.map((a) => (
            <button key={a.id} type="button" aria-pressed={rules.people.includes(a.id)}
              className={`chip ${rules.people.includes(a.id) ? 'on' : ''}`}
              onClick={() => set({ people: toggle(rules.people, a.id) })}>
              {a.name}
            </button>
          ))}
        </div>
        <p className="ff-note">Ale cuiva = pasate lui + create de el și nepasate nimănui.</p>

        <div className="sheet-section-t">Scadență {rules.due.length === 0 && any}</div>
        <div className="chips">
          {DUE_BUCKETS.map((b) => (
            <button key={b.key} type="button" aria-pressed={rules.due.includes(b.key)}
              className={`chip ${rules.due.includes(b.key) ? 'on' : ''}`}
              onClick={() => set({ due: toggle<DueBucket>(rules.due, b.key) })}>
              {b.label}
            </button>
          ))}
        </div>

        <div className="sheet-section-t">Urgent</div>
        <div className="chips">
          <button type="button" aria-pressed={!rules.urgent} className={`chip ${!rules.urgent ? 'on' : ''}`} onClick={() => set({ urgent: false })}>Indiferent</button>
          <button type="button" aria-pressed={rules.urgent} className={`chip ${rules.urgent ? 'on' : ''}`} onClick={() => set({ urgent: true })}>
            <Icon name="urgent" size={13} /> Doar urgente
          </button>
        </div>

        <p className="ff-preview" role="status">
          <span className="ff-n">{count}</span> {count === 1 ? 'tichet deschis' : 'tichete deschise'}
        </p>

        {error && <div className="banner">⚠ {error}</div>}

        {existing && (
          <button type="button" className={`ff-delete ${armed ? 'armed' : ''}`} onClick={() => void remove()} disabled={saving}>
            <Icon name="delete" size={15} /> {armed ? 'Apasă din nou ca să ștergi' : 'Șterge filtrul'}
          </button>
        )}
      </div>
    </>
  )
}
