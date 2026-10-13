import { describe, expect, it } from 'vitest'
import { uniqueNames, zipFolderName } from './zipName'

describe('zipFolderName', () => {
  it('ID, apoi titlul', () => {
    expect(zipFolderName('HZ-12', 'Factură furnizor')).toBe('HZ-12 Factură furnizor')
  })
  it('scoate caracterele interzise pe Windows', () => {
    expect(zipFolderName('HZ-3', 'Contract 1/2: "final"?')).toBe('HZ-3 Contract 1 2 final')
  })
  it('taie titlurile lungi', () => {
    const name = zipFolderName('HZ-1', 'a'.repeat(200))
    expect(name).toBe(`HZ-1 ${'a'.repeat(60)}…`)
  })
  it('fără punct sau spațiu la capăt', () => {
    expect(zipFolderName('HZ-1', 'Gata...')).toBe('HZ-1 Gata')
  })
  it('titlu gol → doar ID-ul', () => {
    expect(zipFolderName('HZ-1', '   ')).toBe('HZ-1')
  })
})

describe('uniqueNames', () => {
  it('numerotează dublurile ca în Descărcări', () => {
    expect(uniqueNames(['a.pdf', 'b.png', 'a.pdf', 'A.pdf'])).toEqual(['a.pdf', 'b.png', 'a (2).pdf', 'A (3).pdf'])
  })
  it('fără extensie', () => {
    expect(uniqueNames(['nota', 'nota'])).toEqual(['nota', 'nota (2)'])
  })
  it('scoate separatorii de cale', () => {
    expect(uniqueNames(['../x.txt'])).toEqual(['.._x.txt'])
  })
})
