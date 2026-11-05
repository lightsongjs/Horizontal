import { describe, expect, it } from 'vitest'
import { sameDesc, sameTitle } from './sameText'

/** Tabelul de cazuri — un caz nou se adaugă aici. */
const TITLE: [string, string, boolean][] = [
  ['Sună la bancă', 'Sună la bancă', true],
  ['continua cu https://x.ro/home   ', 'continua cu https://x.ro/home', true],
  ['  Sună', 'Sună', true],
  ['Sună  la bancă', 'Sună la bancă', true],
  ['Sună la bancă.', 'Sună la bancă', false],
  ['', '   ', true],
]
const DESC: [string, string, boolean][] = [
  ['unu\ndoi', 'unu\ndoi', true],
  ['unu\ndoi\n\n\n', 'unu\ndoi', true],
  ['\n\nunu', 'unu', true],
  ['unu   \ndoi\t', 'unu\ndoi', true],
  ['unu\r\ndoi', 'unu\ndoi', true],
  ['', '  \n ', true],
  ['- a\n  - b', '- a\n- b', false],
  ['unu\n\ndoi', 'unu\ndoi', false],
  ['unu doi', 'unu  doi', false],
]

describe('sameTitle', () => {
  for (const [a, b, same] of TITLE) it(`${JSON.stringify(a)} ~ ${JSON.stringify(b)} → ${same}`, () => expect(sameTitle(a, b)).toBe(same))
})
describe('sameDesc', () => {
  for (const [a, b, same] of DESC) it(`${JSON.stringify(a)} ~ ${JSON.stringify(b)} → ${same}`, () => expect(sameDesc(a, b)).toBe(same))
})
