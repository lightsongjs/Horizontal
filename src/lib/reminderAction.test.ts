import { describe, expect, it } from 'vitest'
import fixtures from './reminderAction.fixtures.json'
import { reminderMutation, snoozeTarget, type SnoozeOption } from './reminderAction'
import { SNOOZE_MINUTES } from './pushPayload'

const now = new Date('2026-10-02T10:00:00.000Z')

describe('reminderMutation', () => {
  it('„Gata" pe o sarcină nebifată o bifează', () => {
    expect(reminderMutation('done', { done: false }, now)).toEqual({ kind: 'toggle' })
  })
  it('„Gata" pe o sarcină deja bifată în altă parte nu o debifează', () => {
    expect(reminderMutation('done', { done: true }, now)).toEqual({ kind: 'none' })
  })
  it('„Gata" pe o sarcină necunoscută încă (nu e în cache) comută, ca înainte', () => {
    expect(reminderMutation('done', undefined, now)).toEqual({ kind: 'toggle' })
  })
  it('„Amână" mută mementoul, nu scadența', () => {
    expect(reminderMutation('snooze', { done: false }, now)).toEqual({
      kind: 'patch',
      patch: { remindAt: new Date(now.getTime() + SNOOZE_MINUTES * 60_000).toISOString() },
    })
  })
  it.each([15, 30])('amânarea cu %i minute mută mementoul cu atât', (min) => {
    expect(reminderMutation('snooze', { done: false }, now, min)).toEqual({
      kind: 'patch',
      patch: { remindAt: new Date(now.getTime() + min * 60_000).toISOString() },
    })
  })
})

// Fixtures-urile presupun Europe/Bucharest, la fel ca în JUnit.
// Tipurile Node nu sunt în tsconfig.app (codul rulează în browser), deci process se atinge prin globalThis.
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Bucharest'

describe('snoozeTarget — fixtures comune cu Kotlin', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      expect(snoozeTarget(f.option as SnoozeOption, new Date(f.now), f.issue)).toEqual(f.want)
    })
  }
})
