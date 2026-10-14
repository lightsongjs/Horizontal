import { describe, expect, it } from 'vitest'
import { firstUnreadId, groupInbox, isUnread, reconcileInbox, shortAgo, threadRowFromInbox, threadRowState, threadRowText, type ThreadSummary } from './thread'
import type { Assignee, InboxRow, Issue, IssueEvent } from './types'

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

const ev = (patch: Partial<IssueEvent>): IssueEvent => ({
  id: 'e', issueId: 'T-1', projectId: 'p', kind: 'comment', authorId: 'u-ion', body: 'salut',
  handoffFrom: null, handoffTo: null, createdAt: '2026-10-14T10:00:00Z', editedAt: null, ...patch,
})
const sum = (recent: IssueEvent[], seenAt: string | null = null, count = recent.length): ThreadSummary => ({ count, recent, seenAt })
const me = { userId: 'u-me', assigneeId: 'a-me' }
const people: Assignee[] = [
  { id: 'a-ion', name: 'Ionuț', userId: 'u-ion' },
  { id: 'a-me', name: 'Mihai', userId: 'u-me' },
  { id: 'a-ana', name: 'Ana', userId: 'u-ana' },
]

describe('threadRowState', () => {
  it('ascuns fără rezumat sau cu fir gol', () => {
    expect(threadRowState(null, me).kind).toBe('hidden')
    expect(threadRowState(undefined, me).kind).toBe('hidden')
    expect(threadRowState(sum([], null, 0), me).kind).toBe('hidden')
  })
  it('necitit: ultimul e al altcuiva și mai nou decât vizita', () => {
    const v = threadRowState(sum([ev({})], '2026-10-14T09:00:00Z', 3), me)
    expect(v).toMatchObject({ kind: 'unread', authorId: 'u-ion', body: 'salut', count: 3, handoff: null })
  })
  it('necitit și când n-am vizitat niciodată', () => {
    expect(threadRowState(sum([ev({})]), me).kind).toBe('unread')
  })
  it('citit: vizita e mai nouă', () => {
    expect(threadRowState(sum([ev({})], '2026-10-14T11:00:00Z'), me).kind).toBe('read')
  })
  it('citit: ultimul e al meu — am răspuns, deci am citit', () => {
    expect(threadRowState(sum([ev({ authorId: 'u-me' })]), me).kind).toBe('read')
  })
  it('o notă migrată (fără autor) nu e o veste', () => {
    expect(threadRowState(sum([ev({ authorId: null })]), me).kind).toBe('read')
  })
  it('pasă cu mesaj către mine: perechea de la același moment, în orice ordine', () => {
    const hand = ev({ id: 'h', kind: 'handoff', body: '', handoffFrom: 'a-ion', handoffTo: 'a-me' })
    const msg = ev({ id: 'c', body: '  Testează pe 4412. ' })
    for (const recent of [[hand, msg], [msg, hand]]) {
      const v = threadRowState(sum(recent, null, 3), me)
      expect(v).toMatchObject({ kind: 'unread', body: 'Testează pe 4412.', handoff: { from: 'a-ion', to: 'a-me', toMe: true } })
    }
  })
  it('pasă fără mesaj: comentariul mai vechi nu se lipește de ea', () => {
    const hand = ev({ id: 'h', kind: 'handoff', body: '', handoffTo: 'a-me', createdAt: '2026-10-14T10:00:00Z' })
    const old = ev({ id: 'c', body: 'vechi', createdAt: '2026-10-13T10:00:00Z' })
    expect(threadRowState(sum([hand, old]), me)).toMatchObject({ body: '', handoff: { toMe: true } })
  })
  it('perechea cere același autor', () => {
    const hand = ev({ id: 'h', kind: 'handoff', body: '', handoffTo: 'a-me' })
    const other = ev({ id: 'c', authorId: 'u-ana', body: 'altcineva' })
    expect(threadRowState(sum([hand, other]), me)).toMatchObject({ body: '' })
  })
  it('pasă către altcineva nu e „către mine"', () => {
    const hand = ev({ kind: 'handoff', body: '', handoffFrom: 'a-ion', handoffTo: 'a-ana' })
    expect(threadRowState(sum([hand]), me)).toMatchObject({ handoff: { toMe: false } })
    // Cont nelegat de un nume: nimic nu e „către mine".
    expect(threadRowState(sum([ev({ kind: 'handoff', handoffTo: 'a-me' })]), { userId: 'u-me', assigneeId: null }))
      .toMatchObject({ handoff: { toMe: false } })
  })
})

