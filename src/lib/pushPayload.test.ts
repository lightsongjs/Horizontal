import { describe, expect, it } from 'vitest'
import { isReminderAction, isReminderArrived, planNotification, SNOOZE_MINUTES } from './pushPayload'

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

describe('isReminderArrived', () => {
  it('acceptă doar mesajele bine formate', () => {
    expect(isReminderArrived({ type: 'reminder-arrived', id: 'EX-01' })).toBe(true)
  })

  it('respinge orice altceva — un worker străin poate trimite orice', () => {
    expect(isReminderArrived(null)).toBe(false)
    expect(isReminderArrived('reminder-arrived')).toBe(false)
    expect(isReminderArrived({ type: 'reminder-arrived' })).toBe(false)
    expect(isReminderArrived({ type: 'reminder-arrived', id: '' })).toBe(false)
    expect(isReminderArrived({ type: 'vite:ping' })).toBe(false)
  })

  it('nu se confundă cu mesajul de acțiune — sunetul n-are voie să bifeze o sarcină', () => {
    const action = { type: 'reminder-action', action: 'done', id: 'EX-01' }
    expect(isReminderArrived(action)).toBe(false)
    expect(isReminderAction({ type: 'reminder-arrived', id: 'EX-01' })).toBe(false)
  })
})

describe('planNotification — cererea semnată', () => {
  const base = { id: 'EX-10', title: 'X' }

  it('nu produce nicio cerere fără token: workerul cade pe pagină', () => {
    expect(planNotification(base).request).toBeNull()
    expect(planNotification({ ...base, actionUrl: 'https://x.fn/reminder-action' }).request).toBeNull()
    expect(planNotification({ ...base, actionToken: 'tok' }).request).toBeNull()
  })

  it('duce tokenul și adresa mai departe când serverul le-a trimis pe amândouă', () => {
    const plan = planNotification({
      ...base,
      actionToken: 'tok',
      actionUrl: 'https://x.fn/reminder-action',
    })
    expect(plan.request).toEqual({ url: 'https://x.fn/reminder-action', token: 'tok', id: 'EX-10' })
  })

  it('eticheta lui „Amână" spune același număr ca SNOOZE_MINUTES', () => {
    // Un buton care scrie 10 și amână 5 e mai rău decât niciun buton: userul
    // învață să nu creadă interfața. De asta eticheta se construiește din
    // constantă, și de asta testul o compară cu ea, nu cu un text scris de mână.
    const snooze = planNotification(base).actions.find((a) => a.action === 'snooze')
    expect(snooze?.title).toBe(`Amână ${SNOOZE_MINUTES} min`)
  })
})
