import { describe, expect, it } from 'vitest'
import { applySuggestion, suggest, tokenAt } from './tokenSuggest'
import { parseCaptureTokens } from './captureTokens'

const projects = [
  { id: 'p1', name: '✅Daily', prefix: 'HZ' },
  { id: 'p2', name: 'Personal', prefix: 'FIN' },
  { id: 'p3', name: 'Proiect Mare', prefix: 'PM' },
  { id: 'p4', name: 'Apologetica', prefix: 'AP' },
]
const people = [{ id: 'a1', name: 'Ana Pop' }, { id: 'a2', name: 'Andrei Ionescu' }, { id: 'a3', name: 'Ana Maria' }]

describe('tokenAt — semnul de sub cursor', () => {
  it('găsește semnul la început de cuvânt, cu ce s-a scris după el', () => {
    expect(tokenAt('raport #pe', 10)).toEqual({ sigil: '#', query: 'pe', start: 7, end: 10 })
    expect(tokenAt('#', 1)).toEqual({ sigil: '#', query: '', start: 0, end: 1 })
    expect(tokenAt('sună @an mâine', 8)).toEqual({ sigil: '@', query: 'an', start: 5, end: 8 })
  })
  it('cursorul în mijlocul semnului ia tot cuvântul', () => {
    expect(tokenAt('x #per y', 4)).toEqual({ sigil: '#', query: 'per', start: 2, end: 6 })
  })
  it('nu e semn: email, C#, după spațiu, cursor departe', () => {
    expect(tokenAt('ion@firma', 9)).toBeNull()
    expect(tokenAt('C#', 2)).toBeNull()
    expect(tokenAt('#daily ', 7)).toBeNull()
    expect(tokenAt('raport', 6)).toBeNull()
  })
})

describe('suggest', () => {
  it('fără literă: toate proiectele, în ordinea lor', () => {
    expect(suggest({ sigil: '#', query: '', start: 0, end: 1 }, projects, people).map((s) => s.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
  it('începutul numelui întâi, apoi un cuvânt, apoi oriunde; fără diacritice și emoji', () => {
    expect(suggest({ sigil: '#', query: 'p', start: 0, end: 2 }, projects, people).map((s) => s.id)).toEqual(['p2', 'p3', 'p4'])
    expect(suggest({ sigil: '#', query: 'mare', start: 0, end: 5 }, projects, people).map((s) => s.id)).toEqual(['p3'])
    expect(suggest({ sigil: '#', query: 'dai', start: 0, end: 4 }, projects, people).map((s) => s.id)).toEqual(['p1'])
    expect(suggest({ sigil: '#', query: 'log', start: 0, end: 4 }, projects, people).map((s) => s.id)).toEqual(['p4'])
  })
  it('oamenii, la @', () => {
    expect(suggest({ sigil: '@', query: 'an', start: 0, end: 3 }, projects, people).map((s) => s.label)).toEqual(['Ana Pop', 'Andrei Ionescu', 'Ana Maria'])
  })
  it('ce se inserează e recunoscut de parser, fără ambiguitate', () => {
    for (const s of suggest({ sigil: '#', query: '', start: 0, end: 1 }, projects, people)) {
      expect(parseCaptureTokens(`x ${s.insert}`, projects, people).projectId).toBe(s.id)
    }
    for (const s of suggest({ sigil: '@', query: '', start: 0, end: 1 }, projects, people)) {
      expect(parseCaptureTokens(`x ${s.insert}`, projects, people).assigneeId).toBe(s.id)
    }
    // „Andrei" e unic: prenumele ajunge; „Ana" nu.
    expect(suggest({ sigil: '@', query: 'andr', start: 0, end: 5 }, projects, people)[0].insert).toBe('@Andrei')
    expect(suggest({ sigil: '@', query: 'anap', start: 0, end: 5 }, projects, people)[0].insert).toBe('@AnaPop')
  })
})

describe('applySuggestion', () => {
  it('înlocuiește semnul, pune un spațiu și cursorul după el', () => {
    const t = tokenAt('raport #pe mâine', 10)!
    expect(applySuggestion('raport #pe mâine', t, { id: 'p2', label: 'Personal', insert: '#Personal' })).toEqual({ text: 'raport #Personal mâine', caret: 17 })
    const u = tokenAt('raport #pe', 10)!
    expect(applySuggestion('raport #pe', u, { id: 'p2', label: 'Personal', insert: '#Personal' })).toEqual({ text: 'raport #Personal ', caret: 17 })
  })
})
