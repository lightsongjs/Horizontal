import { useRef, useState, useEffect, forwardRef } from 'react'
import { detectCycle, requiredDepWave } from '../lib/engine'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import type { Issue, ScenarioKind, TestScenario } from '../lib/types'

const PALETTE = ['#0284C7', '#059669', '#D97706', '#EA580C', '#E11D48', '#7C3AED', '#06B6D4']

const BADGE_CYCLE: { kind: ScenarioKind; icon: string }[] = [
  { kind: 'pass',    icon: '✓' },
  { kind: 'fail',    icon: '✕' },
  { kind: 'neutral', icon: '○' },
]

type DraftIssue = { tempId: string; title: string }
let draftCounter = 0
const newTempId = () => `__draft_${++draftCounter}__`

const AutoTextarea = forwardRef<HTMLTextAreaElement, {
  value: string; onChange: (v: string) => void; placeholder?: string; minH?: number
}>(function AutoTextarea({ value, onChange, placeholder, minH = 80 }, forwardedRef) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = innerRef.current; if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(minH, el.scrollHeight) + 'px'
  }, [value, minH])
  return (
    <textarea
      ref={(el) => {
        (innerRef as { current: HTMLTextAreaElement | null }).current = el
        if (typeof forwardedRef === 'function') forwardedRef(el)
        else if (forwardedRef) (forwardedRef as { current: HTMLTextAreaElement | null }).current = el
      }}
      value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} style={{ minHeight: minH, resize: 'none', overflow: 'hidden' }} />
  )
})

