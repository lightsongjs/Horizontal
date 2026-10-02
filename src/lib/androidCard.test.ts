import { describe, expect, it } from 'vitest'
import { batteryNeedsHint, cardNeed, formatStamp, isAndroidChromeSub, isMissingNative, notificationsLabel } from './androidCard'
import type { AndroidStatus } from './androidBridge'

const ok: AndroidStatus = { notifications: 'granted', exactAlarms: true, exactUsed: true, batteryOptimized: true, manufacturer: 'Google', session: 'ok', lastSyncAt: null, nextAlarmAt: null, queued: 0 }

describe('cardNeed', () => {
  it('totul în regulă: nimic de arătat', () => expect(cardNeed({ api: 1, status: ok, chromeSubs: 0, webSignedIn: true })).toBeNull())
  it('cutie prea veche: înaintea oricărei alte cereri', () => expect(cardNeed({ api: 0, status: { ...ok, notifications: 'prompt' }, chromeSubs: 0, webSignedIn: true })).toBe('update-app'))
  it('permisiunea lipsește', () => expect(cardNeed({ api: 1, status: { ...ok, notifications: 'prompt' }, chromeSubs: 0, webSignedIn: true })).toBe('permission'))
  it('sesiunea nativă moartă, dar pagina logată: reconectare', () => expect(cardNeed({ api: 1, status: { ...ok, session: 'missing' }, chromeSubs: 0, webSignedIn: true })).toBe('reconnect'))
  it('nelogat deloc: nu cere parola din card (o cere ecranul de login)', () => expect(cardNeed({ api: 1, status: { ...ok, session: 'missing' }, chromeSubs: 0, webSignedIn: false })).toBeNull())
  it('Chrome încă abonat pe telefon: fiecare memento de două ori', () => expect(cardNeed({ api: 1, status: ok, chromeSubs: 1, webSignedIn: true })).toBe('chrome-subs'))
})

describe('isAndroidChromeSub', () => {
  it('UA de Chrome pe Android', () => expect(isAndroidChromeSub('Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36')).toBe(true))
  it('Chrome de desktop rămâne abonat', () => expect(isAndroidChromeSub('Mozilla/5.0 (X11; Linux x86_64) Chrome/141')).toBe(false))
  it('UA lipsă: nu ghicim', () => expect(isAndroidChromeSub(null)).toBe(false))
})

describe('formatStamp', () => {
  it('ora locală, zz.ll HH:mm', () => expect(formatStamp(new Date(2026, 9, 2, 7, 5).toISOString())).toBe('02.10 07:05'))
  it('lipsă: null', () => expect(formatStamp(null)).toBeNull())
  it('nevalid: null, nu „NaN.NaN"', () => expect(formatStamp('nu-e-dată')).toBeNull())
})

describe('batteryNeedsHint', () => {
  it('Xiaomi optimizat: îndemn', () => expect(batteryNeedsHint({ ...ok, manufacturer: 'Xiaomi' })).toBe(true))
  it('comparat fără majuscule', () => expect(batteryNeedsHint({ ...ok, manufacturer: 'SAMSUNG' })).toBe(true))
  it('Xiaomi fără restricții: nimic', () => expect(batteryNeedsHint({ ...ok, manufacturer: 'Xiaomi', batteryOptimized: false })).toBe(false))
  it('Google optimizat: doar starea, fără îndemn', () => expect(batteryNeedsHint(ok)).toBe(false))
})

describe('notificationsLabel', () => {
  it('permise', () => expect(notificationsLabel('granted')).toBe('permise'))
  it('blocate', () => expect(notificationsLabel('denied')).toBe('blocate'))
  it('încă necerute: nu „blocate" — nimeni n-a refuzat nimic', () => expect(notificationsLabel('prompt')).toBe('necerute încă'))
})

describe('isMissingNative', () => {
  it('codul Capacitor UNIMPLEMENTED', () => expect(isMissingNative({ code: 'UNIMPLEMENTED', message: 'x' })).toBe(true))
  it('mesaj „not implemented"', () => expect(isMissingNative(new Error('"getInfo" not implemented on android'))).toBe(true))
  it('pluginul lipsește din cutie (mesajul punții Android)', () => expect(isMissingNative('unable to find plugin : HorizontalAndroid')).toBe(true))
  it('altă eroare nu e „cutie veche"', () => expect(isMissingNative(new Error('timeout'))).toBe(false))
  it('nimic aruncat: nu ghicim', () => expect(isMissingNative(undefined)).toBe(false))
})
