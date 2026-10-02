import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAndroidBridge, pageReadAt } from './androidBridge'

const w = globalThis as unknown as { window?: unknown }

afterEach(() => { delete (globalThis as Record<string, unknown>).window })

function fakeCapacitor(platform: string, native = true) {
  const nativePromise = vi.fn(async (_p: string, m: string) => (m === 'getInfo' ? { version: '1.0', api: 1 } : undefined))
  const nativeCallback = vi.fn(() => 'cb-1')
  w.window = { Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, nativePromise, nativeCallback, Plugins: {} } }
  return { nativePromise, nativeCallback }
}

describe('getAndroidBridge', () => {
  it('lipsește în browser', () => { w.window = {}; expect(getAndroidBridge()).toBeNull() })
  it('același obiect la fiecare apel (intră în dependențele efectelor)', () => {
    fakeCapacitor('android'); expect(getAndroidBridge()).toBe(getAndroidBridge())
  })
  it('lipsește pe iOS / web Capacitor', () => { fakeCapacitor('ios'); expect(getAndroidBridge()).toBeNull() })
  it('cheamă metodele native prin nativePromise', async () => {
    const { nativePromise } = fakeCapacitor('android')
    expect(await getAndroidBridge()!.getInfo()).toEqual({ version: '1.0', api: 1 })
    expect(nativePromise).toHaveBeenCalledWith('HorizontalAndroid', 'getInfo', {})
  })
  it('un listener se scoate prin removeListener cu id-ul lui', async () => {
    const { nativePromise, nativeCallback } = fakeCapacitor('android')
    const fn = vi.fn()
    const l = await getAndroidBridge()!.addListener('reminderAction', fn)
    expect(nativeCallback).toHaveBeenCalledWith('HorizontalAndroid', 'addListener', { eventName: 'reminderAction' }, expect.any(Function))
    const cb = (nativeCallback.mock.calls[0] as unknown[])[3] as (d: unknown) => void
    cb({ action: 'done', id: 'HZ-1' })
    expect(fn).toHaveBeenCalledWith({ action: 'done', id: 'HZ-1' })
    await l.remove()
    expect(nativePromise).toHaveBeenCalledWith('HorizontalAndroid', 'removeListener', { eventName: 'reminderAction', callbackId: 'cb-1' })
  })
})

describe('pageReadAt', () => {
  const now = new Date('2026-10-02T09:00:00Z')
  it('online: acum', () => expect(pageReadAt({ offline: false }, now)).toBe(now.getTime()))
  // Cache-ul unei pagini offline poate fi de ieri: lista nativă, citită de la
  // server, câștigă (mai puțin heldIds — vezi Kotlin mergePlan).
  it('offline: 0, ca orice listă nativă să fie mai nouă', () => expect(pageReadAt({ offline: true }, now)).toBe(0))
})
