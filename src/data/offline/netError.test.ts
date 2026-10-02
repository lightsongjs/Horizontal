import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineError, isAuthError, isNetworkError, withTimeout } from './netError'

afterEach(() => vi.unstubAllGlobals())

describe('isNetworkError', () => {
  it('recunoaște eșecul de fetch al browserului', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
  })
  it('recunoaște forma PostgREST a aceluiași eșec (obiect simplu, nu Error)', () => {
    expect(isNetworkError({ message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' })).toBe(true)
  })
  it('recunoaște eroarea reîncercabilă de auth', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError', message: '' })).toBe(true)
  })
  it('NU confundă un bug de cod cu offline', () => {
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false)
  })
  it('NU confundă o eroare de server cu offline', () => {
    expect(isNetworkError({ message: 'new row violates row-level security policy', code: '42501' })).toBe(false)
  })
  it('navigator.onLine === false înseamnă offline, orice ar fi eroarea', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isNetworkError(new Error('orice'))).toBe(true)
  })
  it('OfflineError e de rețea și are mesajul fix', () => {
    const e = new OfflineError()
    expect(isNetworkError(e)).toBe(true)
    expect(e.message).toBe('Necesită rețea — ești offline.')
  })
})

describe('withTimeout', () => {
  it('respinge cu OfflineError după prag', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise(() => {}), 1000)
    vi.advanceTimersByTime(1001)
    await expect(p).rejects.toBeInstanceOf(OfflineError)
    vi.useRealTimers()
  })
  it('lasă rezultatul să treacă', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })
})

describe('isAuthError', () => {
  it('HTTP 401/403 înseamnă sesiune lipsă sau expirată', () => {
    expect(isAuthError({ status: 401, message: 'Unauthorized' }, 'updateIssue')).toBe(true)
    expect(isAuthError({ status: 403, message: 'Forbidden' }, 'updateIssue')).toBe(true)
  })
  it('codurile PostgREST de JWT și RLS', () => {
    expect(isAuthError({ code: 'PGRST301', message: 'JWT expired' }, 'updateIssue')).toBe(true)
    expect(isAuthError({ code: 'PGRST302', message: 'Anonymous access is disabled' }, 'deleteIssues')).toBe(true)
    expect(isAuthError({ code: '42501', message: 'new row violates row-level security policy' }, 'markSeen')).toBe(true)
  })
  it('PGRST116 la creare: inserarea anonimă n-a întors rândul (RLS), nu e un refuz', () => {
    expect(isAuthError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 'createIssue')).toBe(true)
  })
  it('PGRST116 la actualizare: tichetul chiar nu mai există — refuz adevărat', () => {
    expect(isAuthError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 'updateIssue')).toBe(false)
  })
  it('o constrângere încălcată e refuz, nu autentificare', () => {
    expect(isAuthError({ code: '23505', message: 'duplicate key value' }, 'createIssue')).toBe(false)
    expect(isAuthError(new TypeError('Failed to fetch'), 'createIssue')).toBe(false)
    expect(isAuthError(null, 'createIssue')).toBe(false)
  })
})
