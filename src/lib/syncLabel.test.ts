import { describe, expect, it } from 'vitest'
import { syncLabel } from './syncLabel'

describe('syncLabel', () => {
  it('tăcut când totul e sincronizat — și cât o golire rapidă nu lasă nimic în așteptare', () => {
    expect(syncLabel({ offline: false, pending: 0, syncing: false })).toBeNull()
    expect(syncLabel({ offline: false, pending: 0, syncing: true })).toBeNull()
  })
  it('offline, cu sau fără coadă', () => {
    expect(syncLabel({ offline: true, pending: 0, syncing: false })).toBe('offline')
    expect(syncLabel({ offline: true, pending: 2, syncing: false })).toBe('offline · 2 în așteptare')
  })
  it('„se trimite" doar cât o golire chiar e în curs', () => {
    expect(syncLabel({ offline: false, pending: 3, syncing: true })).toBe('se trimite · 3 în așteptare')
  })
  it('coadă oprită (fără golire în curs): doar numărul, fără să pretindă că trimite', () => {
    expect(syncLabel({ offline: false, pending: 1, syncing: false })).toBe('1 în așteptare')
  })
})
