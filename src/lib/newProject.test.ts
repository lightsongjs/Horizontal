import { describe, it, expect } from 'vitest'
import {
  autoPrefix, cleanPrefix, projectIdForPrefix, prefixOwner, buildNewProject, initialWaves,
  DEFAULT_PROJECT_ACCENT, PROJECT_ACCENTS,
} from './newProject'

describe('autoPrefix', () => {
  it('inițialele cuvintelor, cu majuscule, max 6', () => {
    expect(autoPrefix('Turul României')).toBe('TR')
    expect(autoPrefix('  a b c d e f g h ')).toBe('ABCDEF')
    expect(autoPrefix('Horizontal')).toBe('H')
  })
  it('gol → gol; diacriticele rămân (le taie cleanPrefix)', () => {
    expect(autoPrefix('')).toBe('')
    expect(autoPrefix('Știri noi')).toBe('ȘN')
    expect(cleanPrefix(autoPrefix('Știri noi'))).toBe('N')
  })
})

describe('cleanPrefix / id', () => {
  it('numai A–Z 0–9, majuscule, max 6', () => {
    expect(cleanPrefix('ab-c 12')).toBe('ABC12')
    expect(cleanPrefix('abcdefgh')).toBe('ABCDEF')
    expect(cleanPrefix('ăîș')).toBe('')
  })
  it('id = prefixul cu litere mici', () => {
    expect(projectIdForPrefix('TUR')).toBe('tur')
  })
})

describe('prefixOwner', () => {
  const list = [{ id: 'horizontal', prefix: 'HZ' }, { id: 'kata', prefix: 'KATA' }]
  it('ocupat după id sau după prefix, fără majuscule', () => {
    expect(prefixOwner(list, 'hz')?.id).toBe('horizontal')
    expect(prefixOwner(list, 'Horizo')).toBe(null) // prefixul curățat are max 6 → „horizo”, nu „horizontal”
    expect(prefixOwner(list, 'KATA')?.id).toBe('kata')
    expect(prefixOwner([{ id: 'tur', prefix: 'XX' }], 'TUR')?.id).toBe('tur')
  })
  it('liber sau gol → null', () => {
    expect(prefixOwner(list, 'NEW')).toBe(null)
    expect(prefixOwner(list, '')).toBe(null)
  })
})

describe('buildNewProject / initialWaves', () => {
  it('id din prefix, valul 1 activ, valorile implicite', () => {
    expect(buildNewProject({ name: 'Turul', prefix: 'tur' })).toEqual({
      id: 'tur', name: 'Turul', description: '', prefix: 'TUR', currentWave: 1,
      accent: DEFAULT_PROJECT_ACCENT, type: 'personal',
    })
    expect(buildNewProject({ name: 'X', prefix: 'X', accent: PROJECT_ACCENTS[2], type: 'work' })).toMatchObject({ accent: '#ffb454', type: 'work' })
  })
  it('Notițele (0) și „Val 1 / MVP” (1)', () => {
    expect(initialWaves('tur')).toEqual([
      { projectId: 'tur', number: 0, name: 'Scratchpad', label: '', position: 0 },
      { projectId: 'tur', number: 1, name: 'Val 1', label: 'MVP', position: 1 },
    ])
  })
})
