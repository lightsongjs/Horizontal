import { describe, expect, it } from 'vitest'
import { blockedBy, detectObstacleCycle, openObstacles, waitingDays } from './obstacles'
import { NO_SCHEDULE } from './schedule'
import type { Issue, Obstacle, ObstacleLink, ObstacleState } from './types'

function mkIssue(id: string, wave = 1, done = false): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave, deps: [], done, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...NO_SCHEDULE }
}

function mkObst(id: string, state: ObstacleState, extra: Partial<Obstacle> = {}): Obstacle {
  return {
    id, projectId: 'p', title: id, detail: '', owner: '', state,
    blocking: true, bypass: null, evidence: 'necunoscut',
    askedAt: null, resolvedAt: null, deps: [], position: 0, ...extra,
  }
}

// Cazul MCP. B1 „listare de facturi" blochează șase tichete din Faza 1 și
// obstacolul #19. Lanțul #1 → #19: „dacă nu știm cine e utilizatorul, nu știm
// câte tool-uri expunem".
const ISSUES: Issue[] = ['1.1', '1.2', '1.3', '1.4', '1.6', '0.2'].map((id) => mkIssue(id))

describe('openObstacles', () => {
  it('nu întoarce obstacolele depășite sau ocolite', () => {
    const o = [mkObst('B1', 'asteptare'), mkObst('B2', 'depasit'), mkObst('#12', 'ocolit')]
    expect([...openObstacles(o)].sort()).toEqual(['B1'])
  })

  it('propagă prin dependențe între obstacole: #19 e deschis fiindcă #1 e deschis', () => {
    const o = [mkObst('#1', 'necunoscut'), mkObst('#19', 'depasit', { deps: ['#1'] })]
    expect(openObstacles(o).has('#19')).toBe(true)
  })

  it('închide lanțul când rădăcina se depășește', () => {
    const o = [mkObst('#1', 'depasit'), mkObst('#19', 'depasit', { deps: ['#1'] })]
    expect(openObstacles(o).size).toBe(0)
  })

  it('nu intră în buclă infinită pe un ciclu', () => {
    const o = [mkObst('X', 'depasit', { deps: ['Y'] }), mkObst('Y', 'depasit', { deps: ['X'] })]
    expect(() => openObstacles(o)).not.toThrow()
  })
})

describe('blockedBy', () => {
  it('un obstacol deschis blochează toate tichetele legate', () => {
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = ['1.1', '1.2', '1.4', '1.6'].map((issueId) => ({ obstacleId: 'B1', issueId }))
    const out = blockedBy(ISSUES, obstacles, links)
    expect(out['1.1']).toEqual(['B1'])
    expect(out['1.6']).toEqual(['B1'])
    expect(out['0.2']).toBeUndefined()
  })

  it('blocking=false nu stinge nimic', () => {
    const obstacles = [mkObst('#3', 'necunoscut', { blocking: false })]
    const links: ObstacleLink[] = [{ obstacleId: '#3', issueId: '1.6' }]
    expect(blockedBy(ISSUES, obstacles, links)['1.6']).toBeUndefined()
  })

  it('un obstacol depășit nu mai blochează', () => {
    const obstacles = [mkObst('B2', 'depasit')]
    const links: ObstacleLink[] = [{ obstacleId: 'B2', issueId: '1.1' }]
    expect(blockedBy(ISSUES, obstacles, links)['1.1']).toBeUndefined()
  })

  it('adună mai multe obstacole pe același tichet, în ordinea lor de poziție', () => {
    const obstacles = [
      mkObst('#17', 'asteptare', { position: 2 }),
      mkObst('B1', 'asteptare', { position: 0 }),
      mkObst('#19', 'necunoscut', { position: 1 }),
    ]
    const links: ObstacleLink[] = ['B1', '#19', '#17'].map((obstacleId) => ({ obstacleId, issueId: '1.1' }))
    expect(blockedBy(ISSUES, obstacles, links)['1.1']).toEqual(['B1', '#19', '#17'])
  })

  it('un tichet bifat nu se raportează blocat', () => {
    const issues = [mkIssue('1.1', 1, true)]
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: '1.1' }]
    expect(blockedBy(issues, obstacles, links)['1.1']).toBeUndefined()
  })

  it('ignoră legăturile către tichete inexistente', () => {
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: 'FANTOMA' }]
    expect(blockedBy(ISSUES, obstacles, links)).toEqual({})
  })
})

describe('waitingDays', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('numără zilele de la askedAt pentru un obstacol în așteptare', () => {
    const o = mkObst('B1', 'asteptare', { askedAt: '2026-08-25T09:00:00Z' })
    expect(waitingDays(o, now)).toBe(16)
  })

  it('întoarce null dacă nu e în așteptare', () => {
    expect(waitingDays(mkObst('B1', 'necunoscut', { askedAt: '2026-08-25T09:00:00Z' }), now)).toBeNull()
    expect(waitingDays(mkObst('B1', 'depasit', { askedAt: '2026-08-25T09:00:00Z' }), now)).toBeNull()
  })

  it('întoarce null dacă nu s-a notat când s-a întrebat', () => {
    expect(waitingDays(mkObst('B1', 'asteptare'), now)).toBeNull()
  })
})

describe('detectObstacleCycle', () => {
  it('găsește ciclul ca traseu ordonat', () => {
    const o = [mkObst('A', 'necunoscut', { deps: ['B'] }), mkObst('B', 'necunoscut', { deps: ['A'] })]
    expect(detectObstacleCycle(o)).toEqual(['A', 'B', 'A'])
  })

  it('întoarce null pe un lanț valid', () => {
    const o = [mkObst('#1', 'necunoscut'), mkObst('#19', 'necunoscut', { deps: ['#1'] })]
    expect(detectObstacleCycle(o)).toBeNull()
  })
})
