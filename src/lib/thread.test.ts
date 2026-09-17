import { describe, expect, it } from 'vitest'
import { groupInbox, isUnread } from './thread'
import type { InboxRow } from './types'

const row = (patch: Partial<InboxRow>): InboxRow => ({
  issueId: 'T-1', projectId: 'p', title: 'T', done: false, assigneeId: 'a1',
  lastEventAt: null, lastForeignAt: null, lastForeignAuthor: null, seenAt: null, ...patch,
})

describe('isUnread', () => {
  it('e necitit când altcineva a scris după ultima mea vizită', () => {
    expect(isUnread('2026-09-17T12:00:00Z', '2026-09-17T10:00:00Z')).toBe(true)
  })
  it('e citit când vizita e mai nouă', () => {
    expect(isUnread('2026-09-17T10:00:00Z', '2026-09-17T12:00:00Z')).toBe(false)
  })
  it('e necitit când n-am vizitat niciodată', () => {
    expect(isUnread('2026-09-17T10:00:00Z', null)).toBe(true)
  })
  // Regula care contează: lastForeignAt EXCLUDE deja evenimentele mele, deci
  // propriul comentariu nu poate aprinde bulina.
  it('e citit când nimeni străin n-a scris', () => {
    expect(isUnread(null, null)).toBe(false)
  })
})

describe('groupInbox', () => {
  it('desparte necititele de restul, cele mai noi întâi', () => {
    const rows = [
      row({ issueId: 'A', lastEventAt: '2026-09-10T10:00:00Z', lastForeignAt: '2026-09-10T10:00:00Z', seenAt: '2026-09-11T10:00:00Z' }),
      row({ issueId: 'B', lastEventAt: '2026-09-17T10:00:00Z', lastForeignAt: '2026-09-17T10:00:00Z', seenAt: null }),
      row({ issueId: 'C', lastEventAt: '2026-09-16T10:00:00Z', lastForeignAt: '2026-09-16T10:00:00Z', seenAt: null }),
    ]
    const { fresh, rest } = groupInbox(rows)
    expect(fresh.map((r) => r.issueId)).toEqual(['B', 'C'])
    expect(rest.map((r) => r.issueId)).toEqual(['A'])
  })
  it('scoate tichetele bifate', () => {
    const { fresh, rest } = groupInbox([row({ issueId: 'D', done: true, lastForeignAt: '2026-09-17T10:00:00Z' })])
    expect(fresh).toEqual([])
    expect(rest).toEqual([])
  })
})
