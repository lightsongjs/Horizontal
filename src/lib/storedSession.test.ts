import { describe, expect, it } from 'vitest'
import {
  clearAccess,
  pickStoredSession,
  readAccess,
  resolveAccess,
  resolveBootSession,
  shouldApplyAuthEvent,
  writeAccess,
} from './storedSession'
import type { Session } from '@supabase/supabase-js'

const sess = { access_token: 'a', refresh_token: 'r', user: { id: 'u1' } } as unknown as Session
const storage = (entries: Record<string, string>) => ({
  length: Object.keys(entries).length,
  key: (i: number) => Object.keys(entries)[i] ?? null,
  getItem: (k: string) => entries[k] ?? null,
})

describe('pickStoredSession', () => {
  it('găsește sesiunea Supabase după forma cheii', () => {
    expect(pickStoredSession(storage({ 'sb-abc-auth-token': JSON.stringify(sess), x: '1' }))?.user.id).toBe('u1')
  })
  it('ignoră JSON stricat și forme greșite', () => {
    expect(pickStoredSession(storage({ 'sb-abc-auth-token': '{' }))).toBeNull()
    expect(pickStoredSession(storage({ 'sb-abc-auth-token': '{"a":1}' }))).toBeNull()
  })
})

describe('resolveBootSession', () => {
  it('sesiunea primită câștigă', () => {
    expect(resolveBootSession({ session: sess, error: null }, () => null)).toBe(sess)
  })
  it('refresh eșuat din cauza rețelei → sesiunea din storage, nu ecranul de login', () => {
    expect(resolveBootSession({ session: null, error: { name: 'AuthRetryableFetchError', message: '' } }, () => sess)).toBe(sess)
  })
  it('refresh refuzat de server (token revocat) → fără sesiune', () => {
    expect(resolveBootSession({ session: null, error: { name: 'AuthApiError', message: 'Invalid Refresh Token' } }, () => sess)).toBeNull()
  })
  it('fără eroare și fără sesiune → delogat cu adevărat', () => {
    expect(resolveBootSession({ session: null, error: null }, () => sess)).toBeNull()
  })
})

describe('shouldApplyAuthEvent', () => {
  it('null cu SIGNED_OUT se aplică', () => expect(shouldApplyAuthEvent('SIGNED_OUT', null)).toBe(true))
  it('null cu TOKEN_REFRESHED sau INITIAL_SESSION se ignoră', () => {
    expect(shouldApplyAuthEvent('TOKEN_REFRESHED', null)).toBe(false)
    expect(shouldApplyAuthEvent('INITIAL_SESSION', null)).toBe(false)
  })
  it('o sesiune nenulă se aplică mereu', () => {
    expect(shouldApplyAuthEvent('TOKEN_REFRESHED', sess)).toBe(true)
    expect(shouldApplyAuthEvent('SIGNED_IN', sess)).toBe(true)
  })
})

describe('access persistat', () => {
  const mem = () => {
    const m: Record<string, string> = {}
    return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v }, removeItem: (k: string) => { delete m[k] } }
  }
  it('scrie, citește și șterge pe utilizator', () => {
    const s = mem()
    writeAccess(s, 'u1', { p1: 'write' })
    expect(readAccess(s, 'u1')).toEqual({ p1: 'write' })
    expect(readAccess(s, 'u2')).toBeNull()
    clearAccess(s, 'u1')
    expect(readAccess(s, 'u1')).toBeNull()
  })
  it('ignoră JSON stricat și roluri necunoscute', () => {
    expect(readAccess({ getItem: () => '{' }, 'u1')).toBeNull()
    expect(readAccess({ getItem: () => '{"p":"admin","q":"read"}' }, 'u1')).toEqual({ q: 'read' })
  })
  it('storage care aruncă nu sparge nimic', () => {
    const boom = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
    expect(readAccess(boom, 'u1')).toBeNull()
    expect(() => writeAccess(boom, 'u1', {})).not.toThrow()
    expect(() => clearAccess(boom, 'u1')).not.toThrow()
  })
  it('eroare de rețea → harta păstrată; eroare de server → {}; succes → proaspăta', () => {
    const kept = { p1: 'write' as const }
    expect(resolveAccess({ map: null, error: { name: 'AuthRetryableFetchError', message: '' } }, () => kept)).toBe(kept)
    expect(resolveAccess({ map: null, error: { message: 'TypeError: Failed to fetch' } }, () => null)).toEqual({})
    expect(resolveAccess({ map: null, error: { message: 'permission denied' } }, () => kept)).toEqual({})
    expect(resolveAccess({ map: { p2: 'read' }, error: null }, () => kept)).toEqual({ p2: 'read' })
  })
})
