import { describe, expect, it } from 'vitest'
import { shortLabels } from './initials'

describe('shortLabels', () => {
  it('o singură literă când nimeni nu se ciocnește', () => {
    expect(shortLabels(['Ana', 'Bogdan', 'Miron'])).toEqual(['A', 'B', 'M'])
  })

  it('crește DOAR pentru cei care se ciocnesc', () => {
    expect(shortLabels(['Ana', 'Bogdan', 'Miron', 'Mihai'])).toEqual(['A', 'B', 'MIR', 'MIH'])
  })

  it('se oprește la două litere dacă atât ajunge', () => {
    expect(shortLabels(['Maria', 'Mihai'])).toEqual(['MA', 'MI'])
  })

  it('nu trece de trei litere — omonimele rămân egale, numele complet e în tooltip', () => {
    expect(shortLabels(['Mihai', 'Mihaita'])).toEqual(['MIH', 'MIH'])
  })

  it('ignoră spațiile dintre nume și prenume', () => {
    expect(shortLabels(['Ana Popescu', 'Andrei Ionescu'])).toEqual(['ANA', 'AND'])
  })

  it('nu se încurcă în majuscule', () => {
    expect(shortLabels(['miron', 'MIHAI'])).toEqual(['MIR', 'MIH'])
  })

  it('păstrează diacriticele — litera e a numelui, nu a tastaturii', () => {
    expect(shortLabels(['Ștefan', 'Sorin'])).toEqual(['Ș', 'S'])
  })

  it('un nume gol dă „?", nu o pastilă goală', () => {
    expect(shortLabels(['', '  '])).toEqual(['?', '?'])
  })

  it('lista goală nu explodează', () => {
    expect(shortLabels([])).toEqual([])
  })
})
