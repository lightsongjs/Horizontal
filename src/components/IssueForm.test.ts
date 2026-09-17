import { describe, it, expect } from 'vitest'
import { buildMetaRecap, obstaclesDirty, isFormDirty, type FormDirtyState } from './IssueForm'
import { NO_SCHEDULE } from '../lib/schedule'
import type { Issue } from '../lib/types'

const base = { themeName: null, waveName: 'Val 2', assigneeName: null, urgent: false, dueLabel: null }

describe('buildMetaRecap', () => {
  it('un tichet nou n-are decât valul', () => {
    expect(buildMetaRecap(base)).toBe('Val 2')
  })

  it('adaugă temă, assignee, urgent și scadență în ordine, doar ce e setat', () => {
    expect(buildMetaRecap({
      themeName: 'Feature', waveName: 'Val 2', assigneeName: 'Ionuț', urgent: true, dueLabel: '26/08 14:30',
    })).toBe('Feature · Val 2 · Ionuț · ⚡ Urgent · 26/08 14:30')
  })

  it('sare peste ce lipsește, fără puncte goale', () => {
    expect(buildMetaRecap({ ...base, assigneeName: 'Ionuț', dueLabel: '26/08' }))
      .toBe('Val 2 · Ionuț · 26/08')
  })
})

describe('obstaclesDirty', () => {
  it('formularul e murdar când setul de obstacole s-a schimbat', () => {
    expect(obstaclesDirty(['MCP-O01'], ['MCP-O01', 'MCP-O02'])).toBe(true)
    expect(obstaclesDirty(['MCP-O02', 'MCP-O01'], ['MCP-O01', 'MCP-O02'])).toBe(false)
  })
})

const existingIssue: Issue = {
  id: 'HZ-1', projectId: 'p1', title: 'Titlu salvat', desc: 'Descriere salvată', theme: '', wave: 2,
  deps: [], done: false, selectors: [], scenarios: [], assigneeId: null, urgent: false, ...NO_SCHEDULE,
}

/** Stare curată pentru un tichet existent — fiecare câmp reflectă exact ce e
 *  deja salvat, deci `isFormDirty` trebuie să dea `false` pe ea neatinsă. */
const pristineEdit: FormDirtyState = {
  isEdit: true,
  existing: existingIssue,
  activeWave: existingIssue.wave,
  existingBlockerIds: [],
  existingObstacleIds: [],
  title: existingIssue.title,
  desc: existingIssue.desc,
  theme: existingIssue.theme,
  wave: existingIssue.wave,
  assigneeId: existingIssue.assigneeId,
  deps: existingIssue.deps,
  draftDeps: [],
  blocks: [],
  draftBlocks: [],
  obstIds: [],
  draftObstacles: [],
  selectors: existingIssue.selectors,
  scenarios: existingIssue.scenarios,
  commentDraft: '',
  urgent: existingIssue.urgent,
  dueAt: existingIssue.dueAt,
  remindAt: existingIssue.remindAt,
}

/** Stare curată pentru un tichet nou — nimic scris încă. */
const pristineCreate: FormDirtyState = {
  isEdit: false,
  existing: undefined,
  activeWave: 1,
  existingBlockerIds: [],
  existingObstacleIds: [],
  title: '',
  desc: '',
  theme: '',
  wave: 1,
  assigneeId: null,
  deps: [],
  draftDeps: [],
  blocks: [],
  draftBlocks: [],
  obstIds: [],
  draftObstacles: [],
  selectors: [],
  scenarios: [],
  commentDraft: '',
  urgent: false,
  dueAt: null,
  remindAt: null,
}

describe('isFormDirty — draftul firului', () => {
  it('un corp de comentariu nescris marchează formularul ca murdar', () => {
    expect(isFormDirty({ ...pristineEdit, commentDraft: 'ceva' })).toBe(true)
  })
  it('un draft golit după trimitere lasă formularul curat', () => {
    expect(isFormDirty({ ...pristineEdit, commentDraft: '' })).toBe(false)
  })
  it('draftul nu contează la creare — acolo nu există fir', () => {
    expect(isFormDirty({ ...pristineCreate, commentDraft: 'ceva' })).toBe(false)
  })
})
