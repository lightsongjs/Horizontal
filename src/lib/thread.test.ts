import { describe, expect, it } from 'vitest'
import { groupInbox, isUnread, reconcileInbox } from './thread'
import type { InboxRow, Issue } from './types'

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
  // Excluderea propriilor evenimente se face în SQL (inbox_rows view), nu aici.
  // lastForeignAt ajunge deja pre-filtrat — nici o regresie a necluzionării
  // propriilor comentarii nu poate veni din funcția asta.
  it('e citit când nimeni străin n-a scris', () => {
    expect(isUnread(null, null)).toBe(false)
  })
  it('compară momente, nu șiruri — aceeași vreme, formatări diferite', () => {
    // Z (GMT) vs +00:00, milisecunde vs microsecunde — trebuie să fie egal
    expect(isUnread('2026-09-17T12:00:00+00:00', '2026-09-17T12:00:00.000Z')).toBe(false)
  })
  it('nu confundă formatări — reversul care pică pe codul vechi', () => {
    // Inversul: pe cod vechi, 'Z' > '+' e true (fals necitit).
    // Pe cod nou: același moment → false
    expect(isUnread('2026-09-17T12:00:00.000Z', '2026-09-17T12:00:00+00:00')).toBe(false)
  })
  it('o dată coruptă în lastForeignAt e sigur „necitit"', () => {
    // Date.parse('nu-e-o-data') === NaN, și NaN > x e false — dar vrem true
    expect(isUnread('nu-e-o-data', '2026-09-17T12:00:00Z')).toBe(true)
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
  it('pune rândurile fără data la coadă', () => {
    const rows = [
      row({ issueId: 'X', lastEventAt: '2026-09-17T10:00:00Z', lastForeignAt: '2026-09-17T10:00:00Z', seenAt: null }),
      row({ issueId: 'Y', lastEventAt: null, lastForeignAt: '2026-09-15T10:00:00Z', seenAt: null }),
      row({ issueId: 'Z', lastEventAt: '2026-09-16T10:00:00Z', lastForeignAt: '2026-09-16T10:00:00Z', seenAt: null }),
    ]
    const { fresh, rest } = groupInbox(rows)
    // X (2026-09-17), Z (2026-09-16), Y (null) — cu null la coadă
    expect(fresh.map((r) => r.issueId)).toEqual(['X', 'Z', 'Y'])
    expect(rest).toEqual([])
  })
  it('data valida nu se poluează de date corupte în sort', () => {
    // Cu dată coruptă în comparator, NaN poluează ordinea rândurilor valide.
    // Rândurile valide sunt puse în ordine INVERSĂ (C, cel vechi, înaintea
    // lui A, cel nou) — dacă sortarea doar ar păstra ordinea de intrare
    // (comparator care întoarce NaN, tratat ca „egal" de motor), rezultatul
    // ar rămâne C înaintea lui A, ceea ce testul de mai jos ar prinde. Cu
    // rândurile valide deja în ordinea corectă, un comparator stricat ar
    // „trece" din întâmplare, prin stabilitatea sortării — nu prin corectitudine.
    const rows = [
      row({ issueId: 'C', lastEventAt: '2026-09-10T10:00:00Z', lastForeignAt: 'dummy', seenAt: null }),
      row({ issueId: 'B', lastEventAt: 'data-rea', lastForeignAt: 'dummy', seenAt: null }),
      row({ issueId: 'A', lastEventAt: '2026-09-17T10:00:00Z', lastForeignAt: 'dummy', seenAt: null }),
      row({ issueId: 'D', lastEventAt: 'alta-data-rea', lastForeignAt: 'dummy', seenAt: null }),
    ]
    const { fresh, rest } = groupInbox(rows)
    // Datele valide să fie în ordinea corectă (A mai recent, apoi C), coruptele la coadă
    expect(fresh.map((r) => r.issueId)).toEqual(['A', 'C', 'B', 'D'])
    expect(rest).toEqual([])
  })
})

const issue = (patch: Partial<Issue>): Issue => ({
  id: 'T-1', projectId: 'p', title: 'T', desc: '', theme: '', wave: 1, deps: [], done: false,
  selectors: [], scenarios: [], assigneeId: null, createdBy: null, createdAt: '2026-09-17T09:00:00Z',
  urgent: false, dueAt: null, allDay: true, remindAt: null, rrule: null, ...patch,
})

describe('reconcileInbox', () => {
  it('scoate rândul căruia i s-a șters assignee-ul în formular', () => {
    const rows = [row({ issueId: 'T-1', assigneeId: 'a1' })]
    const live = [issue({ id: 'T-1', assigneeId: null })]
    expect(reconcileInbox(rows, live, 'a1')).toEqual([])
  })

  it('scoate rândul pasat altcuiva', () => {
    const rows = [row({ issueId: 'T-1', assigneeId: 'a1' })]
    const live = [issue({ id: 'T-1', assigneeId: 'a2' })]
    expect(reconcileInbox(rows, live, 'a1')).toEqual([])
  })

  it('adaugă tichetul pe care tocmai mi l-am pus în formular', () => {
    const live = [issue({ id: 'T-9', title: 'Nou', assigneeId: 'a1' })]
    const out = reconcileInbox([], live, 'a1')
    expect(out.map((r) => r.issueId)).toEqual(['T-9'])
    expect(out[0]).toMatchObject({ title: 'Nou', assigneeId: 'a1', done: false, lastEventAt: null })
  })

  it('preia starea proaspătă (titlu, bifă) peste rândul vechi', () => {
    const rows = [row({ issueId: 'T-1', assigneeId: 'a1', title: 'Vechi', seenAt: '2026-09-17T10:00:00Z' })]
    const live = [issue({ id: 'T-1', assigneeId: 'a1', title: 'Redenumit', done: true })]
    expect(reconcileInbox(rows, live, 'a1')[0]).toMatchObject({
      title: 'Redenumit', done: true, seenAt: '2026-09-17T10:00:00Z',
    })
  })

  it('nu atinge rândurile din proiecte neîncărcate', () => {
    const rows = [row({ issueId: 'X-1', assigneeId: 'a1' })]
    expect(reconcileInbox(rows, [], 'a1')).toEqual(rows)
  })

  it('fără nume legat nu reconciliază nimic', () => {
    const rows = [row({ issueId: 'T-1', assigneeId: 'a1' })]
    expect(reconcileInbox(rows, [issue({ id: 'T-1', assigneeId: null })], null)).toEqual(rows)
  })
})
