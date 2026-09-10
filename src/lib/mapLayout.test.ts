import { describe, expect, it } from 'vitest'
import { layoutMap, NODE_H, NODE_W } from './mapLayout'
import { NO_SCHEDULE } from './schedule'
import type { Issue, Obstacle, ObstacleLink } from './types'

function mkIssue(id: string, deps: string[] = [], wave = 1, done = false): Issue {
  return { id, projectId: 'p', title: id, desc: '', theme: '', wave, deps, done, selectors: [], scenarios: [], notes: '', assigneeId: null, urgent: false, ...NO_SCHEDULE }
}

function mkObst(id: string, state: Obstacle['state'], extra: Partial<Obstacle> = {}): Obstacle {
  return { id, projectId: 'p', title: id, detail: '', owner: '', state, blocking: true, bypass: null, evidence: 'necunoscut', askedAt: null, resolvedAt: null, deps: [], position: 0, ...extra }
}

describe('layoutMap', () => {
  it('pune tichetele pe coloane după adâncimea de dependență', () => {
    const issues = [mkIssue('A'), mkIssue('B', ['A']), mkIssue('C', ['B'])]
    const { nodes } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    const x = (id: string) => nodes.find((n) => n.id === id)!.x
    expect(x('A')).toBeLessThan(x('B'))
    expect(x('B')).toBeLessThan(x('C'))
  })

  it('pune obstacolul deschis într-o coloană ÎNAINTEA tichetelor pe care le blochează', () => {
    const issues = [mkIssue('1.1')]
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: '1.1' }]
    const { nodes } = layoutMap({ issues, obstacles, links, waves: [] })
    const b1 = nodes.find((n) => n.id === 'B1')!
    expect(b1.kind).toBe('obstacle')
    expect(b1.x).toBeLessThan(nodes.find((n) => n.id === '1.1')!.x)
  })

  it('nodurile nu se suprapun în aceeași coloană', () => {
    const issues = [mkIssue('A'), mkIssue('B'), mkIssue('C')]
    const { nodes } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    const ys = nodes.filter((n) => n.x === nodes[0].x).map((n) => n.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(NODE_H)
  })

  it('muchia care pleacă dintr-un obstacol deschis are tonul blk', () => {
    const issues = [mkIssue('1.1')]
    const obstacles = [mkObst('B1', 'asteptare')]
    const links: ObstacleLink[] = [{ obstacleId: 'B1', issueId: '1.1' }]
    const { edges } = layoutMap({ issues, obstacles, links, waves: [] })
    expect(edges).toEqual([{ from: 'B1', to: '1.1', tone: 'blk' }])
  })

  it('muchia care pleacă dintr-un lucru închis are tonul don', () => {
    const issues = [mkIssue('A', [], 1, true), mkIssue('B', ['A'])]
    const { edges } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    expect(edges.find((e) => e.from === 'A')!.tone).toBe('don')
  })

  it('linia „azi" cade după ultima coloană în care totul e închis', () => {
    const issues = [mkIssue('A', [], 1, true), mkIssue('B', ['A'])]
    const { nodes, todayX } = layoutMap({ issues, obstacles: [], links: [], waves: [] })
    const a = nodes.find((n) => n.id === 'A')!
    const b = nodes.find((n) => n.id === 'B')!
    expect(todayX).toBeGreaterThan(a.x + NODE_W)
    expect(todayX).toBeLessThan(b.x)
  })

  it('desenează o etichetă de val per val prezent, în ordine', () => {
    const issues = [mkIssue('A', [], 1), mkIssue('B', [], 2)]
    const waves = [
      { projectId: 'p', number: 1, name: 'Faza 0', label: '', position: 0 },
      { projectId: 'p', number: 2, name: 'Faza 1', label: '', position: 1 },
    ]
    const { bands } = layoutMap({ issues, obstacles: [], links: [], waves })
    expect(bands.map((b) => b.label)).toEqual(['Faza 0', 'Faza 1'])
  })

  it('nu cade pe un proiect gol', () => {
    const out = layoutMap({ issues: [], obstacles: [], links: [], waves: [] })
    expect(out.nodes).toEqual([])
    expect(out.width).toBeGreaterThan(0)
  })
})
