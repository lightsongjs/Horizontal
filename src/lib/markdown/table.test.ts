import { describe, expect, it } from 'vitest'
import { cellIn, cellOut, deleteCol, deleteRow, editCell, formatTable, insertCol, insertRow, newTable, parseTable, setAlign, setCell } from './table'
import { toBlocks } from './blocks'

const SRC = '| | La N | La S |\n|---|:-:|--:|\n| **Stare** | n-au | a \\| b |\n| scurt |'

describe('parseTable / formatTable', () => {
  it('celula goală își ține coloana, `\\|` e text, rândul scurt se completează', () => {
    expect(parseTable(SRC)).toEqual({
      align: [null, 'center', 'right'],
      rows: [['', 'La N', 'La S'], ['**Stare**', 'n-au', 'a | b'], ['scurt', '', '']],
    })
  })

  it('fără bare la capete', () => {
    expect(parseTable('a | b\n--|--\n1 | 2')!.rows).toEqual([['a', 'b'], ['1', '2']])
  })

  it('forma minimă, `|` scăpat, rândul nou din celulă devine `<br>`', () => {
    const m = setCell(parseTable(SRC)!, 2, 1, 'x|y\nz')
    expect(formatTable(m)).toBe('|  | La N | La S |\n| --- | :---: | ---: |\n| **Stare** | n-au | a \\| b |\n| scurt | x\\|y<br>z |  |')
  })

  it('dus-întors: textul formatat se citește la fel', () => {
    const m = parseTable(SRC)!
    expect(parseTable(formatTable(m))).toEqual(m)
  })

  it('tabelul nou e un tabel GFM valid, cu antetul gol', () => {
    const t = newTable()
    expect(t).toBe('|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |')
    const b = toBlocks(t, [])[0]
    expect(b.t).toBe('table')
  })
})

describe('operații', () => {
  const m = parseTable('| a | b |\n|---|---|\n| 1 | 2 |')!
  it('rând: niciodată deasupra antetului', () => {
    expect(insertRow(m, 0).rows).toEqual([['a', 'b'], ['', ''], ['1', '2']])
    expect(insertRow(m, 2).rows).toEqual([['a', 'b'], ['1', '2'], ['', '']])
  })
  it('coloană: în toate rândurile, cu aliniere implicită', () => {
    const n = insertCol(setAlign(m, 0, 'right'), 1)
    expect(n.rows).toEqual([['a', '', 'b'], ['1', '', '2']])
    expect(n.align).toEqual(['right', null, null])
  })
  it('antetul și ultima coloană nu se șterg', () => {
    expect(deleteRow(m, 0)).toBe(m)
    expect(deleteRow(m, 1).rows).toEqual([['a', 'b']])
    expect(deleteCol(deleteCol(m, 0), 0).rows).toEqual([['b'], ['2']])
  })
  it('operațiile nu ating modelul primit', () => {
    setCell(m, 1, 0, 'x')
    expect(m.rows[1][0]).toBe('1')
  })
})

describe('editCell', () => {
  const A = '| Nume   | Rol |\n|--------|-----|\n| Ana    |     |\n| scurt |'
  it('schimbă doar textul celulei; alinierea omului rămâne', () => {
    expect(editCell(A, 1, 0, 'Ioana')).toBe('| Nume   | Rol |\n|--------|-----|\n| Ioana    |     |\n| scurt |')
    expect(editCell(A, 0, 1, 'Funcție')).toBe('| Nume   | Funcție |\n|--------|-----|\n| Ana    |     |\n| scurt |')
  })
  it('celula goală primește textul între spații; golită rămâne un spațiu', () => {
    expect(editCell(A, 1, 1, 'dev')).toBe('| Nume   | Rol |\n|--------|-----|\n| Ana    | dev |\n| scurt |')
    expect(editCell(A, 1, 0, '')).toBe('| Nume   | Rol |\n|--------|-----|\n| |     |\n| scurt |')
  })
  it('`|` scăpat, iar `\\|` existent nu desparte celula', () => {
    expect(editCell('| a \\| b | c |\n|---|---|', 0, 1, 'x|y')).toBe('| a \\| b | x\\|y |\n|---|---|')
  })
  it('fără bare la capete', () => {
    expect(editCell('a | b\n--|--\n1 | 2', 1, 1, '3')).toBe('a | b\n--|--\n1 | 3')
  })
  it('celula lipsă dintr-un rând scurt = null (apelantul rescrie tabelul)', () => {
    expect(editCell(A, 2, 1, 'x')).toBeNull()
  })
  it('rezultatul se citește înapoi la fel', () => {
    const next = editCell(A, 1, 1, 'dev')!
    expect(parseTable(next)!.rows[1]).toEqual(['Ana', 'dev'])
  })
})

