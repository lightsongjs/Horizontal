import { describe, expect, it } from 'vitest'
import { pickStoredSession, resolveBootSession } from './storedSession'
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
