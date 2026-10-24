import { describe, expect, it } from 'vitest'
import { slashMatches } from './slash'

describe('meniul „/”', () => {
  it('fără text: toate blocurile, tabelul primul', () => {
    expect(slashMatches('')[0]).toBe('Tabel')
    expect(slashMatches('').length).toBe(10)
  })
  it('se caută în română și în engleză, fără diacritice', () => {
    expect(slashMatches('tab')).toEqual(['Tabel'])
    expect(slashMatches('table')).toEqual(['Tabel'])
    expect(slashMatches('bif')).toEqual(['Listă de bifat'])
    expect(slashMatches('todo')).toEqual(['Listă de bifat'])
    expect(slashMatches('lista')).toContain('Listă numerotată')
    expect(slashMatches('h2')).toEqual(['Titlu 2'])
  })
  it('nimic potrivit = listă goală (meniul se închide)', () => {
    expect(slashMatches('xyz')).toEqual([])
  })
})
