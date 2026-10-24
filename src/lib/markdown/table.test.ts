import { describe, expect, it } from 'vitest'
import { deleteCol, deleteRow, editCell, formatTable, insertCol, insertRow, newTable, parseTable, setAlign, setCell } from './table'
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

  it('forma minimă, `|` scăpat, rândul nou din celulă devine spațiu', () => {
    const m = setCell(parseTable(SRC)!, 2, 1, 'x|y\nz')
    expect(formatTable(m)).toBe('|  | La N | La S |\n| --- | :---: | ---: |\n| **Stare** | n-au | a \\| b |\n| scurt | x\\|y z |  |')
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