describe('threadRowFromInbox', () => {
  it('arată dinainte doar starea necitită', () => {
    expect(threadRowFromInbox(undefined).kind).toBe('hidden')
    expect(threadRowFromInbox(row({ lastForeignAt: '2026-10-14T10:00:00Z', seenAt: '2026-10-14T11:00:00Z' })).kind).toBe('hidden')
    expect(threadRowFromInbox(row({ lastForeignAt: '2026-10-14T10:00:00Z', lastForeignAuthor: 'u-ion' })))
      .toMatchObject({ kind: 'unread', authorId: 'u-ion', count: null })
  })
})

describe('threadRowText', () => {
  const view = (patch: object) => ({ kind: 'unread' as const, authorId: 'u-ion', at: '', body: 'mesaj', handoff: null, count: 1, ...patch })
  it('comentariu: numele autorului; al meu e „Eu"', () => {
    expect(threadRowText(view({}), people, 'u-me')).toEqual({ who: 'Ionuț', initials: 'IO', body: 'mesaj' })
    expect(threadRowText(view({ authorId: 'u-me' }), people, 'u-me').who).toBe('Eu')
  })
  it('pasă către mine și către altcineva', () => {
    expect(threadRowText(view({ handoff: { from: 'a-ion', to: 'a-me', toMe: true } }), people, 'u-me').who).toBe('Ți l-a pasat Ionuț')
    expect(threadRowText(view({ handoff: { from: 'a-ion', to: 'a-ana', toMe: false } }), people, 'u-me').who).toBe('Ionuț → Ana')
    expect(threadRowText(view({ handoff: { from: 'a-ion', to: null, toMe: false } }), people, 'u-me').who).toBe('Ionuț → Nimeni')
  })
})

describe('firstUnreadId', () => {
  const evs = [
    ev({ id: '1', authorId: 'u-me', createdAt: '2026-10-12T10:00:00Z' }),
    ev({ id: '2', authorId: 'u-ion', createdAt: '2026-10-13T10:00:00Z' }),
    ev({ id: '3', authorId: 'u-ion', createdAt: '2026-10-14T10:00:00Z' }),
  ]
  it('primul străin mai nou decât vizita', () => {
    expect(firstUnreadId(evs, '2026-10-13T12:00:00Z', 'u-me')).toBe('3')
    expect(firstUnreadId(evs, null, 'u-me')).toBe('2')
    expect(firstUnreadId(evs, '2026-10-15T00:00:00Z', 'u-me')).toBeNull()
  })
  it('vizită necunoscută → fără separator', () => {
    expect(firstUnreadId(evs, undefined, 'u-me')).toBeNull()
  })
})

describe('shortAgo', () => {
  const now = new Date(2026, 9, 14, 12, 0)
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()
  it('scurt, pe trepte', () => {
    expect(shortAgo(at(14, 11, 59, ), now)).toBe('1 min')
    expect(shortAgo(now.toISOString(), now)).toBe('acum')
    expect(shortAgo(at(14, 10), now)).toBe('2 h')
    expect(shortAgo(at(13, 8), now)).toBe('ieri')
    expect(shortAgo(at(11, 8), now)).toBe('3 z')
    expect(shortAgo(at(1, 8), now)).toBe('01/10')
    expect(shortAgo('nu-i dată', now)).toBe('')
  })
})
