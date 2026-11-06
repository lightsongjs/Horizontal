import { describe, expect, it } from 'vitest'
import { isSearchShortcut } from './searchShortcut'

const ev = (over: Partial<KeyboardEvent>) => ({
  key: 'k', code: 'KeyK', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
}) as KeyboardEvent

describe('isSearchShortcut (Ctrl+K)', () => {
  it('Ctrl+K și ⌘K deschid căutarea', () => {
    expect(isSearchShortcut(ev({ ctrlKey: true }))).toBe(true)
    expect(isSearchShortcut(ev({ metaKey: true }))).toBe(true)
    expect(isSearchShortcut(ev({ ctrlKey: true, key: 'K' }))).toBe(true) // Caps Lock
  })

  it('fără modificator, K e doar o literă (j/k din liste, tastarea)', () => {
    expect(isSearchShortcut(ev({}))).toBe(false)
  })

  it('Shift sau Alt în plus: altă combinație', () => {
    expect(isSearchShortcut(ev({ ctrlKey: true, shiftKey: true, key: 'K' }))).toBe(false)
    expect(isSearchShortcut(ev({ ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('vechile scurtături nu mai deschid căutarea', () => {
    expect(isSearchShortcut(ev({ ctrlKey: true, key: 'f', code: 'KeyF' }))).toBe(false)
    expect(isSearchShortcut(ev({ ctrlKey: true, key: 'o', code: 'KeyO' }))).toBe(false)
    expect(isSearchShortcut(ev({ key: 'o', code: 'KeyO' }))).toBe(false)
  })

  it('aranjament nelatin: contează tasta fizică', () => {
    expect(isSearchShortcut(ev({ ctrlKey: true, key: 'л', code: 'KeyK' }))).toBe(true)
  })

  it('aranjament latin cu altă literă pe tasta fizică K (Dvorak: t): nu', () => {
    expect(isSearchShortcut(ev({ ctrlKey: true, key: 't', code: 'KeyK' }))).toBe(false)
  })
})
