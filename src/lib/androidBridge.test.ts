import { afterEach, describe, expect, it, vi } from 'vitest'
import { agendaKey, androidListKey, captureData, captureKey, canTakeActions, getAndroidBridge, pageReadAt } from './androidBridge'

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
  const sync = (t: number) => ({ dueFetchedAt: () => t })
  // Vârsta DATELOR, nu ora trimiterii: o listă din cache (primul cadru, o citire
  // căzută pe cache) ar fi bătut altfel o listă nativă mai proaspătă.
  it('online: pornirea ultimei citiri de rețea a scadențelor', () => expect(pageReadAt({ offline: false }, sync(123), now)).toBe(123))
  it('doar cache până acum: 0', () => expect(pageReadAt({ offline: false }, sync(0), now)).toBe(0))
  // Cache-ul unei pagini offline poate fi de ieri: lista nativă, citită de la
  // server, câștigă (mai puțin heldIds — vezi Kotlin mergePlan).
  it('offline: 0, ca orice listă nativă să fie mai nouă', () => expect(pageReadAt({ offline: true }, sync(123), now)).toBe(0))
  it('fără strat offline (direct la server): acum', () => expect(pageReadAt({ offline: false }, undefined, now)).toBe(now.getTime()))
})

describe('canTakeActions', () => {
  it('abia după o citire de rețea a scadențelor', () => {
    expect(canTakeActions({ dueFetchedAt: () => 0 })).toBe(false)
    expect(canTakeActions({ dueFetchedAt: () => 5 })).toBe(true)
  })
  it('fără strat offline: datele sunt mereu de la server', () => expect(canTakeActions(undefined)).toBe(true))
})

describe('androidListKey', () => {
  it('o citire de rețea nouă (readAt mutat) retrimite chiar cu aceeași listă', () => {
    expect(androidListKey([], [], 1)).not.toBe(androidListKey([], [], 2))
    expect(androidListKey([], ['HZ-1'], 1)).toBe(androidListKey([], ['HZ-1'], 1))
  })
})

describe('agendaKey', () => {
  const item = { id: 'HZ-1', title: 'R', project: null, dueAt: '2026-10-06T07:00:00.000Z', allDay: false, hasReminder: false, recurring: false, urgent: false, hiddenUntil: null }
  it('se schimbă cu lista și cu vârsta datelor, nu altfel', () => {
    expect(agendaKey([item], 5)).toBe(agendaKey([{ ...item }], 5))
    expect(agendaKey([item], 5)).not.toBe(agendaKey([item], 6))
    expect(agendaKey([item], 5)).not.toBe(agendaKey([{ ...item, title: 'S' }], 5))
  })
})

describe('captureData', () => {
  it('ia doar câmpurile ferestrei, iar cheia se schimbă doar cu ele', () => {
    const p = { id: 'p', name: '✅Daily', prefix: 'HZ', type: 'work' as const, accent: '#fff', description: 'x' }
    const ana = { id: 'a', name: 'Ana', email: 'x' }
    const d = captureData([p], [ana], 7)
    expect(d).toEqual({ projects: [{ id: 'p', name: '✅Daily', prefix: 'HZ', type: 'work' }], assignees: [{ id: 'a', name: 'Ana' }], readAt: 7 })
    const p2 = { ...p, description: 'altceva' }
    const ana2 = { ...ana, email: 'y' }
    expect(captureKey(d)).toBe(captureKey(captureData([p2], [ana2], 7)))
    expect(captureKey(d)).not.toBe(captureKey(captureData([{ ...p, name: 'Daily' }], [], 7)))
  })
})
