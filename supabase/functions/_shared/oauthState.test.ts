import { describe, expect, it } from 'vitest'
import { mintState, pickReturnOrigin, readState } from './oauthState'
import { open, seal } from './secretBox'

const NOW = Date.parse('2026-10-10T12:00:00Z')

describe('state OAuth', () => {
  it('dus-întors', async () => {
    const s = await mintState('secret', 'user-1', 'https://app.ro', NOW)
    expect(await readState('secret', s, NOW + 1000)).toMatchObject({ u: 'user-1', r: 'https://app.ro' })
  })
  it('alt secret, alterat sau expirat: null', async () => {
    const s = await mintState('secret', 'user-1', 'https://app.ro', NOW)
    expect(await readState('altul', s, NOW)).toBeNull()
    const [p, sig] = s.split('.')
    const forged = btoa(JSON.stringify({ u: 'user-2', r: 'https://app.ro', exp: 9e9 })).replace(/=+$/, '')
    expect(await readState('secret', `${forged}.${sig}`, NOW)).toBeNull()
    expect(await readState('secret', `${p}.x${sig.slice(1)}`, NOW)).toBeNull()
    expect(await readState('secret', s, NOW + 601_000)).toBeNull()
    expect(await readState('secret', 'gunoi', NOW)).toBeNull()
  })
  it('originea de întoarcere: doar din lista albă', () => {
    const allowed = ['https://a.ro', 'http://localhost:5173']
    expect(pickReturnOrigin('http://localhost:5173/x?y', allowed)).toBe('http://localhost:5173')
    expect(pickReturnOrigin('https://rau.ro', allowed)).toBe('https://a.ro')
    expect(pickReturnOrigin(null, allowed)).toBe('https://a.ro')
    expect(pickReturnOrigin('https://a.ro', [])).toBeNull()
  })
})

describe('secretBox', () => {
  const KEY = 'ab'.repeat(32)
  it('dus-întors, IV nou de fiecare dată', async () => {
    const a = await seal(KEY, '1//refresh-token')
    const b = await seal(KEY, '1//refresh-token')
    expect(a).not.toBe(b)
    expect(await open(KEY, a)).toBe('1//refresh-token')
  })
  it('cheie greșită sau text alterat: aruncă', async () => {
    const a = await seal(KEY, 'x')
    await expect(open('cd'.repeat(32), a)).rejects.toThrow()
    await expect(open(KEY, a.slice(0, -2) + 'AA')).rejects.toThrow()
    await expect(seal('scurt', 'x')).rejects.toThrow(/64/)
  })
})