function DepSearch({ label, selected, drafts, candidates, onToggle, onToggleDraft, onCreateDraft, onNavigate }: {
  label: string; selected: string[]; drafts: DraftIssue[]; candidates: Issue[]
  onToggle: (id: string) => void; onToggleDraft: (d: DraftIssue) => void; onCreateDraft: (title: string) => void
  onNavigate?: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [hlIdx, setHlIdx] = useState(0)

  const filtered = q.trim() ? candidates.filter((i) => i.title.toLowerCase().includes(q.toLowerCase())) : []
  const hasExact = candidates.some((i) => i.title.toLowerCase() === q.toLowerCase().trim())
  const showCreate = q.trim() && !hasExact

  // Options list: filtered results + optional create entry
  const optionCount = filtered.length + (showCreate ? 1 : 0)

  const handleChange = (v: string) => { setQ(v); setHlIdx(0) }

  const selectFiltered = (i: Issue) => { onToggle(i.id); setQ(''); setHlIdx(0) }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!optionCount) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx((p) => Math.min(p + 1, optionCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx((p) => Math.max(p - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (hlIdx < filtered.length) {
        selectFiltered(filtered[hlIdx])
      } else if (showCreate) {
        onCreateDraft(q.trim()); setQ(''); setHlIdx(0)
      }
    } else if (e.key === 'Escape') { setQ(''); setHlIdx(0) }
  }

  return (
    <div className="dep-search-block">
      <label className="if-field-label">{label}</label>
      {selected.length > 0 && (
        <div className="dep-selected">
          {selected.map((id) => {
            const issue = candidates.find((i) => i.id === id)
            if (!issue) return null
            return (
              <div key={id} className="dep-chip on">
                <button className="dep-chip-body" onClick={() => onNavigate?.(id)}>
                  <span className="dep-chip-id">{id}</span>
                  <span className="dep-chip-title">{issue.title}</span>
                </button>
                <button className="dep-chip-x-btn" onClick={() => onToggle(id)}>×</button>
              </div>
            )
          })}
          {drafts.filter((d) => selected.includes(d.tempId)).map((d) => (
            <div key={d.tempId} className="dep-chip on draft">
              <span className="dep-chip-body dep-chip-body--static">
                <span className="dep-chip-id">nou</span>
                <span className="dep-chip-title">{d.title}</span>
              </span>
              <button className="dep-chip-x-btn" onClick={() => onToggleDraft(d)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="dep-search-wrap">
        <input value={q} onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Caută sau creează tichet…" className="dep-search-input"
          autoComplete="off" autoCorrect="off" inputMode="text" />
      </div>
      {q.trim() && (
        <div className="dep-results">
          {filtered.map((i, idx) => {
            const on = selected.includes(i.id)
            const hl = idx === hlIdx
            return (
              <button key={i.id} className={`dep-result-row ${on ? 'on' : ''} ${hl ? 'hl' : ''}`}
                onClick={() => selectFiltered(i)}>
                <span className={`ic ${on ? 'ok' : 'ext'}`}>{on ? '✓' : '+'}</span>
                <span className="dep-result-title">{i.title}</span>
                <span className="tk-id">{i.id}</span>
              </button>
            )
          })}
          {filtered.length === 0 && !showCreate && <p className="dep-no-results">Niciun tichet găsit.</p>}
          {showCreate && (
            <button className={`dep-create-btn ${hlIdx === filtered.length ? 'hl' : ''}`}
              onClick={() => { onCreateDraft(q.trim()); setQ(''); setHlIdx(0) }}>
              <span className="dep-create-plus">+</span>
              Creează <strong>«{q.trim()}»</strong> și leagă
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AssigneeSearch({ assigneeId, assignees, myAssigneeId, onSelect, onSetMe, onCreateAndSelect }: {
  assigneeId: string | null
  assignees: import('../lib/types').Assignee[]
  myAssigneeId: string | null
  onSelect(id: string | null): void
  onSetMe(id: string): void
  onCreateAndSelect(name: string): Promise<void>
}) {
  const [q, setQ] = useState('')
  const [hlIdx, setHlIdx] = useState(0)
  const [creating, setCreating] = useState(false)

  const sorted = [...assignees].sort((a, b) => {
    if (a.id === myAssigneeId) return -1
    if (b.id === myAssigneeId) return 1
    return a.name.localeCompare(b.name)
  })

  const filtered = q.trim() ? sorted.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())) : sorted
  const hasExact = assignees.some((a) => a.name.toLowerCase() === q.toLowerCase().trim())
  const showCreate = q.trim() && !hasExact
  const optionCount = filtered.length + (showCreate ? 1 : 0)

  const selected = assigneeId ? assignees.find((a) => a.id === assigneeId) : null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!optionCount) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx((p) => Math.min(p + 1, optionCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx((p) => Math.max(p - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (hlIdx < filtered.length) { onSelect(filtered[hlIdx].id); setQ(''); setHlIdx(0) }
      else if (showCreate) handleCreate()
    } else if (e.key === 'Escape') { setQ(''); setHlIdx(0) }
  }

  const handleCreate = async () => {
    const name = q.trim(); if (!name || creating) return
    setCreating(true)
    try { await onCreateAndSelect(name); setQ(''); setHlIdx(0) } finally { setCreating(false) }
  }

  return (
    <div className="dep-search-block">
      <label className="if-field-label">Assigned to</label>
      {selected && (
        <div className="dep-selected">
          <button className="dep-chip on" onClick={() => onSelect(null)}>
            <span className="dep-chip-title">{selected.name}{selected.id === myAssigneeId ? ' (me)' : ''}</span>
            <span className="dep-chip-x">×</span>
          </button>
        </div>
      )}
      <div className="dep-search-wrap">
        <input value={q} onChange={(e) => { setQ(e.target.value); setHlIdx(0) }}
          onKeyDown={handleKeyDown}
          placeholder="Search or add person…"
          className="dep-search-input" autoComplete="off" autoCorrect="off" inputMode="text" />
      </div>
      {q.trim() && (
        <div className="dep-results">
          {filtered.map((a, idx) => (
            <button key={a.id} className={`dep-result-row ${a.id === assigneeId ? 'on' : ''} ${idx === hlIdx ? 'hl' : ''}`}
              onClick={() => { onSelect(a.id); setQ(''); setHlIdx(0) }}>
              <span className={`ic ${a.id === assigneeId ? 'ok' : 'ext'}`}>{a.id === assigneeId ? '✓' : '+'}</span>
              <span className="dep-result-title">{a.name}{a.id === myAssigneeId ? ' (me)' : ''}</span>
              {a.id !== myAssigneeId && (
                <button style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5, padding: '0 4px' }}
                  onClick={(e) => { e.stopPropagation(); onSetMe(a.id) }} title="This is me">
                  ★
                </button>
              )}
            </button>
          ))}
          {filtered.length === 0 && !showCreate && <p className="dep-no-results">No one found.</p>}
          {showCreate && (
            <button className={`dep-create-btn ${hlIdx === filtered.length ? 'hl' : ''}`}
              onClick={handleCreate} disabled={creating}>
              <span className="dep-create-plus">+</span>
              Add <strong>«{q.trim()}»</strong>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function IssueForm({ issueId }: { issueId?: string }) {
  const { project, waves, themes, issues, byId, activeWave, createIssue, updateIssue, deleteIssue, createTheme, assignees, myAssigneeId, setMyAssigneeId, createAssignee } = useHorizontal()
  const { closeSheet, setCloseGuard, pushSheet } = useUI()
  const existing = issueId ? byId[issueId] : undefined
  const isEdit = !!existing

  const defaultAssigneeId = !isEdit && project?.type === 'personal' ? (myAssigneeId ?? null) : null

  const [title, setTitle] = useState(existing?.title ?? '')
  const [desc, setDesc] = useState(existing?.desc ?? '')
  const [theme, setTheme] = useState(existing?.theme ?? '')
  const [wave, setWave] = useState(existing?.wave ?? activeWave)
  const [assigneeId, setAssigneeId] = useState<string | null>(existing?.assigneeId ?? defaultAssigneeId)
  const [deps, setDeps] = useState<string[]>(existing?.deps ?? [])
  const [blocks, setBlocks] = useState<string[]>(
    existing ? issues.filter((i) => i.deps?.includes(existing.id)).map((i) => i.id) : []
  )
  const [draftDeps, setDraftDeps] = useState<DraftIssue[]>([])
  const [draftBlocks, setDraftBlocks] = useState<DraftIssue[]>([])

  const [selectors, setSelectors] = useState<string[]>(existing?.selectors ?? [])
  const [scenarios, setScenarios] = useState<TestScenario[]>(existing?.scenarios ?? [])
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const [showNewTheme, setShowNewTheme] = useState(false)
  const [newThemeName, setNewThemeName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [cycleMsg, setCycleMsg] = useState<string | null>(null)
  const [waveError, setWaveError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [depTab, setDepTab] = useState<'necesita' | 'permite'>('necesita')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (isEdit && titleInputRef.current) {
      titleInputRef.current.setSelectionRange(0, 0)
      titleInputRef.current.scrollLeft = 0
    }
  }, [])
  const [showAssigneeInline, setShowAssigneeInline] = useState(false)

  const isDirty = isEdit
    ? title !== (existing?.title ?? '') || desc !== (existing?.desc ?? '') ||
      theme !== (existing?.theme ?? '') || wave !== (existing?.wave ?? activeWave) ||
      JSON.stringify(selectors) !== JSON.stringify(existing?.selectors ?? []) ||
      JSON.stringify(scenarios) !== JSON.stringify(existing?.scenarios ?? []) ||
      notes !== (existing?.notes ?? '')
    : title.trim() !== '' || desc.trim() !== '' || selectors.length > 0 || scenarios.length > 0 || notes.trim() !== ''

  useEffect(() => {
    if (isDirty) {
      setCloseGuard(() => { setConfirmClose(true); return false })
    } else {
      setCloseGuard(null)
    }
    return () => setCloseGuard(null)
  }, [isDirty, setCloseGuard])

  // Cmd+Enter to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!project) return null

  const candidates = issues.filter((i) => i.id !== issueId)
  const toggle = (set: string[], setSet: (v: string[]) => void, id: string) =>
    setSet(set.includes(id) ? set.filter((x) => x !== id) : [...set, id])
  const toggleDraft = (ds: DraftIssue[], setDs: (v: DraftIssue[]) => void, ids: string[], setIds: (v: string[]) => void, d: DraftIssue) => {
    if (ids.includes(d.tempId)) { setIds(ids.filter((x) => x !== d.tempId)); setDs(ds.filter((x) => x.tempId !== d.tempId)) }
  }
  const createDraftDep = (t: string) => { const d = { tempId: newTempId(), title: t }; setDraftDeps((p) => [...p, d]); setDeps((p) => [...p, d.tempId]) }
  const createDraftBlock = (t: string) => { const d = { tempId: newTempId(), title: t }; setDraftBlocks((p) => [...p, d]); setBlocks((p) => [...p, d.tempId]) }

  const addTheme = async () => {
    const name = newThemeName.trim(); if (!name) return
    const created = await createTheme(name, PALETTE[themes.length % PALETTE.length])
    if (created) setTheme(created.key)
    setNewThemeName(''); setShowNewTheme(false)
  }

  // Selector helpers
  const addSelector = () => setSelectors((p) => [...p, ''])
  const updateSelector = (i: number, val: string) => setSelectors((p) => p.map((s, idx) => idx === i ? val : s))
  const removeSelector = (i: number) => setSelectors((p) => p.filter((_, idx) => idx !== i))

  // Scenario helpers
  const addScenario = () => setScenarios((p) => [...p, { text: '', kind: 'neutral' }])
  const updateScenarioText = (i: number, text: string) => setScenarios((p) => p.map((s, idx) => idx === i ? { ...s, text } : s))
  const cycleScenarioBadge = (i: number) => setScenarios((p) => p.map((s, idx) => {
    if (idx !== i) return s
    const cur = BADGE_CYCLE.findIndex((b) => b.kind === s.kind)
    return { ...s, kind: BADGE_CYCLE[(cur + 1) % BADGE_CYCLE.length].kind }
  }))
  const removeScenario = (i: number) => setScenarios((p) => p.filter((_, idx) => idx !== i))

  const cycleAfterSave = (): string | null => {
    const targetId = existing?.id ?? '__new__'
    const titleOf = (id: string) => id === targetId ? title.trim() || '(nou)' : byId[id]?.title ?? id
    const prospective: Issue[] = issues.map((i) => ({ ...i, deps: [...(i.deps ?? [])] }))
    let target = prospective.find((i) => i.id === targetId)
    if (!target) {
      target = { id: targetId, projectId: project.id, title, desc: '', theme, wave, deps: [], done: false, selectors: [], scenarios: [], notes: '', assigneeId: null }
      prospective.push(target)
    }
    target.deps = [...deps.filter((d) => !d.startsWith('__draft_'))]
    for (const p of prospective) {
      if (p.id === targetId) continue
      const realBlocks = blocks.filter((b) => !b.startsWith('__draft_'))
      const shouldDepend = realBlocks.includes(p.id)
      const has = p.deps.includes(targetId)
      if (shouldDepend && !has) p.deps = [...p.deps, targetId]
      if (!shouldDepend && has) p.deps = p.deps.filter((d) => d !== targetId)
    }
    const cycle = detectCycle(prospective)
    return cycle ? cycle.map(titleOf).join(' → ') : null
  }

  const save = async () => {
    if (!title.trim() || saving) return
    const cyc = cycleAfterSave()
    if (cyc) { setCycleMsg(cyc); return }
    setCycleMsg(null); setSaving(true)
    try {
      const draftDepMap: Record<string, string> = {}
      for (const d of draftDeps) {
        if (deps.includes(d.tempId)) {
          const created = await createIssue({ projectId: project.id, title: d.title, desc: '', theme, wave, deps: [] })
          draftDepMap[d.tempId] = created.id
        }
      }
      const draftBlockMap: Record<string, string> = {}
      for (const d of draftBlocks) {
        if (blocks.includes(d.tempId)) {
          const created = await createIssue({ projectId: project.id, title: d.title, desc: '', theme, wave, deps: [] })
          draftBlockMap[d.tempId] = created.id
        }
      }
      const realDeps = deps.map((id) => draftDepMap[id] ?? (id.startsWith('__draft_') ? null : id)).filter(Boolean) as string[]
      const qaPayload = { selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId }
      const targetId = isEdit
        ? (await updateIssue(existing!.id, { title: title.trim(), desc: desc.trim(), theme, wave, deps: realDeps, ...qaPayload }), existing!.id)
        : (await createIssue({ projectId: project.id, title: title.trim(), desc: desc.trim(), theme, wave, deps: realDeps, ...qaPayload })).id
      const realBlocks = blocks.map((id) => draftBlockMap[id] ?? (id.startsWith('__draft_') ? null : id)).filter(Boolean) as string[]
      const currentBlockers = issues.filter((i) => i.deps?.includes(targetId)).map((i) => i.id)
      for (const b of realBlocks.filter((b) => !currentBlockers.includes(b))) {
        const bi = byId[b]; if (bi) await updateIssue(b, { deps: [...(bi.deps ?? []), targetId] })
      }
      for (const b of currentBlockers.filter((b) => !realBlocks.includes(b))) {
        const bi = byId[b]; if (bi) await updateIssue(b, { deps: (bi.deps ?? []).filter((d) => d !== targetId) })
      }
      for (const [tempId, realId] of Object.entries(draftBlockMap)) {
        if (blocks.includes(tempId)) await updateIssue(realId, { deps: [targetId] })
      }

      // Cascade: auto-move deps to min(wave of their dependants)
      let snap = issues.map((i) => {
        if (i.id === targetId) return { ...i, wave, deps: realDeps }
        if (realBlocks.includes(i.id) && !currentBlockers.includes(i.id))
          return { ...i, deps: [...(i.deps ?? []), targetId] }
        if (currentBlockers.includes(i.id) && !realBlocks.includes(i.id))
          return { ...i, deps: (i.deps ?? []).filter((d) => d !== targetId) }
        return i
      })
      // For new issues, targetId wasn't in issues yet — add it so cascade sees it as a dependant
      if (!snap.find((i) => i.id === targetId)) {
        snap = [...snap, { id: targetId, projectId: project.id, title: title.trim(), desc: desc.trim(), theme, wave, deps: realDeps, done: false, selectors: selectors.filter(Boolean), scenarios, notes: notes.trim(), assigneeId }]
      }
      const cascadeQueue = [...realDeps]
      const cascadeSeen = new Set<string>()
      while (cascadeQueue.length > 0) {
        const depId = cascadeQueue.shift()!
        if (cascadeSeen.has(depId)) continue
        cascadeSeen.add(depId)
        const dep = snap.find((i) => i.id === depId)
        if (!dep) continue
        const req = requiredDepWave(depId, snap)
        if (req !== null && dep.wave !== req) {
          await updateIssue(depId, { wave: req })
          snap = snap.map((i) => (i.id === depId ? { ...i, wave: req } : i))
          for (const d of dep.deps ?? []) cascadeQueue.push(d)
        }
      }

      setCloseGuard(null); closeSheet()
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!existing || saving) return
    setSaving(true)
    try { await deleteIssue(existing.id); setCloseGuard(null); closeSheet() }
    finally { setSaving(false) }
  }

  const badgeIcon = (kind: ScenarioKind) => BADGE_CYCLE.find((b) => b.kind === kind)?.icon ?? '○'

  return (
    <>
      {/* NEW HEADER */}
      <div className="sh-header">
        <button className="sh-close" onClick={closeSheet} aria-label="Închide">✕</button>
        <input
          ref={titleInputRef}
          className="sh-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={isEdit ? `✎ ${existing!.id}` : 'Titlu tichet…'}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          inputMode="text"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault()
              descRef.current?.focus()
            }
          }}
        />
        <button
          tabIndex={-1}
          className="sh-save"
          onClick={save}
          disabled={!title.trim() || saving || waves.length === 0}
          title={saving ? 'Se salvează…' : 'Salvează'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"/>
            <polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      </div>

      {/* BODY */}
      <div className="sheet-scroll if-body">

        {/* META SECTION — Temă · Val · Assigned to — un singur rând */}
        <div className="sh-meta-section">
          <div className="sh-meta-inline-row">

            {/* Temă — 3/4 din lățime */}
            <div className="meta-col meta-col-theme">
              <span className="meta-row-label">Temă</span>
              <div className="pills-row">
                <button tabIndex={-1} className={`if-meta-pill ${theme === '' ? 'active' : ''}`} onClick={() => setTheme('')}>Fără</button>
                {themes.map((t) => (
                  <button tabIndex={-1} key={t.key} className={`if-meta-pill ${theme === t.key ? 'active' : ''}`} onClick={() => setTheme(t.key)}>
                    <span className="if-meta-dot" style={{ background: t.color }} />{t.name}
                  </button>
                ))}
                <button tabIndex={-1} className="if-meta-add" onClick={() => setShowNewTheme((v) => !v)} title="Temă nouă">
                  {showNewTheme ? '×' : '+'}
                </button>
              </div>
            </div>

            <div className="meta-vsep" />

            {/* Val */}
            <div className="meta-col meta-col-wave">
              <span className="meta-row-label">Val</span>
              <div className="pills-row">
                {waves.map((w) => (
                  <button tabIndex={-1} key={w.number} className={`if-meta-wave ${wave === w.number ? 'active' : ''}`} onClick={() => {
                    if (isEdit && existing) {
                      const dependants = issues.filter((i) => (i.deps ?? []).includes(existing.id))
                      if (dependants.length > 0) {
                        const required = Math.min(...dependants.map((d) => d.wave))
                        if (w.number !== required) {
                          const names = dependants.map((d) => `„${d.title}" (val ${d.wave})`).join(', ')
                          setWaveError(`„${title}" este o dependență a ${names}. Nu poți muta tichetul.`)
                          return
                        }
                      }
                    }
                    setWave(w.number)
                    setWaveError(null)
                  }}>
                    {w.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="meta-vsep" />

            {/* Assigned to */}
            <div className="meta-col meta-col-assign">
              <span className="meta-row-label">Assigned to</span>
              <div className="meta-row-inline">
                {assigneeId && !showAssigneeInline && (() => {
                  const a = assignees.find((x) => x.id === assigneeId)
                  return a ? (
                    <div className="assignee-chip-inline">
                      <div className="assignee-avatar-sm">{a.name.slice(0, 2).toUpperCase()}</div>
                      <span className="assignee-name-sm">{a.name}{a.id === myAssigneeId ? ' (me)' : ''}</span>
                      <span className="assignee-x-sm" tabIndex={-1} onClick={() => setAssigneeId(null)}>×</span>
                    </div>
                  ) : null
                })()}
                <button tabIndex={-1} className="if-meta-add" onClick={() => setShowAssigneeInline((v) => !v)}>
                  {showAssigneeInline ? '×' : '+'}
                </button>
              </div>
            </div>

          </div>{/* end sh-meta-inline-row */}

          {/* Expandabile sub rând */}
          {showNewTheme && (
            <div className="inline-search-wrap" style={{ padding: '6px 12px 8px' }}>
              <input
                className="inline-search-input"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTheme()}
                placeholder="Nume temă nouă…"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
              />
              <button className="inline-ok-btn" onClick={addTheme} disabled={!newThemeName.trim()}>OK</button>
            </div>
          )}
          {showAssigneeInline && (
            <div className="inline-search-wrap" style={{ padding: '6px 12px 8px' }}>
              <AssigneeSearch
                assigneeId={null}
                assignees={assignees}
                myAssigneeId={myAssigneeId}
                onSelect={(id) => { setAssigneeId(id); setShowAssigneeInline(false) }}
                onSetMe={setMyAssigneeId}
                onCreateAndSelect={async (name) => {
                  const a = await createAssignee(name)
                  setAssigneeId(a.id)
                  setShowAssigneeInline(false)
                }}
              />
            </div>
          )}
        </div>{/* end sh-meta-section */}

        {/* MAIN FORM — 2 cols desktop, 1 col mobile */}
        <div className="form-cols">

          {/* LEFT COL */}
          <div className="form-col">

            <div className="fld">
              <label className="if-field-label">Descriere</label>
              <AutoTextarea ref={descRef} value={desc} onChange={setDesc} placeholder="Cerințe, notițe, context…" minH={300} />
            </div>

            {/* Dependențe — tabbed Necesită / Permite */}
            <div className="sh-dep-section">
              <div className="sh-dep-tabs">
                {(() => {
                  const necCount = deps.filter((d) => !d.startsWith('__draft_')).length + draftDeps.filter((d) => deps.includes(d.tempId)).length
                  const perCount = blocks.filter((b) => !b.startsWith('__draft_')).length + draftBlocks.filter((d) => blocks.includes(d.tempId)).length
                  return (
                    <>
                      <button className={`sh-dep-tab ${depTab === 'necesita' ? 'on' : ''}`} onClick={() => setDepTab('necesita')}>
                        ← Necesită{necCount > 0 && <span className="dep-count"> ({necCount})</span>}
                      </button>
                      <button className={`sh-dep-tab ${depTab === 'permite' ? 'on' : ''}`} onClick={() => setDepTab('permite')}>
                        → Permite{perCount > 0 && <span className="dep-count"> ({perCount})</span>}
                      </button>
                    </>
                  )
                })()}
              </div>
              <p className="dep-tab-hint">
                {depTab === 'necesita' ? 'Ce trebuie să existe înainte de acest tichet?' : 'Ce deblochează sau face posibil acest tichet?'}
              </p>
              {depTab === 'necesita' && (
                <DepSearch label="" selected={deps} drafts={draftDeps} candidates={candidates}
                  onToggle={(id) => toggle(deps, setDeps, id)}
                  onToggleDraft={(d) => toggleDraft(draftDeps, setDraftDeps, deps, setDeps, d)}
                  onNavigate={(id) => pushSheet({ kind: 'issue', issueId: id })}
                  onCreateDraft={createDraftDep} />
              )}
              {depTab === 'permite' && (
                <DepSearch label="" selected={blocks} drafts={draftBlocks} candidates={candidates}
                  onToggle={(id) => toggle(blocks, setBlocks, id)}
                  onToggleDraft={(d) => toggleDraft(draftBlocks, setDraftBlocks, blocks, setBlocks, d)}
                  onNavigate={(id) => pushSheet({ kind: 'issue', issueId: id })}
                  onCreateDraft={createDraftBlock} />
              )}
            </div>

            {isEdit && (
              <button className="add-dep" style={{ marginTop: 8, borderColor: 'rgba(225,29,72,0.3)', color: 'var(--blocked)' }}
                onClick={() => confirmDel ? void remove() : setConfirmDel(true)}>
                {confirmDel ? '⚠ Apasă din nou ca să confirmi ștergerea' : '🗑 Șterge tichetul'}
              </button>
            )}

          </div>

          {/* RIGHT COL */}
          <div className="form-col">

            <div className="fld">
              <label className="if-field-label">Playwright Selectors</label>
              <div className="if-sc-list">
                {selectors.map((s, i) => (
                  <div key={i} className="if-sc-item">
                    <span className="if-badge selector">⬡</span>
                    <input value={s} onChange={(e) => updateSelector(i, e.target.value)}
                      placeholder="getByRole('button', { name: 'Login' })"
                      style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                      autoComplete="off" autoCorrect="off" inputMode="text" />
                    <button className="if-sc-del" onClick={() => removeSelector(i)}>×</button>
                  </div>
                ))}
              </div>
              <button className="if-add-btn" onClick={addSelector}>
                <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>+</span>
                Adaugă selector
              </button>
            </div>

            <div className="fld">
              <label className="if-field-label">Test Scenarios</label>
              <div className="if-sc-list">
                {scenarios.map((s, i) => (
                  <div key={i} className="if-sc-item">
                    <span className={`if-badge ${s.kind}`} onClick={() => cycleScenarioBadge(i)} title="Click schimbă tipul">
                      {badgeIcon(s.kind)}
                    </span>
                    <input value={s.text} onChange={(e) => updateScenarioText(i, e.target.value)}
                      placeholder="Ex: Login reușit cu date valide"
                      autoComplete="off" autoCorrect="off" inputMode="text" />
                    <button className="if-sc-del" onClick={() => removeScenario(i)}>×</button>
                  </div>
                ))}
              </div>
              <button className="if-add-btn" onClick={addScenario}>
                <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>+</span>
                Adaugă scenariu
              </button>
            </div>

            <div className="fld">
              <label className="if-field-label">Note</label>
              <AutoTextarea value={notes} onChange={setNotes}
                placeholder="Observații libere, edge cases, links…" minH={100} />
            </div>

          </div>
        </div>{/* end form-cols */}

        {cycleMsg && (
          <div className="banner" style={{ marginTop: 12 }}>⚠ Asta ar crea un ciclu: {cycleMsg}</div>
        )}
        {waveError && (
          <div className="banner" style={{ marginTop: 12 }}>⚠ {waveError}</div>
        )}
      </div>{/* end sheet-scroll */}

      {confirmClose && (
        <div className="ccm-overlay" role="dialog" aria-modal="true">
          <div className="ccm-box">
            <p className="ccm-msg">Ai modificări nesalvate.</p>
            <div
              className="ccm-btns"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
                  const idx = btns.indexOf(document.activeElement as HTMLButtonElement)
                  if (idx !== -1) btns[(idx + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length].focus()
                }
              }}
            >
              <button className="ccm-stay" autoFocus onClick={() => setConfirmClose(false)}>
                Rămâi pe pagină
              </button>
              <button className="ccm-exit" onClick={() => { setCloseGuard(null); closeSheet() }}>
                Ieși din pagină
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
