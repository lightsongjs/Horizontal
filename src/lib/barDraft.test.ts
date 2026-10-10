import { describe, expect, it } from 'vitest'
import { EMPTY_BAR_DRAFT, isBlankBarDraft, parseBarDraft } from './barDraft'

describe('parseBarDraft', () => {
  it('reia o ciornă scrisă', () => {
    const d = { ...EMPTY_BAR_DRAFT, text: 'user: ion', field: 'desc', desc: 'parola', descOpen: true, manual: { urgent: true }, rejected: ['la 10'] }
    expect(parseBarDraft(JSON.stringify(d))).toEqual(d)
  })
  it('gol, stricat sau străin → fără ciornă', () => {
    expect(parseBarDraft(null)).toBeNull()
    expect(parseBarDraft('{')).toBeNull()
    expect(parseBarDraft('42')).toBeNull()
    expect(parseBarDraft(JSON.stringify({ text: 1, desc: '' }))).toBeNull()
    expect(parseBarDraft(JSON.stringify(EMPTY_BAR_DRAFT))).toBeNull()
  })
  it('câmpuri lipsă sau greșite cad pe implicit', () => {
    expect(parseBarDraft(JSON.stringify({ text: 'a', desc: '', manual: [], rejected: [1, 'x'], field: 'zz' })))
      .toEqual({ ...EMPTY_BAR_DRAFT, text: 'a', rejected: ['x'] })
  })
  it('o descriere scrisă rămâne deschisă', () => {
    expect(parseBarDraft(JSON.stringify({ text: '', desc: 'd' }))?.descOpen).toBe(true)
  })
})

describe('isBlankBarDraft', () => {
  it('o alegere de mână fără text e tot o ciornă', () => {
    expect(isBlankBarDraft(EMPTY_BAR_DRAFT)).toBe(true)
    expect(isBlankBarDraft({ ...EMPTY_BAR_DRAFT, manual: { projectId: 'p' } })).toBe(false)
  })
})
