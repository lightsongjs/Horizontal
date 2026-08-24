import { describe, expect, it } from 'vitest'
import { errorMessage } from './errorMessage'

describe('errorMessage', () => {
  it('o eroare PostgREST nu mai devine [object Object]', () => {
    // Forma reală întoarsă de supabase-js pentru o coloană lipsă.
    const e = {
      code: '42703',
      details: null,
      hint: null,
      message: 'column issues.due_at does not exist',
    }
    expect(errorMessage(e)).toBe('column issues.due_at does not exist')
  })

  it('păstrează hint-ul lângă mesaj, fiindcă e partea acționabilă', () => {
    expect(errorMessage({ message: 'column x does not exist', hint: 'Perhaps you meant y' }))
      .toBe('column x does not exist (Perhaps you meant y)')
  })

  it('cade pe details, apoi pe cod', () => {
    expect(errorMessage({ details: 'Key is not present in table' })).toBe('Key is not present in table')
    expect(errorMessage({ code: 'PGRST301' })).toBe('Eroare PGRST301')
  })

  it('o instanță de Error rămâne neatinsă', () => {
    expect(errorMessage(new Error('offline'))).toBe('offline')
  })

  it('un string aruncat direct trece', () => {
    expect(errorMessage('ceva a picat')).toBe('ceva a picat')
  })

  it('nimic folositor nu produce niciodată [object Object]', () => {
    for (const bad of [null, undefined, {}, 42, [], { message: '   ' }, new Error('')]) {
      const msg = errorMessage(bad)
      expect(msg).toBe('Eroare necunoscută')
      expect(msg).not.toContain('object')
    }
  })
})
