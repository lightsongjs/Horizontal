import { describe, expect, it } from 'vitest'
import { decorationSpecs, type DecoSpec } from './decorations'

const none = new Set<number>()
const of = (specs: DecoSpec[], k: DecoSpec['k']) => specs.filter((s) => s.k === k)

describe('decorationSpecs', () => {
  it('ascunde ** în afara liniei cu cursorul, le arată pe ea', () => {
    const s = 'a **b**'
    expect(of(decorationSpecs(s, none, []), 'hide')).toEqual([{ k: 'hide', from: 2, to: 4 }, { k: 'hide', from: 5, to: 7 }])
    expect(of(decorationSpecs(s, new Set([0]), []), 'hide')).toEqual([])
    expect(of(decorationSpecs(s, new Set([0]), []), 'mark')).toContainEqual({ k: 'mark', from: 2, to: 7, cls: 'md-strong' })
  })
  it('titlul: clasa pe linie mereu, „## " ascuns doar fără cursor', () => {
    const d = decorationSpecs('## T', none, [])
    expect(d).toContainEqual({ k: 'line', at: 0, cls: 'md-h2' })
    expect(d).toContainEqual({ k: 'hide', from: 0, to: 3 })
    expect(of(decorationSpecs('## T', new Set([0]), []), 'hide')).toEqual([])
  })
  it('căsuța e desenată și pe linia cu cursorul; rândul bifat e tăiat', () => {
    const d = decorationSpecs('- [x] gata', new Set([0]), [])
    expect(d).toContainEqual({ k: 'task', from: 0, to: 6, checked: true })
    expect(d).toContainEqual({ k: 'mark', from: 6, to: 10, cls: 'md-done' })
    expect(d).toContainEqual({ k: 'line', at: 0, cls: 'md-li md-li-task md-li-done', attrs: { style: '--md-depth:0' } })
  })
  it('bulina și numărul înghit spațiul de după; linia își poartă felul', () => {
    const b = decorationSpecs('- a', none, [])
    expect(of(b, 'bullet')).toEqual([{ k: 'bullet', from: 0, to: 2 }])
    expect(b).toContainEqual({ k: 'line', at: 0, cls: 'md-li md-li-bullet', attrs: { style: '--md-depth:0' } })
    expect(of(decorationSpecs('1. a', none, []), 'num')).toEqual([{ k: 'num', from: 0, to: 3, text: '1.' }])
  })
  it('indentarea intră în marcaj, adâncimea pe linie', () => {
    const d = decorationSpecs('- a\n  - [ ] b', none, [])
    expect(d).toContainEqual({ k: 'task', from: 4, to: 12, checked: false })
    expect(d).toContainEqual({ k: 'line', at: 4, cls: 'md-li md-li-task', attrs: { style: '--md-depth:1' } })
  })
  it('în citat marcajul rămâne pe loc și linia nu e de listă', () => {
    const d = decorationSpecs('> - a', none, [])
    expect(of(d, 'bullet')).toEqual([{ k: 'bullet', from: 2, to: 4 }])
    expect(d.some((s) => s.k === 'line' && s.cls.startsWith('md-li'))).toBe(false)
  })
  it('linkul: textul rămâne, sintaxa se ascunde, href-ul sigur e pe mark', () => {
    const d = decorationSpecs('[x](https://a.ro)', none, [])
    expect(d).toContainEqual({ k: 'mark', from: 0, to: 17, cls: 'md-link', attrs: { 'data-href': 'https://a.ro' } })
    expect(of(d, 'hide')).toEqual([{ k: 'hide', from: 0, to: 1 }, { k: 'hide', from: 2, to: 17 }])
  })
  it('linkul nesigur nu primește href', () => {
    const d = decorationSpecs('[x](javascript:a)', none, [])
    expect(d.some((s) => s.k === 'mark' && s.attrs)).toBe(false)
  })
  it('referința la tichet, nu și în cod', () => {
    const d = decorationSpecs('HZ-1 `HZ-2`', none, ['HZ'])
    expect(d).toContainEqual({ k: 'mark', from: 0, to: 4, cls: 'md-ref', attrs: { 'data-ref': 'HZ-1' } })
    expect(d.filter((s) => s.k === 'mark' && s.cls === 'md-ref')).toHaveLength(1)
  })
  it('separatorul devine ⁂ doar fără cursor; codul primește clasa pe fiecare linie', () => {
    expect(of(decorationSpecs('---', none, []), 'hr')).toEqual([{ k: 'hr', from: 0, to: 3 }])
    expect(of(decorationSpecs('---', new Set([0]), []), 'hr')).toEqual([])
    const d = decorationSpecs('```\na\n```', none, [])
    expect(d.filter((s) => s.k === 'line' && s.cls.includes('md-pre'))).toHaveLength(3)
  })
  it('citatul: clasa pe linie, „> " ascuns', () => {
    const d = decorationSpecs('> a', none, [])
    expect(d).toContainEqual({ k: 'line', at: 0, cls: 'md-quote' })
    expect(d).toContainEqual({ k: 'hide', from: 0, to: 2 })
  })
  it('nimic ascuns nu traversează un rând nou', () => {
    const d = decorationSpecs('**a\nb**', none, [])
    expect(d.filter((s) => (s.k === 'hide' || s.k === 'bullet' || s.k === 'task' || s.k === 'hr'))
      .every((s) => !'**a\nb**'.slice((s as { from: number }).from, (s as { to: number }).to).includes('\n'))).toBe(true)
  })
})
