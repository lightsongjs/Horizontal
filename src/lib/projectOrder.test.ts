import { describe, expect, it } from 'vitest'
import { inboxFirst, reorderWithInboxFirst } from './projectOrder'

const p = (id: string, name = id) => ({ id, name })

describe('inboxFirst', () => {
  it('puts Inbox first, keeping the rest in manual order', () => {
    expect(inboxFirst([p('a'), p('b'), p('d', 'Inbox'), p('c')]).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c'])
  })
  it('recognises Inbox by name when the id is not `d`', () => {
    expect(inboxFirst([p('a'), p('x', 'Inbox')]).map((x) => x.id)).toEqual(['x', 'a'])
  })
  it('leaves a list without Inbox untouched', () => {
    const list = [p('a'), p('b')]
    expect(inboxFirst(list)).toBe(list)
  })
})

describe('reorderWithInboxFirst', () => {
  const list = [p('a'), p('b'), p('d', 'Inbox'), p('c')]
  it('reorders the displayed list and keeps Inbox first', () => {
    expect(reorderWithInboxFirst(list, 'c', 'a')).toEqual(['d', 'c', 'a', 'b'])
    expect(reorderWithInboxFirst(list, 'a', 'c')).toEqual(['d', 'b', 'c', 'a'])
  })
  it('drops onto Inbox land right after it', () => {
    expect(reorderWithInboxFirst(list, 'c', 'd')).toEqual(['d', 'c', 'a', 'b'])
  })
  it('never moves Inbox', () => {
    expect(reorderWithInboxFirst(list, 'd', 'c')).toBeNull()
  })
  it('is null for no-ops', () => {
    expect(reorderWithInboxFirst(list, 'a', 'a')).toBeNull()
    expect(reorderWithInboxFirst(list, 'a', 'd')).toBeNull()
  })
})
