import { describe, expect, it } from 'vitest'
import { isReminderAction, planNotification } from './pushPayload'

describe('planNotification', () => {
  it('ora și proiectul, în fusul dispozitivului', () => {
    const due = new Date(2026, 7, 24, 14, 0).toISOString()
    const plan = planNotification({ id: 'EX-03', title: 'Mergi la cumpărături', dueAt: due, allDay: false, projectName: 'Personal' })
    expect(plan).toMatchObject({
      title: 'Mergi la cumpărături',
      body: '14:00 · Personal',
      url: '/EX-03',
      tag: 'EX-03',
    })
  })

  it('o sarcină de zi întreagă nu arată o oră inventată', () => {
    const plan = planNotification({ id: 'EX-04', title: 'Plătește chiria', dueAt: new Date(2026, 7, 24).toISOString(), allDay: true, projectName: 'Personal' })
    expect(plan.body).toBe('Personal')
  })

  it('corpul nu rămâne niciodată gol — cade pe id', () => {
    expect(planNotification({ id: 'EX-05', title: 'Ceva' }).body).toBe('EX-05')
  })

  it('un titlu lipsă nu produce o notificare goală', () => {
    expect(planNotification({ id: 'EX-06', title: '   ' }).title).toBe('Sarcină fără titlu')
  })

  it('o dată invalidă e ignorată, nu propagată ca NaN', () => {
    const plan = planNotification({ id: 'EX-07', title: 'X', dueAt: 'nu-e-o-dată', allDay: false, projectName: 'P' })
    expect(plan.body).toBe('P')
  })

  it('cele două acțiuni sunt mereu prezente', () => {
    expect(planNotification({ id: 'EX-08', title: 'X' }).actions.map((a) => a.action)).toEqual(['done', 'snooze'])
  })

  it('tag-ul e id-ul, deci un al doilea memento înlocuiește primul', () => {
    const a = planNotification({ id: 'EX-09', title: 'X' })
    const b = planNotification({ id: 'EX-09', title: 'X' })
    expect(a.tag).toBe(b.tag)
  })
})

describe('isReminderAction', () => {
  it('acceptă doar mesajele bine formate', () => {
    expect(isReminderAction({ type: 'reminder-action', action: 'done', id: 'EX-01' })).toBe(true)
    expect(isReminderAction({ type: 'reminder-action', action: 'snooze', id: 'EX-01' })).toBe(true)
  })

  it('respinge orice altceva — un worker străin poate trimite orice', () => {
    expect(isReminderAction(null)).toBe(false)
    expect(isReminderAction('reminder-action')).toBe(false)
    expect(isReminderAction({ type: 'reminder-action', action: 'delete', id: 'EX-01' })).toBe(false)
    expect(isReminderAction({ type: 'reminder-action', action: 'done' })).toBe(false)
    expect(isReminderAction({ type: 'reminder-action', action: 'done', id: '' })).toBe(false)
    expect(isReminderAction({ type: 'vite:ping' })).toBe(false)
  })
})
