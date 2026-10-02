import { describe, expect, it } from 'vitest'
import { reminderMutation } from './reminderAction'
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
