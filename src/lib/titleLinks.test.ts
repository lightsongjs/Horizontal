import { describe, expect, it } from 'vitest'
import { titleParts, withLinks, type TitlePart } from './titleLinks'

/** Tabelul de cazuri — un caz nou se adaugă aici. */
const FIXTURES: { name: string; title: string; parts: TitlePart[] }[] = [
  { name: 'fără link → tot titlul',
    title: 'Sună la bancă', parts: [{ text: 'Sună la bancă' }] },
  { name: 'gol → o bucată goală',
    title: '', parts: [{ text: '' }] },
  { name: 'link YouTube cu parametri',
    title: 'Vezi https://youtu.be/AvHjix2TpH4?is=RYHE4I0kgoWzVBbD',
    parts: [{ text: 'Vezi ' }, { text: 'youtu.be/AvHjix2TpH4?is=RYHE4I0kgoWzVBbD', href: 'https://youtu.be/AvHjix2TpH4?is=RYHE4I0kgoWzVBbD' }] },
  { name: 'numai link',
    title: 'https://example.com/a', parts: [{ text: 'example.com/a', href: 'https://example.com/a' }] },
  { name: 'www. → https://',
    title: 'citește www.dexonline.ro azi',
    parts: [{ text: 'citește ' }, { text: 'dexonline.ro', href: 'https://www.dexonline.ro' }, { text: ' azi' }] },
  { name: 'punctul de la capăt e al frazei',
    title: 'Vezi http://x.ro/a.', parts: [{ text: 'Vezi ' }, { text: 'x.ro/a', href: 'http://x.ro/a' }, { text: '.' }] },
  { name: 'paranteza din jur rămâne afară',
    title: 'doc (https://x.ro/p)', parts: [{ text: 'doc (' }, { text: 'x.ro/p', href: 'https://x.ro/p' }, { text: ')' }] },
  { name: 'paranteza din link rămâne în link',
    title: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    parts: [{ text: 'en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' }] },
  { name: 'două linkuri',
    title: 'a https://x.ro și https://y.ro',
    parts: [{ text: 'a ' }, { text: 'x.ro', href: 'https://x.ro' }, { text: ' și ' }, { text: 'y.ro', href: 'https://y.ro' }] },
  { name: 'javascript: rămâne text',
    title: 'javascript:alert(1)', parts: [{ text: 'javascript:alert(1)' }] },
]

describe('titleParts', () => {
  for (const f of FIXTURES) it(f.name, () => expect(titleParts(f.title)).toEqual(f.parts))
})

describe('withLinks — oglinda titlului editabil', () => {
  it('taie bucățile la marginile linkului, textul rămâne identic', () => {
    const t = 'Vezi https://x.ro/a mâine'
    const pieces = [{ text: 'Vezi https://x.ro/a ', mark: false }, { text: 'mâine', mark: true }]
    const out = withLinks(pieces, t)
    expect(out.map((p) => p.text).join('')).toBe(t)
    expect(out).toEqual([
      { text: 'Vezi ', mark: false },
      { text: 'https://x.ro/a', mark: false, href: 'https://x.ro/a' },
      { text: ' ', mark: false },
      { text: 'mâine', mark: true },
    ])
  })
  it('fără link → aceleași bucăți', () => {
    const pieces = [{ text: 'abc', mark: false }]
    expect(withLinks(pieces, 'abc')).toBe(pieces)
  })
})
