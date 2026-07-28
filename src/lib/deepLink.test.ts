import { describe, expect, it } from 'vitest'
import { deepLinkNotice, parseTicketPath, prefixOf, resolveTicketProject, ticketPath, ticketUrl } from './deepLink'

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

describe('resolveTicketProject', () => {
  const projects = [
    { id: 'ms', prefix: 'MS' },
    { id: 'tur', prefix: 'TUR' },
  ]

  it('găsește proiectul după prefixul exact al id-ului', () => {
    expect(resolveTicketProject(projects, 'MS-03')).toBe(projects[0])
    expect(resolveTicketProject(projects, 'TUR-API')).toBe(projects[1])
  })

  it('ignoră diferențele de caps în id și în prefixul proiectului', () => {
    expect(resolveTicketProject(projects, 'ms-03')).toBe(projects[0])
    expect(resolveTicketProject([{ id: 'ms', prefix: 'ms' }], 'MS-03')).toEqual({ id: 'ms', prefix: 'ms' })
  })

  it('întoarce null când niciun proiect nu are prefixul', () => {
    expect(resolveTicketProject(projects, 'ZZ-99')).toBeNull()
    expect(resolveTicketProject([], 'MS-03')).toBeNull()
  })

  it('nu confundă un prefix cu altul care începe la fel', () => {
    expect(resolveTicketProject(projects, 'M-01')).toBeNull()
    expect(resolveTicketProject(projects, 'MSX-01')).toBeNull()
  })

  it('primul din listă câștigă dacă două proiecte împart prefixul (ambiguitate acceptată)', () => {
    const dupes = [
      { id: 'ms', prefix: 'MS' },
      { id: 'ms-2', prefix: 'MS' },
    ]
    expect(resolveTicketProject(dupes, 'MS-03')).toBe(dupes[0])
  })

  it('tratează un id fără cratimă ca prefix întreg', () => {
    expect(resolveTicketProject(projects, 'MS')).toBe(projects[0])
  })
})

describe('deepLinkNotice', () => {
  it('spune că ticketul nu mai există când datele sunt încărcate', () => {
    expect(deepLinkNotice('MS-03', 'missing')).toBe('Ticketul MS-03 nu mai există')
  })

  it('nu pretinde că ticketul a dispărut când încărcarea a eșuat', () => {
    const msg = deepLinkNotice('MS-03', 'load-failed')
    expect(msg).toContain('MS-03')
    expect(msg).not.toContain('nu mai există')
    expect(msg).toBe('Nu am putut încărca datele pentru MS-03. Încearcă din nou.')
  })

  it('are mesaje diferite pentru cele două motive', () => {
    expect(deepLinkNotice('ZZ-99', 'missing')).not.toBe(deepLinkNotice('ZZ-99', 'load-failed'))
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
