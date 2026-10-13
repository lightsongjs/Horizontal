import { describe, expect, it } from 'vitest'
import { Echoes } from './rebase'

describe('Echoes — rebaza din store vs. ecoul propriilor scrieri', () => {
  it('o valoare egală cu documentul nu se aplică', () => {
    const e = new Echoes()
    expect(e.shouldApply('abc', 'abc')).toBe(false)
  })
  it('ecoul ultimei scrieri nu se aplică', () => {
    const e = new Echoes()
    e.emitted('ab')
    expect(e.shouldApply('ab', 'abc')).toBe(false)
  })
  it('un ecou VECHI (Gboard: valoarea amânată e mai veche decât documentul) nu șterge literele noi', () => {
    const e = new Echoes()
    e.emitted('ș')
    e.emitted('ști')
    e.emitted('știu')
    // la compositionend, amânată a rămas „ști”, documentul e deja „știu”
    expect(e.shouldApply('ști', 'știu')).toBe(false)
  })
  it('o schimbare venită din afară se aplică', () => {
    const e = new Echoes()
    e.emitted('ab')
    expect(e.shouldApply('ab de pe laptop', 'ab')).toBe(true)
  })
  it('când store-ul a ajuns la document, ecourile vechi se uită', () => {
    const e = new Echoes()
    e.emitted('a')
    e.emitted('ab')
    expect(e.shouldApply('ab', 'ab')).toBe(false)
    // după sincronizare, „a” e o schimbare reală (ex. anulare de pe alt dispozitiv)
    expect(e.shouldApply('a', 'ab')).toBe(true)
  })
  it('după o rebază aplicată, ecourile de dinainte nu mai blochează', () => {
    const e = new Echoes()
    e.emitted('x')
    expect(e.shouldApply('y', 'xx')).toBe(true)
    e.applied()
    expect(e.shouldApply('x', 'y')).toBe(true)
  })
  it('memoria e mărginită', () => {
    const e = new Echoes(3)
    for (const v of ['1', '2', '3', '4']) e.emitted(v)
    expect(e.shouldApply('1', '4')).toBe(true)
    expect(e.shouldApply('2', '4')).toBe(false)
  })
})
