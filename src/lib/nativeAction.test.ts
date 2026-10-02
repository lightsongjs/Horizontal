import { describe, expect, it, vi } from 'vitest'
import { runNativeAction } from './nativeAction'
import type { Issue } from './types'

function deps(issue?: Partial<Issue>) {
  return {
    find: vi.fn(() => issue as Issue | undefined),
    toggleDone: vi.fn(async () => {}),
    updateIssue: vi.fn(async () => {}),
    open: vi.fn(),
    now: () => new Date('2026-10-02T09:00:00Z'),
  }
}

describe('runNativeAction', () => {
  it('open: deep link-ul obișnuit', () => {
    const d = deps(); runNativeAction({ action: 'open', id: 'HZ-1' }, d)
    expect(d.open).toHaveBeenCalledWith('HZ-1')
  })
  it('done pe o sarcină bifată deja nu o debifează', () => {
    const d = deps({ done: true }); runNativeAction({ action: 'done', id: 'HZ-1' }, d)
    expect(d.toggleDone).not.toHaveBeenCalled()
  })
  it('done pe una nebifată o bifează', () => {
    const d = deps({ done: false }); runNativeAction({ action: 'done', id: 'HZ-1' }, d)
    expect(d.toggleDone).toHaveBeenCalledWith('HZ-1')
  })
  it('done pe un tichet neîncărcat: scriere absolută, nu comutare', () => {
    const d = deps(); runNativeAction({ action: 'done', id: 'HZ-1' }, d)
    expect(d.updateIssue).toHaveBeenCalledWith('HZ-1', { done: true })
    expect(d.toggleDone).not.toHaveBeenCalled()
  })
  it('snooze cu minute: ora absolută', () => {
    const d = deps({ done: false }); runNativeAction({ action: 'snooze', id: 'HZ-1', minutes: 15 }, d)
    expect(d.updateIssue).toHaveBeenCalledWith('HZ-1', { remindAt: '2026-10-02T09:15:00.000Z' })
  })
  it('until fără dueAt: doar mementoul', () => {
    const d = deps(); runNativeAction({ action: 'until', id: 'HZ-1', at: '2026-10-03T06:00:00.000Z' }, d)
    expect(d.updateIssue).toHaveBeenCalledWith('HZ-1', { remindAt: '2026-10-03T06:00:00.000Z' })
  })
  it('until cu dueAt: și scadența, exact cum a calculat-o cutia', () => {
    const d = deps(); runNativeAction({ action: 'until', id: 'HZ-1', at: '2026-10-03T06:00:00.000Z', dueAt: '2026-10-03T12:00:00.000Z' }, d)
    expect(d.updateIssue).toHaveBeenCalledWith('HZ-1', { remindAt: '2026-10-03T06:00:00.000Z', dueAt: '2026-10-03T12:00:00.000Z' })
  })
})
