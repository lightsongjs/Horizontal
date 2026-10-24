import { describe, expect, it } from 'vitest'
import { toBlocks } from './blocks'
import { safeHref } from './safeUrl'

const P = ['HZ', 'APO']

describe('safeHref', () => {
  it.each([
    ['https://a.ro', 'https://a.ro'],
    ['http://a.ro/x?y=1', 'http://a.ro/x?y=1'],
    ['mailto:a@b.ro', 'mailto:a@b.ro'],
    ['www.a.ro', 'https://www.a.ro'],
    ['javascript:alert(1)', null],
    ['data:text/html,x', null],
    ['  JAVASCRIPT:x', null],
    ['/relativ', null],
  ])('%s → %s', (raw, out) => expect(safeHref(raw)).toBe(out))
})

describe('toBlocks', () => {
  it('titluri: h4–h6 cad pe nivelul 3', () => {
    expect(toBlocks('# A\n## B\n#### C', P)).toEqual([
      { t: 'h', level: 1, children: [{ t: 'text', text: 'A' }] },
      { t: 'h', level: 2, children: [{ t: 'text', text: 'B' }] },
      { t: 'h', level: 3, children: [{ t: 'text', text: 'C' }] },
    ])
  })

  it('inline: bold, italic, tăiat, cod, link', () => {
    expect(toBlocks('a **b** *c* ~~d~~ `e` [f](https://g.ro)', P)).toEqual([{
      t: 'p', children: [
        { t: 'text', text: 'a ' },
        { t: 'strong', children: [{ t: 'text', text: 'b' }] },
        { t: 'text', text: ' ' },
        { t: 'em', children: [{ t: 'text', text: 'c' }] },
        { t: 'text', text: ' ' },
        { t: 'del', children: [{ t: 'text', text: 'd' }] },
        { t: 'text', text: ' ' },
        { t: 'code', text: 'e' },
        { t: 'text', text: ' ' },
        { t: 'link', href: 'https://g.ro', children: [{ t: 'text', text: 'f' }] },
      ],
    }])
  })

  it('un link nesigur rămâne text', () => {
    expect(toBlocks('[x](javascript:alert(1))', P)).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'x' }] },
    ])
  })

  it('URL gol devine link', () => {
    expect(toBlocks('vezi https://a.ro', P)).toEqual([{
      t: 'p', children: [
        { t: 'text', text: 'vezi ' },
        { t: 'link', href: 'https://a.ro', children: [{ t: 'text', text: 'https://a.ro' }] },
      ],
    }])
  })

  it('căsuțe, cu poziția marcajului și listă imbricată', () => {
    const s = '- [ ] unu\n  - [x] doi\n- trei'
    expect(toBlocks(s, P)).toEqual([{
      t: 'ul', start: 1, items: [
        {
          task: { checked: false, at: 2 },
          children: [
            { t: 'p', children: [{ t: 'text', text: 'unu' }] },
            { t: 'ul', start: 1, items: [
              { task: { checked: true, at: 14 }, children: [{ t: 'p', children: [{ t: 'text', text: 'doi' }] }] },
            ] },
          ],
        },
        { task: null, children: [{ t: 'p', children: [{ t: 'text', text: 'trei' }] }] },
      ],
    }])
  })

  it('listă numerotată își ține începutul', () => {
    expect(toBlocks('3. a\n4. b', P)[0]).toMatchObject({ t: 'ol', start: 3 })
  })

  it('citat, separator, bloc de cod', () => {
    expect(toBlocks('> zis\n\n---\n\n```js\nx = 1\ny\n```', P)).toEqual([
      { t: 'quote', children: [{ t: 'p', children: [{ t: 'text', text: 'zis' }] }] },
      { t: 'hr' },
      { t: 'pre', text: 'x = 1\ny' },
    ])
  })

  it('referințe la tichete cunoscute; provizoriile și prefixele străine rămân text', () => {
    expect(toBlocks('vezi HZ-12, APO-3, XY-4 și HZ-~ab12', P)).toEqual([{
      t: 'p', children: [
        { t: 'text', text: 'vezi ' },
        { t: 'ref', id: 'HZ-12' },
        { t: 'text', text: ', ' },
        { t: 'ref', id: 'APO-3' },
        { t: 'text', text: ', XY-4 și HZ-~ab12' },
      ],
    }])
  })

  it('text vechi: Enter simplu rămâne rând nou, nimic nu se pierde', () => {
    expect(toBlocks('rândul unu\nrândul doi\n\nparagraf', P)).toEqual([
      { t: 'p', children: [{ t: 'text', text: 'rândul unu' }, { t: 'br' }, { t: 'text', text: 'rândul doi' }] },
      { t: 'p', children: [{ t: 'text', text: 'paragraf' }] },
    ])
  })

  it('tabel: celula goală își ține coloana, alinierea, rândurile scurte completate', () => {
    const T = (text: string) => [{ t: 'text', text }]
    expect(toBlocks('| | La N | La S |\n|---|:-:|--:|\n| **Stare** | n-au | HZ-3 |\n| scurt |', P)).toEqual([{
      t: 'table',
      align: [null, 'center', 'right'],
      head: [[], T('La N'), T('La S')],
      rows: [
        [[{ t: 'strong', children: T('Stare') }], T('n-au'), [{ t: 'ref', id: 'HZ-3' }]],
        [T('scurt'), [], []],
      ],
    }])
  })

  it('tabel fără bare la capete', () => {
    expect(toBlocks('a | b\n--|--\n1 | 2', P)).toEqual([{
      t: 'table', align: [null, null], head: [[{ t: 'text', text: 'a' }], [{ t: 'text', text: 'b' }]],
      rows: [[[{ t: 'text', text: '1' }], [{ t: 'text', text: '2' }]]],
    }])
  })

  it('o bară fără rândul de aliniere rămâne text', () => {
    expect(toBlocks('| a | b |\n| 1 | 2 |', P).every((x) => x.t === 'p')).toBe(true)
  })

  it('HTML brut rămâne text', () => {
    expect(toBlocks('<b>x</b>', P)).toEqual([{ t: 'p', children: [{ t: 'text', text: '<b>x</b>' }] }])
  })
})
