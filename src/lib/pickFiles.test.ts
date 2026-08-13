import { describe, it, expect } from 'vitest'
import { pickFiles, carriesFiles, rejectMessage } from './pickFiles'

const MB = 1024 * 1024
const f = (name: string, type: string, size: number) => ({ name, type, size })
const at = (iso: string) => () => new Date(iso)

describe('carriesFiles', () => {
  it('recunoaște un transfer cu fișiere', () => {
    expect(carriesFiles(['Files'])).toBe(true)
    expect(carriesFiles(['text/plain', 'Files'])).toBe(true)
  })

  it('un transfer doar cu text nu e attachment', () => {
    expect(carriesFiles(['text/plain', 'text/html'])).toBe(false)
    expect(carriesFiles([])).toBe(false)
  })
})

describe('pickFiles — acceptare', () => {
  it('acceptă un fișier, oricât de mare', () => {
    const r = pickFiles({ types: ['Files'], files: [f('a.png', 'image/png', 200 * MB)] })
    expect(r.accept).toHaveLength(1)
    expect(r.rejected).toEqual([])
  })

  it('un fișier de zero octeți e respins — un folder tras produce așa ceva', () => {
    const r = pickFiles({ types: ['Files'], files: [f('folder', '', 0)] })
    expect(r.accept).toEqual([])
    expect(r.rejected).toEqual([{ name: 'folder', reason: 'gol' }])
  })

  it('acceptă și respinge în același lot, fără să piardă nimic în silență', () => {
    const r = pickFiles({
      types: ['Files'],
      files: [f('bun.png', 'image/png', 1 * MB), f('folder', '', 0)],
    })
    expect(r.accept.map((x) => x.name)).toEqual(['bun.png'])
    expect(r.rejected).toEqual([{ name: 'folder', reason: 'gol' }])
  })

  it('nu acceptă nimic dacă transferul nu poartă fișiere', () => {
    const r = pickFiles({ types: ['text/plain'], files: [f('a.png', 'image/png', 1 * MB)] })
    expect(r.accept).toEqual([])
    expect(r.rejected).toEqual([])
  })

  it('nu există plafon pe numărul de fișiere', () => {
    const many = Array.from({ length: 40 }, (_, i) => f(`p${i}.png`, 'image/png', 1024))
    const r = pickFiles({ types: ['Files'], files: many })
    expect(r.accept).toHaveLength(40)
  })
})

describe('pickFiles — nume sintetizate', () => {
  it('screenshot-ul lipit se redenumește cu data și ora', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('image.png', 'image/png', 50 * 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
  })

  it('două screenshot-uri în același lot nu primesc același nume', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('image.png', 'image/png', 1024), f('image.png', 'image/png', 2048)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
    expect(r.renamed[1]).toBe('screenshot-2026-08-12-14-32-07-2.png')
  })

  it('extensia sintetizată urmează tipul real', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('image.jpeg', 'image/jpeg', 1024)] },
      { now: at('2026-08-12T09:05:00') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-09-05-00.jpg')
  })

  it('un nume adevărat nu se atinge', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('bug-la-login.png', 'image/png', 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBeUndefined()
  })

  it('un fișier fără nume primește unul', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('', 'image/png', 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
  })

  it('indexul din `renamed` e cel din `accept`, nu cel din intrare', () => {
    // Primul fișier e respins (gol), deci screenshot-ul acceptat e la indexul 0.
    const r = pickFiles(
      { types: ['Files'], files: [f('folder', '', 0), f('image.png', 'image/png', 1024)] },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.accept).toHaveLength(1)
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
  })

  it('un fișier cu nume adevărat între două screenshot-uri nu consumă un număr', () => {
    const r = pickFiles(
      {
        types: ['Files'],
        files: [
          f('image.png', 'image/png', 1024),
          f('bug-real.png', 'image/png', 1024),
          f('image.png', 'image/png', 2048),
        ],
      },
      { now: at('2026-08-12T14:32:07') },
    )
    expect(r.renamed[0]).toBe('screenshot-2026-08-12-14-32-07.png')
    expect(r.renamed[1]).toBeUndefined()
    expect(r.renamed[2]).toBe('screenshot-2026-08-12-14-32-07-2.png')
  })
})

describe('rejectMessage', () => {
  it('tace când n-a fost respins nimic', () => {
    expect(rejectMessage([])).toBeNull()
  })

  it('un folder tras primește un mesaj despre foldere', () => {
    expect(rejectMessage([{ name: 'poze', reason: 'gol' }])).toBe(
      'poze nu a putut fi citit. Folderele nu se pot atașa — trage fișierele din ele.',
    )
  })

  it('mai multe foldere se numără, nu se înșiră', () => {
    expect(rejectMessage([
      { name: 'poze', reason: 'gol' },
      { name: 'docs', reason: 'gol' },
    ])).toBe('2 fișiere nu au putut fi citite. Folderele nu se pot atașa — trage fișierele din ele.')
  })
})
