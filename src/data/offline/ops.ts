// Coada de scrieri offline — tipurile și tot ce se poate calcula fără I/O.
//
// Regula centrală: baza (ultimul răspuns al serverului) nu se modifică niciodată
// cu o scriere locală. Ce vede aplicația = baza + coada rejucată peste ea
// (`overlay`). Așa o scriere refuzată de server se „anulează" singură — se scoate
// din coadă și dispare din ce vezi — fără o a doua copie de reconciliat.

import { applyIssuePatch } from '../../lib/issuePatch'
import type { Issue, Project } from '../../lib/types'
import type { DueRange, NewIssue } from '../repository'

export type OutboxOp =
  | { kind: 'createIssue'; tempId: string; input: NewIssue; echo: Issue }
  | { kind: 'updateIssue'; id: string; patch: Partial<Issue> }
  | { kind: 'deleteIssues'; ids: string[] }
  | { kind: 'markSeen'; issueId: string }

export interface QueuedOp {
  /** Cheia autoincrement din IndexedDB — dă ordinea de golire. */
  seq: number
  op: OutboxOp
  at: string
}

export function echoIssue(input: NewIssue, id: string, project: Project, createdBy: string | null, now: Date): Issue {
  // Aceleași valori implicite ca `supabaseRepository.createIssue`, ca tichetul
  // să nu-și schimbe forma când sosește varianta serverului.
  return {
    id,
    projectId: input.projectId,
    title: input.title,
    desc: input.desc ?? '',
    theme: input.theme ?? '',
    wave: input.wave ?? project.currentWave,
    deps: input.deps ?? [],
    done: false,
    selectors: input.selectors ?? [],
    scenarios: (input.scenarios ?? []).map((s) => ({ text: s.text, kind: s.kind as Issue['scenarios'][number]['kind'] })),
    assigneeId: input.assigneeId ?? null,
    createdBy,
    createdAt: now.toISOString(),
    urgent: input.urgent ?? false,
    dueAt: input.dueAt ?? null,
    allDay: input.allDay ?? true,
    remindAt: input.remindAt ?? null,
    rrule: input.rrule ?? null,
  }
}

export function overlay(base: Issue[], ops: OutboxOp[], now: Date): Issue[] {
  let out = base.slice()
  for (const op of ops) {
    if (op.kind === 'createIssue') {
      if (!out.some((i) => i.id === op.tempId)) out.push(op.echo)
    } else if (op.kind === 'updateIssue') {
      out = out.map((i) => (i.id === op.id ? applyIssuePatch(i, op.patch, now) : i))
    } else if (op.kind === 'deleteIssues') {
      // Ca `deleteIssuesImpl` pe server: o ștergere scoate și muchiile spre tichet.
      const gone = new Set(op.ids)
      out = out
        .filter((i) => !gone.has(i.id))
        .map((i) => (i.deps.some((d) => gone.has(d)) ? { ...i, deps: i.deps.filter((d) => !gone.has(d)) } : i))
    }
  }
  return out
}

export function remapOp(op: OutboxOp, from: string, to: string): OutboxOp {
  const r = (id: string) => (id === from ? to : id)
  switch (op.kind) {
    case 'createIssue':
      return { ...op, input: { ...op.input, deps: op.input.deps?.map(r) }, echo: { ...op.echo, deps: op.echo.deps.map(r) } }
    case 'updateIssue':
      return { ...op, id: r(op.id), patch: op.patch.deps ? { ...op.patch, deps: op.patch.deps.map(r) } : op.patch }
    case 'deleteIssues':
      return { ...op, ids: op.ids.map(r) }
    case 'markSeen':
      return { ...op, issueId: r(op.issueId) }
  }
}

/** Ce tichete atinge o scriere — pentru evenimentele de eșec și pentru a ști
 *  dacă mai rămâne ceva în coadă peste un tichet. */
export function opIssueIds(op: OutboxOp): string[] {
  switch (op.kind) {
    case 'createIssue': return [op.tempId]
    case 'updateIssue': return [op.id]
    case 'deleteIssues': return op.ids
    case 'markSeen': return [op.issueId]
  }
}

/**
 * Ștergerea unui tichet care n-a ajuns încă la server: nu trimite nimic. Crearea
 * și tot ce-l privește se scot din coadă, iar dependențele altor tichete spre el
 * se taie. Altfel s-ar crea pe server un tichet doar ca să fie șters imediat.
 */
export function cancelTempIssues(queued: QueuedOp[], tempIds: string[]): { remove: number[]; rewrite: QueuedOp[] } {
  const gone = new Set(tempIds)
  const remove: number[] = []
  const rewrite: QueuedOp[] = []
  for (const q of queued) {
    const op = q.op
    if (op.kind === 'createIssue' && gone.has(op.tempId)) { remove.push(q.seq); continue }
    if (op.kind === 'updateIssue' && gone.has(op.id)) { remove.push(q.seq); continue }
    if (op.kind === 'markSeen' && gone.has(op.issueId)) { remove.push(q.seq); continue }
    const strip = (ds: string[] | undefined) => ds?.filter((d) => !gone.has(d))
    if (op.kind === 'updateIssue' && op.patch.deps?.some((d) => gone.has(d))) {
      rewrite.push({ ...q, op: { ...op, patch: { ...op.patch, deps: strip(op.patch.deps) } } })
    } else if (op.kind === 'createIssue' && op.input.deps?.some((d) => gone.has(d))) {
      rewrite.push({ ...q, op: { ...op, input: { ...op.input, deps: strip(op.input.deps) }, echo: { ...op.echo, deps: strip(op.echo.deps)! } } })
    } else if (op.kind === 'deleteIssues' && op.ids.some((d) => gone.has(d))) {
      const ids = op.ids.filter((d) => !gone.has(d))
      if (ids.length) rewrite.push({ ...q, op: { ...op, ids } })
      else remove.push(q.seq)
    }
  }
  return { remove, rewrite }
}

/**
 * Oglinda lui `listDueIssues` pe date locale. Se compară MOMENTE, nu șiruri:
 * Supabase întoarce `+00:00`, clientul scrie `.000Z`, iar o comparație de text
 * între cele două formate ar greși exact la granița unei zile.
 */
export function deriveDue(issues: Issue[], range: DueRange): Issue[] {
  const to = Date.parse(range.to)
  const doneFrom = Date.parse(range.doneFrom)
  return issues
    .filter((i) => {
      if (!i.dueAt) return false
      const t = Date.parse(i.dueAt)
      return t < to && (!i.done || t >= doneFrom)
    })
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
}
