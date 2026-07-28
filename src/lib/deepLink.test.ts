import { describe, expect, it } from 'vitest'
import { parseTicketPath, prefixOf, ticketPath, ticketUrl } from './deepLink'

describe('parseTicketPath', () => {
  it('recunoaște un path de ticket', () => {
    expect(parseTicketPath('/MS-03')).toBe('MS-03')
    expect(parseTicketPath('/TUR-01')).toBe('TUR-01')
    expect(parseTicketPath('/TUR-API')).toBe('TUR-API')
  })

  it('normalizează la uppercase', () => {
    expect(parseTicketPath('/ms-03')).toBe('MS-03')
  })

  it('tolerează un slash final', () => {
    expect(parseTicketPath('/MS-03/')).toBe('MS-03')
  })

  it('respinge rădăcina, ruta de proiect și path-urile fără cratimă', () => {
    expect(parseTicketPath('/')).toBeNull()
    expect(parseTicketPath('/project/turnaround')).toBeNull()
    expect(parseTicketPath('/MS03')).toBeNull()
    expect(parseTicketPath('/MS-03/extra')).toBeNull()
  })

  it('respinge un slug de proiect cu cratimă care ar putea ajunge la rădăcină', () => {
    // Ruta de proiect e mereu prefixată cu /project/, deci un slug nu poate
    // ajunge aici — dar id-urile au mereu cifre sau litere după cratimă și
    // nicio a doua cratimă.
    expect(parseTicketPath('/my-super-project')).toBeNull()
  })
})

describe('prefixOf', () => {
  it('taie la prima cratimă', () => {
    expect(prefixOf('MS-03')).toBe('MS')
    expect(prefixOf('TUR-API')).toBe('TUR')
  })

  it('normalizează la uppercase', () => {
    expect(prefixOf('ms-03')).toBe('MS')
  })

  it('întoarce tot id-ul dacă nu există cratimă', () => {
    expect(prefixOf('MS03')).toBe('MS03')
  })
})

describe('ticketPath / ticketUrl', () => {
  it('construiește path-ul și URL-ul absolut', () => {
    expect(ticketPath('MS-03')).toBe('/MS-03')
    expect(ticketUrl('https://horizontal.app', 'MS-03')).toBe('https://horizontal.app/MS-03')
  })

  it('nu dublează slash-ul dacă origin-ul are unul', () => {
    expect(ticketUrl('https://horizontal.app/', 'MS-03')).toBe('https://horizontal.app/MS-03')
  })
})
