import { describe, it, expect } from 'vitest'
import { buildAssigneeOptions, memberDisplayName } from './assigneeOptions'
import type { Assignee, ProjectMember } from './types'

describe('memberDisplayName', () => {
  it('ia partea locală a emailului', () => {
    expect(memberDisplayName('ana.pop@exemplu.ro')).toBe('ana.pop')
  })

  it('cade pe emailul întreg dacă n-are @ (nu se întâmplă în practică, dar nu explodează)', () => {
    expect(memberDisplayName('ana')).toBe('ana')
  })
})

describe('buildAssigneeOptions', () => {
  const freeNames: Assignee[] = [
    { id: 'z1', name: 'Echipa API', userId: null },
    { id: 'z2', name: 'Juridic', userId: null },
  ]

  it('conturile vin înaintea numelor libere', () => {
    const assignees: Assignee[] = [...freeNames, { id: 'a1', name: 'Ana', userId: 'u-ana' }]
    const members: ProjectMember[] = [{ userId: 'u-ana', email: 'ana@exemplu.ro' }]
    const opts = buildAssigneeOptions(assignees, members, null)
    expect(opts.map((o) => o.name)).toEqual(['Ana', 'Echipa API', 'Juridic'])
  })

  it('eu primul, dacă sunt membru — chiar înaintea unui cont alfabetic mai devreme', () => {
    const assignees: Assignee[] = [
      { id: 'a1', name: 'Ana', userId: 'u-ana' },
      { id: 'b1', name: 'Bogdan', userId: 'u-bogdan' },
    ]
    const members: ProjectMember[] = [
      { userId: 'u-ana', email: 'ana@exemplu.ro' },
      { userId: 'u-bogdan', email: 'bogdan@exemplu.ro' },
    ]
    const opts = buildAssigneeOptions(assignees, members, 'u-bogdan')
    expect(opts.map((o) => o.name)).toEqual(['Bogdan', 'Ana'])
    expect(opts[0]).toMatchObject({ mine: true })
  })

  it('un membru fără rând în assignees apare ca „member", cu numele din email', () => {
    const members: ProjectMember[] = [{ userId: 'u-carla', email: 'carla.ionescu@exemplu.ro' }]
    const opts = buildAssigneeOptions([], members, null)
    expect(opts).toEqual([{ kind: 'member', userId: 'u-carla', name: 'carla.ionescu', mine: false }])
  })

  it('rămâne alfabetic printre conturi când niciunul nu sunt eu', () => {
    const assignees: Assignee[] = [{ id: 'z1', name: 'Zoe', userId: 'u-zoe' }]
    const members: ProjectMember[] = [
      { userId: 'u-zoe', email: 'zoe@exemplu.ro' },
      { userId: 'u-alin', email: 'alin@exemplu.ro' },
    ]
    const opts = buildAssigneeOptions(assignees, members, null)
    expect(opts.map((o) => o.name)).toEqual(['alin', 'Zoe'])
  })

  it('un cont din assignees care nu mai are acces la proiect nu apare deloc', () => {
    // Bogdan are rând în `assignees` (poate din alt proiect), dar nu e în
    // `members` al proiectului curent — exact drumul înfundat pe care
    // trebuie să-l evite lista.
    const assignees: Assignee[] = [{ id: 'b1', name: 'Bogdan', userId: 'u-bogdan' }]
    const opts = buildAssigneeOptions(assignees, [], null)
    expect(opts).toEqual([])
  })

  it('numele libere rămân, sub conturi, indiferent de membership', () => {
    const opts = buildAssigneeOptions(freeNames, [], null)
    expect(opts.map((o) => o.name)).toEqual(['Echipa API', 'Juridic'])
  })
})
