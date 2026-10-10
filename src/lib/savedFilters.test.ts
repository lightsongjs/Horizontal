import { describe, expect, it } from 'vitest'
import {
  describeRules, dueBucketMatches, EMPTY_RULES, filterIssues, groupByProject, matchesFilter, ME,
  normalizeRules, personMatches, type FilterRules, type MatchContext,
} from './savedFilters'
import type { Issue } from './types'

const NOW = new Date(2026, 9, 10, 12, 0) // sâmbătă, 10 octombrie, prânz local
const at = (d: number, h = 0, allDay = true) => ({ dueAt: new Date(2026, 9, d, h, 0).toISOString(), allDay })

const mk = (id: string, over: Partial<Issue> = {}): Issue => ({
  id, projectId: 'a', title: id, desc: '', theme: '', wave: 1, deps: [], done: false, selectors: [],
  scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', urgent: false,
  dueAt: null, allDay: true, remindAt: null, rrule: null, ...over,
})

const ctx: MatchContext = {
  now: NOW,
  assignees: [
    { id: 'as-clara', userId: 'u-clara' },
    { id: 'as-mihai', userId: 'u-mihai' },
    { id: 'as-ana', userId: null },
    { id: 'as-eu', userId: 'u-eu' },
  ],
  me: { assigneeId: 'as-eu', userId: 'u-eu' },
}
const rules = (r: Partial<FilterRules>): FilterRules => ({ ...EMPTY_RULES, ...r })

describe('personMatches — „ale Clarei" = pasate ei + create de ea nepasate', () => {
  it.each([
    ['pasat Clarei', { assigneeId: 'as-clara', createdBy: 'u-mihai' }, true],
    ['creat de Clara, nepasat', { assigneeId: null, createdBy: 'u-clara' }, true],
    ['creat de Clara, pasat lui Mihai', { assigneeId: 'as-mihai', createdBy: 'u-clara' }, false],
    ['al nimănui, autor necunoscut', { assigneeId: null, createdBy: null }, false],
  ])('%s', (_, issue, want) => {
    expect(personMatches(issue, 'as-clara', ctx)).toBe(want)
  })
  it('o persoană fără cont legat se potrivește doar prin pasă', () => {
    expect(personMatches({ assigneeId: 'as-ana', createdBy: null }, 'as-ana', ctx)).toBe(true)
    expect(personMatches({ assigneeId: null, createdBy: null }, 'as-ana', ctx)).toBe(false)
  })
  it('„eu": pasate mie + create de mine nepasate, și fără rând în assignees', () => {
    expect(personMatches({ assigneeId: 'as-eu', createdBy: 'u-x' }, ME, ctx)).toBe(true)
    expect(personMatches({ assigneeId: null, createdBy: 'u-eu' }, ME, ctx)).toBe(true)
    const unlinked = { ...ctx, me: { assigneeId: null, userId: 'u-eu' } }
    expect(personMatches({ assigneeId: null, createdBy: 'u-eu' }, ME, unlinked)).toBe(true)
    expect(personMatches({ assigneeId: null, createdBy: null }, ME, unlinked)).toBe(false)
  })
})

describe('dueBucketMatches — gălețile listelor inteligente', () => {
  it.each([
    ['ieri, zi întreagă', at(9), 'overdue', true],
    ['azi, zi întreagă (nu e restanță)', at(10), 'today', true],
    ['azi la 9 (trecut)', at(10, 9, false), 'overdue', true],
    ['azi la 9 (trecut) nu e „azi"', at(10, 9, false), 'today', false],
    ['azi la 15', at(10, 15, false), 'today', true],
    ['peste 6 zile', at(16), 'week', true],
    ['peste 7 zile', at(17), 'week', false],
    ['restanța nu e în 7 zile', at(9), 'week', false],
    ['fără dată', { dueAt: null, allDay: true }, 'none', true],
    ['cu dată nu e „fără dată"', at(12), 'none', false],
  ] as const)('%s', (_, due, bucket, want) => {
    expect(dueBucketMatches({ ...due, done: false }, bucket, NOW)).toBe(want)
  })
})

