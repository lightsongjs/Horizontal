import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSummary } from '../lib/thread'

const repo = vi.hoisted(() => ({
  threadSummary: vi.fn<(id: string) => Promise<ThreadSummary>>(),
  threadSummaries: vi.fn<(ids: string[]) => Promise<Record<string, ThreadSummary>>>(),
}))
vi.mock('.', () => ({ repository: repo }))

const { invalidateThreadSummary, loadThreadSummary, peekThreadSummary, prefetchThreadSummaries } = await import('./threadSummary')

const sum = (count: number): ThreadSummary => ({ count, recent: [], seenAt: null })

describe('threadSummary — cache-ul rândului de fir', () => {
  beforeEach(() => {
    invalidateThreadSummary()
    repo.threadSummary.mockReset()
    repo.threadSummaries.mockReset()
  })

  it('preîncărcarea în lot umple cache-ul, deci foaia nu mai cere nimic', async () => {
    repo.threadSummaries.mockResolvedValue({ 'P-1': sum(2), 'P-2': sum(0) })
    await prefetchThreadSummaries(['P-1', 'P-2'])
    expect(peekThreadSummary('P-1')?.count).toBe(2)
    expect(await loadThreadSummary('P-2')).toEqual(sum(0))
    expect(repo.threadSummary).not.toHaveBeenCalled()
  })

  it('invalidat, rândul arată valoarea veche cât vine cea nouă (fără salt), apoi o înlocuiește', async () => {
    repo.threadSummaries.mockResolvedValue({ 'S-1': sum(1) })
    await prefetchThreadSummaries(['S-1'])
    invalidateThreadSummary()
    expect(peekThreadSummary('S-1')?.count).toBe(1)
    repo.threadSummary.mockResolvedValue(sum(2))
    // Firul (vizita) nu primește niciodată valoarea veche: cere din nou.
    expect(await loadThreadSummary('S-1')).toEqual(sum(2))
    expect(peekThreadSummary('S-1')?.count).toBe(2)
  })

  it('offline, valoarea veche pleacă: un rând vechi ar putea minți „citit"', async () => {
    repo.threadSummaries.mockResolvedValue({ 'O-1': sum(1) })
    await prefetchThreadSummaries(['O-1'])
    invalidateThreadSummary('O-1')
    repo.threadSummary.mockRejectedValue(new Error('Failed to fetch'))
    expect(await loadThreadSummary('O-1')).toBeNull()
    expect(peekThreadSummary('O-1')).toBeUndefined()
  })

  it('nu cere din nou ce e proaspăt sau deja pe drum', async () => {
    repo.threadSummaries.mockResolvedValue({ 'D-1': sum(0) })
    await prefetchThreadSummaries(['D-1'])
    await prefetchThreadSummaries(['D-1'])
    expect(repo.threadSummaries).toHaveBeenCalledTimes(1)
  })
})
