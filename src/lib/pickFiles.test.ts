import { describe, it, expect } from 'vitest'
import { pickFiles, carriesFiles, rejectMessage, PICK_CAPS } from './pickFiles'

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

describe('pickFiles — plafoane', () => {
  it('acceptă ce e în limite', () => {
    const r = pickFiles({ types: ['Files'], files: [f('a.png', 'image/png', 2 * MB)] })
    expect(r.accept).toHaveLength(1)
    expect(r.rejected).toEqual([])
  })

  it('imaginile au plafon 20 MB, măsurat înainte de micșorare', () => {
    expect(PICK_CAPS.imageMaxBytes).toBe(20 * MB)
    const ok = pickFiles({ types: ['Files'], files: [f('a.jpg', 'image/jpeg', 19 * MB)] })
    expect(ok.accept).toHaveLength(1)
    const nu = pickFiles({ types: ['Files'], files: [f('a.jpg', 'image/jpeg', 21 * MB)] })
    expect(nu.accept).toEqual([])
    expect(nu.rejected).toEqual([{ name: 'a.jpg', reason: 'prea-mare' }])
  })

  it('non-imaginile au plafon 10 MB', () => {
    expect(PICK_CAPS.otherMaxBytes).toBe(10 * MB)
    const nu = pickFiles({ types: ['Files'], files: [f('log.txt', 'text/plain', 11 * MB)] })
    expect(nu.rejected).toEqual([{ name: 'log.txt', reason: 'prea-mare' }])
  })

  it('un fișier de zero octeți e respins — un folder tras produce așa ceva', () => {
    const r = pickFiles({ types: ['Files'], files: [f('folder', '', 0)] })
    expect(r.accept).toEqual([])
    expect(r.rejected).toEqual([{ name: 'folder', reason: 'gol' }])
  })

  it('acceptă și respinge în același lot, fără să piardă nimic în silență', () => {
    const r = pickFiles({
      types: ['Files'],
      files: [f('bun.png', 'image/png', 1 * MB), f('gras.zip', 'application/zip', 50 * MB)],
    })
    expect(r.accept.map((x) => x.name)).toEqual(['bun.png'])
    expect(r.rejected).toEqual([{ name: 'gras.zip', reason: 'prea-mare' }])
  })

  it('nu acceptă nimic dacă transferul nu poartă fișiere', () => {
    const r = pickFiles({ types: ['text/plain'], files: [f('a.png', 'image/png', 1 * MB)] })
    expect(r.accept).toEqual([])
    expect(r.rejected).toEqual([])
  })

  it('respectă plafoane date', () => {
    const r = pickFiles(
      { types: ['Files'], files: [f('a.png', 'image/png', 5 * MB)] },
      { caps: { imageMaxBytes: 1 * MB, otherMaxBytes: 1 * MB } },
    )
    expect(r.accept).toEqual([])
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
    // Primul fișier e respins, deci screenshot-ul acceptat e la indexul 0.
    const r = pickFiles(
      { types: ['Files'], files: [f('gras.zip', 'application/zip', 50 * MB), f('image.png', 'image/png', 1024)] },
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

  it('un singur fișier prea mare: spune care și ce să facă', () => {
    expect(rejectMessage([{ name: 'poza.jpg', reason: 'prea-mare' }])).toBe(
      'poza.jpg e prea mare. Imaginile pot avea cel mult 20 MB, celelalte fișiere 10 MB.',
    )
  })

  it('mai multe: le numără, nu le înșiră pe toate', () => {
    expect(
      rejectMessage([
        { name: 'a.zip', reason: 'prea-mare' },
        { name: 'b.zip', reason: 'prea-mare' },
      ]),
    ).toBe('2 fișiere nu au fost adăugate: prea mari. Imaginile pot avea cel mult 20 MB, celelalte fișiere 10 MB.')
  })

  it('un folder tras primește un mesaj despre foldere, nu despre mărime', () => {
    expect(rejectMessage([{ name: 'poze', reason: 'gol' }])).toBe(
      'poze nu a putut fi citit. Folderele nu se pot atașa — trage fișierele din ele.',
    )
  })

  it('un lot amestecat raportează AMBELE motive, nu doar pe cel mai frecvent', () => {
    const msg = rejectMessage([
      { name: 'a.zip', reason: 'prea-mare' },
      { name: 'poze', reason: 'gol' },
    ])
    expect(msg).toContain('a.zip e prea mare')
    expect(msg).toContain('poze nu a putut fi citit')
    expect(msg).toContain('Folderele nu se pot atașa')
  })

  it('mai multe foldere se numără, nu se înșiră', () => {
    expect(rejectMessage([
      { name: 'poze', reason: 'gol' },
      { name: 'docs', reason: 'gol' },
    ])).toBe('2 fișiere nu au putut fi citite. Folderele nu se pot atașa — trage fișierele din ele.')
  })
})