describe('matchesFilter — OR în rând, AND între rânduri', () => {
  const issues = [
    mk('A-1', { projectId: 'a', assigneeId: 'as-mihai', ...at(10) }),
    mk('A-2', { projectId: 'a', createdBy: 'u-mihai' }),
    mk('B-1', { projectId: 'b', assigneeId: 'as-mihai', urgent: true, ...at(9) }),
    mk('B-2', { projectId: 'b', assigneeId: 'as-clara', ...at(10) }),
    mk('C-1', { projectId: 'c', assigneeId: 'as-mihai', done: true }),
  ]
  const ids = (r: FilterRules) => filterIssues(issues, r, ctx).map((i) => i.id)

  it('fără reguli: toate deschise', () => {
    expect(ids(EMPTY_RULES).sort()).toEqual(['A-1', 'A-2', 'B-1', 'B-2'])
  })
  it('bifatele nu apar niciodată', () => {
    expect(matchesFilter(issues[4], rules({ people: ['as-mihai'] }), ctx)).toBe(false)
  })
  it('persoană: pasate + create nepasate', () => {
    expect(ids(rules({ people: ['as-mihai'] })).sort()).toEqual(['A-1', 'A-2', 'B-1'])
  })
  it('OR în rând: două persoane', () => {
    expect(ids(rules({ people: ['as-mihai', 'as-clara'] })).sort()).toEqual(['A-1', 'A-2', 'B-1', 'B-2'])
  })
  it('AND între rânduri: Mihai ȘI azi sau restanță', () => {
    expect(ids(rules({ people: ['as-mihai'], due: ['today', 'overdue'] })).sort()).toEqual(['A-1', 'B-1'])
  })
  it('proiect + urgent', () => {
    expect(ids(rules({ projects: ['b'], urgent: true }))).toEqual(['B-1'])
  })
  it('rutinele adormite nu apar', () => {
    const r = { ...ctx, routines: new Set(['a']) }
    const dormant = mk('A-9', { projectId: 'a', remindAt: new Date(2026, 9, 11).toISOString(), ...at(11) })
    expect(matchesFilter(dormant, EMPTY_RULES, r)).toBe(false)
  })
})

describe('ordine și grupare', () => {
  it('cu dată întâi, apoi fără dată (urgentele sus, apoi după număr)', () => {
    const list = [mk('A-10'), mk('A-2'), mk('A-3', { urgent: true }), mk('A-4', at(12)), mk('A-5', at(9))]
    expect(filterIssues(list, EMPTY_RULES, ctx).map((i) => i.id)).toEqual(['A-5', 'A-4', 'A-3', 'A-2', 'A-10'])
  })
  it('grupele urmează ordinea proiectelor; necunoscutele la coadă', () => {
    const g = groupByProject([mk('X-1', { projectId: 'x' }), mk('B-1', { projectId: 'b' }), mk('A-1')], [{ id: 'a' }, { id: 'b' }])
    expect(g.map((x) => x.projectId)).toEqual(['a', 'b', 'x'])
  })
})

describe('normalizeRules', () => {
  it('cade pe gol la gunoi și păstrează ce recunoaște', () => {
    expect(normalizeRules(null)).toEqual(EMPTY_RULES)
    expect(normalizeRules({ projects: ['a', 'a', 3, ''], due: ['today', 'luna'], urgent: 'da', extra: 1 }))
      .toEqual({ projects: ['a'], people: [], due: ['today'], urgent: false })
  })
})

describe('describeRules', () => {
  const names = { project: (id: string) => ({ a: 'Turism' } as Record<string, string>)[id], person: (id: string) => ({ 'as-mihai': 'Mihai' } as Record<string, string>)[id] }
  it('în cuvinte', () => {
    expect(describeRules(rules({ people: ['as-mihai', ME], projects: ['a'], due: ['today'], urgent: true }), names))
      .toBe('Mihai, eu · Turism · azi · urgente')
    expect(describeRules(EMPTY_RULES, names)).toBe('toate tichetele deschise')
  })
})
