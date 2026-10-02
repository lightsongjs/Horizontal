import { describe, expect, it } from 'vitest'
import { createBroadcastSyncChannel } from './channel'

describe('canalul între file', () => {
  it('un eveniment trimis dintr-o filă ajunge în cealaltă, nu înapoi la emițător', async () => {
    const a = createBroadcastSyncChannel('t-chan')!
    const b = createBroadcastSyncChannel('t-chan')!
    const gotA: unknown[] = []
    const gotB: unknown[] = []
    a.onMessage((e) => gotA.push(e))
    b.onMessage((e) => gotB.push(e))
    a.post({ type: 'removed', ids: ['HZ-01'] })
    await new Promise((r) => setTimeout(r, 20))
    expect(gotB).toEqual([{ type: 'removed', ids: ['HZ-01'] }])
    expect(gotA).toEqual([])
  })
})
