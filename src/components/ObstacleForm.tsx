import { useMemo, useState } from 'react'
import { useHorizontal } from '../store'
import { useUI } from '../ui'
import { waitingDays } from '../lib/obstacles'
import { Icon } from './Icon'
import type { ObstacleEvidence, ObstacleState } from '../lib/types'

const STATES: { key: ObstacleState; label: string }[] = [
  { key: 'necunoscut', label: 'necunoscut' },
  { key: 'asteptare', label: 'în așteptare' },
  { key: 'depasit', label: 'depășit' },
  { key: 'ocolit', label: 'ocolit' },
]

const EVIDENCE: { key: ObstacleEvidence; label: string }[] = [
  { key: 'verificat', label: 'verificat' },
  { key: 'plauzibil', label: 'plauzibil' },
  { key: 'necunoscut', label: 'nu știu' },
]

export function ObstacleForm({ obstacleId }: { obstacleId?: string }) {
  const { obstacles, issues, issuesOf, createObstacle, updateObstacle, deleteObstacle, setObstacleIssues } =
    useHorizontal()
  const { closeSheet } = useUI()
  const existing = obstacleId ? obstacles.find((o) => o.id === obstacleId) : undefined

  const [title, setTitle] = useState(existing?.title ?? '')
  const [detail, setDetail] = useState(existing?.detail ?? '')
  const [owner, setOwner] = useState(existing?.owner ?? '')
  const [state, setState] = useState<ObstacleState>(existing?.state ?? 'necunoscut')
  const [blocking, setBlocking] = useState(existing?.blocking ?? true)
  const [bypass, setBypass] = useState(existing?.bypass ?? '')
  const [evidence, setEvidence] = useState<ObstacleEvidence>(existing?.evidence ?? 'necunoscut')
  const [issueIds, setIssueIds] = useState<string[]>(
    existing ? issuesOf(existing.id).map((i) => i.id) : [],
  )

  const days = useMemo(
    () => (existing ? waitingDays({ ...existing, state }, new Date()) : null),
    [existing, state],
  )

  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const valid = title.trim().length > 0

  // Tichetele deja legate, în ordinea în care au fost adăugate — nu sortate,
  // ca lista să nu-și rearanjeze rândurile sub degetul cuiva care le scoate.
  const linked = issueIds
    .map((id) => issues.find((i) => i.id === id))
    .filter((i): i is (typeof issues)[number] => !!i)

  const results = q.trim()
    ? issues.filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase()))
    : []

  const toggleIssue = (id: string) => {
    setIssueIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      const patch = {
        title: title.trim(),
        detail,
        owner: owner.trim(),
        state,
        blocking,
        // Gol ⇒ null, nu '': null chiar înseamnă „nu are ocolire" — harta
        // desenează colțul retezat exact pe bypass !== null.
        bypass: bypass.trim() === '' ? null : bypass,
        evidence,
        // Se pune singur la prima trecere în „în așteptare": „fără răspuns de
        // N zile" e inutil dacă cere un pas manual pe care oricine îl uită.
        askedAt: state === 'asteptare' && !existing?.askedAt ? new Date().toISOString() : existing?.askedAt ?? null,
      }
      if (existing) {
        await updateObstacle(existing.id, patch)
        await setObstacleIssues(existing.id, issueIds)
      } else {
        const created = await createObstacle({ ...patch, issueIds })
        if (!created) return
      }
      closeSheet()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing || saving) return
    if (!confirmDel) {
      setConfirmDel(true)
      return
    }
    setSaving(true)
    try {
      await deleteObstacle(existing.id)
      closeSheet()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="sheet-head">
        <div className="eyebrow"><Icon name="obstacle" size={13} /> Obstacol</div>
        <h2>{existing ? existing.title || 'Obstacol' : 'Obstacol nou'}</h2>
        <p>O condiție din afara muncii, care trebuie să cadă înainte ca tichetele legate să pornească.</p>
      </div>
      <div className="sheet-scroll">
        <div className="fld">
          <label>Titlu</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ce anume blochează" autoFocus />
        </div>
        <div className="fld">
          <label>Detaliu</label>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Context, cine a fost întrebat, ce lipsește…"
          />
        </div>
        <div className="fld">
          <label>Cine îl scoate</label>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Echipa de API" />
        </div>

        <div className="sheet-section-t">Stare</div>
        <div className="seg-row">
          {STATES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`seg ${state === s.key ? 'on' : ''}`}
              onClick={() => setState(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {days !== null && <div className="obst-wait">fără răspuns de {days} zile</div>}

        <div className="fld">
          <label>Ocolire</label>
          <textarea value={bypass} onChange={(e) => setBypass(e.target.value)} placeholder="Nu există" />
        </div>

        <div className="sheet-section-t">Dovadă</div>
        <div className="seg-row">
          {EVIDENCE.map((ev) => (
            <button
              key={ev.key}
              type="button"
              className={`seg ${evidence === ev.key ? 'on' : ''}`}
              onClick={() => setEvidence(ev.key)}
            >
              {ev.label}
            </button>
          ))}
        </div>

        <div className="srow">
          <span className="skey">Blochează</span>
          <span className="sval">
            <button type="button" className={`seg sm ${blocking ? 'on' : ''}`} onClick={() => setBlocking(true)}>Da</button>
            <button type="button" className={`seg sm ${!blocking ? 'on' : ''}`} onClick={() => setBlocking(false)}>Nu</button>
          </span>
        </div>
        {!blocking && <p className="obst-help">Se vede pe hartă, dar nu stinge niciun tichet.</p>}

        <div className="sheet-section-t">Tichetele blocate ({linked.length})</div>
        <div className="dep-search-block">
          {linked.length > 0 && (
            <div className="dep-selected">
              {linked.map((i) => (
                <span key={i.id} className="obst-chip blk">
                  <span className="obst-chip-t">{i.id} · {i.title}</span>
                  <button
                    type="button"
                    className="obst-chip-x"
                    onClick={() => toggleIssue(i.id)}
                    aria-label={`Scoate ${i.title}`}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="dep-search-wrap">
            <input
              className="dep-search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Caută tichete…"
              autoComplete="off"
              autoCorrect="off"
              inputMode="text"
            />
          </div>
          {q.trim() && (
            <div className="dep-results">
              {results.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className={`dep-result-row ${issueIds.includes(i.id) ? 'on' : ''}`}
                  onClick={() => toggleIssue(i.id)}
                >
                  <Icon name={issueIds.includes(i.id) ? 'check' : 'add'} size={14} />
                  <span className="dep-result-title">{i.title}</span>
                  <span className="dep-chip-id">{i.id}</span>
                </button>
              ))}
              {results.length === 0 && <p className="dep-no-results">Niciun tichet găsit.</p>}
            </div>
          )}
        </div>

        <div className="save-bar">
          <button onClick={save} disabled={!valid || saving}>
            {saving ? 'Se salvează…' : 'Salvează'}
          </button>
        </div>

        {existing && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
            <button className="wave-del" title="Șterge obstacolul" onClick={remove} disabled={saving}>
              {confirmDel ? 'Sigur?' : <Icon name="delete" size={15} label="Șterge obstacolul" />}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
