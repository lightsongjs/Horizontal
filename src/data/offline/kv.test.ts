import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { openKv } from './kv'

let n = 0
const fresh = () => openKv(`t-${++n}`)

describe('kv', () => {
  it('ține valori pe chei și le listează după prefix', async () => {
    const kv = await fresh()
    await kv.set('p:a:issues', [1])
    await kv.set('p:b:issues', [2])
    await kv.set('projects', [])
    expect(await kv.get('p:a:issues')).toEqual([1])
    expect((await kv.keys('p:')).sort()).toEqual(['p:a:issues', 'p:b:issues'])
  })
  it('coada păstrează ordinea adăugării', async () => {
    const kv = await fresh()
    await kv.append({ kind: 'markSeen', issueId: 'A' })
    await kv.append({ kind: 'markSeen', issueId: 'B' })
    expect((await kv.ops()).map((q) => (q.op as { issueId: string }).issueId)).toEqual(['A', 'B'])
  })
  it('completeOp scoate elementul și scrie baza în ACEEAȘI tranzacție', async () => {
    const kv = await fresh()
    const seq = await kv.append({ kind: 'markSeen', issueId: 'A' })
    await kv.completeOp(seq, [['due', ['x']]])
    expect(await kv.ops()).toEqual([])
    expect(await kv.get('due')).toEqual(['x'])
  })
  it('supraviețuiește redeschiderii (repornirea aplicației)', async () => {
    const name = `t-${++n}`
    const a = await openKv(name)
    await a.append({ kind: 'markSeen', issueId: 'A' })
    const b = await openKv(name)
    expect(await b.ops()).toHaveLength(1)
  })
  it('clear golește și baza, și coada', async () => {
    const kv = await fresh()
    await kv.set('projects', [1])
    await kv.append({ kind: 'markSeen', issueId: 'A' })
    await kv.clear()
    expect(await kv.get('projects')).toBeUndefined()
    expect(await kv.ops()).toEqual([])
  })
})