describe('rândul nou în celulă (`<br>`)', () => {
  it('câmpul → sursa: `\\n` (și CRLF) devine `<br>`', () => {
    expect(cellOut('a\nb')).toBe('a<br>b')
    expect(cellOut('a\r\nb\rc')).toBe('a<br>b<br>c')
    // Shift+Enter la capăt: `<br>` rămâne (trim-ul nu-l mănâncă), ca rândul
    // nou din câmp să nu dispară sub cursor.
    expect(cellOut('a\n')).toBe('a<br>')
  })
  it('sursa → câmpul: toate formele lui `<br>`, fără să conteze literele', () => {
    expect(cellIn('a<br>b<br/>c<br />d<BR>e<Br  />f')).toBe('a\nb\nc\nd\ne\nf')
    expect(cellIn('<b>x</b> <bra>')).toBe('<b>x</b> <bra>')
  })
  it('dus-întors', () => {
    for (const t of ['a\nb', 'x\n\ny', '**a**\n`c`', 'a|b\nc']) {
      const src = editCell('| h |\n|---|\n| x |', 1, 0, t)!
      expect(cellIn(parseTable(src)!.rows[1][0])).toBe(t)
    }
  })
  it('editCell scrie `<br>` și lasă restul tabelului aliniat', () => {
    const A = '| Nume   | Rol |\n|--------|-----|\n| Ana    | dev |'
    expect(editCell(A, 1, 1, 'dev\nops')).toBe('| Nume   | Rol |\n|--------|-----|\n| Ana    | dev<br>ops |')
    expect(editCell(A, 1, 0, 'Ana\n')).toBe('| Nume   | Rol |\n|--------|-----|\n| Ana<br>    | dev |')
  })
  it('cititorul: `<br>` în celulă e rând nou; alt HTML și `<br>` în afara tabelului rămân text', () => {
    const b = toBlocks('| a<br>b | <b>x</b><BR/>y |\n|---|---|\n| 1 |  2 |', [])[0]
    if (b.t !== 'table') throw new Error('nu e tabel')
    expect(b.head[0]).toEqual([{ t: 'text', text: 'a' }, { t: 'br' }, { t: 'text', text: 'b' }])
    expect(b.head[1]).toEqual([{ t: 'text', text: '<b>x</b>' }, { t: 'br' }, { t: 'text', text: 'y' }])
    const p = toBlocks('rând<br>simplu', [])[0]
    expect(p).toEqual({ t: 'p', children: [{ t: 'text', text: 'rând<br>simplu' }] })
  })
  it('`<br>` în bold dintr-o celulă e tot rând nou; în cod rămâne text', () => {
    const b = toBlocks('| **a<br>b** | `x<br>y` |\n|---|---|', [])[0]
    if (b.t !== 'table') throw new Error('nu e tabel')
    expect(b.head[0]).toEqual([{ t: 'strong', children: [{ t: 'text', text: 'a' }, { t: 'br' }, { t: 'text', text: 'b' }] }])
    expect(b.head[1]).toEqual([{ t: 'code', text: 'x<br>y' }])
  })
})
