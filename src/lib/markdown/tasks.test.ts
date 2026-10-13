import { describe, expect, it } from 'vitest'
import {
  continueList, indentLines, minimalChange, removeMarker, taskProgress,
  toggleLinePrefix, toggleTask, toggleWrap,
} from './tasks'

describe('toggleTask', () => {
  it('bifează și debifează, schimbând exact un caracter', () => {
    const s = 'a\n- [ ] unu\n- [x] doi'
    const once = toggleTask(s, 5)
    expect(once).toBe('a\n- [x] unu\n- [x] doi')
    expect(toggleTask(once, 5)).toBe(s)
    expect(toggleTask(s, 15)).toBe('a\n- [ ] unu\n- [ ] doi')
  })
  it('X mare se debifează', () => expect(toggleTask('- [X] a', 0)).toBe('- [ ] a'))
  it('o linie care nu (mai) e căsuță → textul identic', () => {
    expect(toggleTask('- unu\ntext', 2)).toBe('- unu\ntext')
  })
  it('păstrează CRLF', () => {
    expect(toggleTask('- [ ] a\r\n- [ ] b\r\n', 9)).toBe('- [ ] a\r\n- [x] b\r\n')
  })
  it('căsuță numerotată, indentată, în citat', () => {
    expect(toggleTask('  1. [ ] a', 0)).toBe('  1. [x] a')
    expect(toggleTask('> - [ ] a', 0)).toBe('> - [x] a')
  })
})

describe('taskProgress', () => {
  it('numără căsuțele, nu și pe cele din cod', () => {
    expect(taskProgress('- [x] a\n- [ ] b\n  - [X] c\n```\n- [ ] nu\n```')).toEqual({ done: 2, total: 3 })
  })
  it('fără căsuțe → 0/0', () => expect(taskProgress('text [ ] simplu')).toEqual({ done: 0, total: 0 }))
})

describe('continueList', () => {
  it('continuă o căsuță, nebifată', () => {
    expect(continueList('- [x] unu', 9)).toEqual({ text: '- [x] unu\n- [ ] ', anchor: 16 })
  })
  it('continuă buline și numere', () => {
    expect(continueList('* a', 3)).toEqual({ text: '* a\n* ', anchor: 6 })
    expect(continueList('  9. a', 6)).toEqual({ text: '  9. a\n  10. ', anchor: 13 })
  })
  it('Enter în mijlocul textului rupe rândul în două elemente', () => {
    expect(continueList('- ab', 3)).toEqual({ text: '- a\n- b', anchor: 6 })
  })
  it('element gol → iese din listă', () => {
    expect(continueList('- a\n- [ ] ', 10)).toEqual({ text: '- a\n', anchor: 4 })
  })
  it('în afara listei, sau în marcaj → null (Enter obișnuit)', () => {
    expect(continueList('text', 4)).toBeNull()
    expect(continueList('- a', 1)).toBeNull()
  })
  it('păstrează CRLF-ul rândului', () => {
    expect(continueList('- a\r\n- b', 3)).toEqual({ text: '- a\n- \r\n- b', anchor: 6 })
  })
})

describe('removeMarker', () => {
  it('la începutul conținutului scoate marcajul', () => {
    expect(removeMarker('- [ ] a', 6)).toEqual({ text: 'a', anchor: 0 })
    expect(removeMarker('x\n1. a', 5)).toEqual({ text: 'x\na', anchor: 2 })
  })
  it('un element indentat întâi iese un nivel', () => {
    expect(removeMarker('  - a', 4)).toEqual({ text: '- a', anchor: 2 })
  })
  it('altundeva → null', () => {
    expect(removeMarker('- ab', 3)).toBeNull()
    expect(removeMarker('ab', 0)).toBeNull()
  })
})

describe('toggleLinePrefix', () => {
  it('căsuță: text → căsuță → text', () => {
    const on = toggleLinePrefix('a', 1, 1, 'task')
    expect(on).toEqual({ text: '- [ ] a', anchor: 7 })
    expect(toggleLinePrefix(on.text, 7, 7, 'task')).toEqual({ text: 'a', anchor: 1 })
  })
  it('căsuță peste o bulină o transformă', () => {
    expect(toggleLinePrefix('- a', 3, 3, 'task')).toEqual({ text: '- [ ] a', anchor: 7 })
  })
  it('listă pe mai multe rânduri', () => {
    expect(toggleLinePrefix('a\nb', 0, 3, 'bullet')).toEqual({ text: '- a\n- b', anchor: 2, head: 7 })
  })
})

describe('indentLines', () => {
  it('indentează și scoate indentarea doar pe elementele de listă', () => {
    expect(indentLines('- a\ntext', 0, 8, 1)).toEqual({ text: '  - a\ntext', anchor: 2, head: 10 })
    expect(indentLines('  - a', 4, 4, -1)).toEqual({ text: '- a', anchor: 2 })
  })
  it('în afara listei → null (Tab rămâne navigare)', () => {
    expect(indentLines('text', 0, 0, 1)).toBeNull()
  })
})

describe('toggleWrap', () => {
  it('fără selecție pune perechea și cursorul la mijloc', () => {
    expect(toggleWrap('ab', 1, 1, '**')).toEqual({ text: 'a****b', anchor: 3 })
  })
  it('învelește și desface selecția', () => {
    const w = toggleWrap('a b c', 2, 3, '**')
    expect(w).toEqual({ text: 'a **b** c', anchor: 4, head: 5 })
    expect(toggleWrap(w.text, 4, 5, '**')).toEqual({ text: 'a b c', anchor: 2, head: 3 })
  })
})

describe('minimalChange', () => {
  it('doar intervalul schimbat', () => {
    expect(minimalChange('abcdef', 'abXdef')).toEqual({ from: 2, to: 3, insert: 'X' })
    expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' })
    expect(minimalChange('x', 'x')).toBeNull()
  })
})
