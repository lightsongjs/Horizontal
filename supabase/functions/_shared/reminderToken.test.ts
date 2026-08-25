// Tokenul e singurul lucru care stă între „oricine cunoaște URL-ul funcției" și
// „poate bifa tichetele altcuiva". Deci se testează aici, cu Vitest, deși codul
// rulează în Deno: modulul nu atinge nimic specific runtime-ului (Web Crypto și
// `btoa` există în ambele), iar un test care cere `supabase functions serve` n-ar
// fi rulat niciodată.
import { describe, expect, it } from 'vitest'
import { mintToken, TOKEN_TTL_SECONDS, verifyToken } from './reminderToken'

const SECRET = 'secret-de-test-nu-unul-real'
const NOW = Date.UTC(2026, 7, 25, 9, 0, 0)

describe('reminderToken', () => {
  it('acceptă un token propriu, pentru tichetul lui', async () => {
    const t = await mintToken(SECRET, 'EX-03', NOW)
    expect(await verifyToken(SECRET, 'EX-03', t, NOW)).toEqual({ ok: true })
  })

  it('refuză tokenul altui tichet — altfel un memento ar bifa orice', async () => {
    const t = await mintToken(SECRET, 'EX-03', NOW)
    expect(await verifyToken(SECRET, 'EX-04', t, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('refuză un token semnat cu alt secret', async () => {
    const t = await mintToken('alt-secret', 'EX-03', NOW)
    expect(await verifyToken(SECRET, 'EX-03', t, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('expiră — un token pescuit dintr-un jurnal nu mai valorează nimic', async () => {
    const t = await mintToken(SECRET, 'EX-03', NOW)
    const justBefore = NOW + TOKEN_TTL_SECONDS * 1000 - 1000
    expect(await verifyToken(SECRET, 'EX-03', t, justBefore)).toEqual({ ok: true })
    // Exact la expirare, nu doar după: `<=`, ca să nu existe o secundă ambiguă.
    const atExpiry = NOW + TOKEN_TTL_SECONDS * 1000
    expect(await verifyToken(SECRET, 'EX-03', t, atExpiry)).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuză gunoiul fără să arunce', async () => {
    for (const bad of ['', '.', 'fara-punct', '.doar-semnatura', '123.', 'abc.def']) {
      const v = await verifyToken(SECRET, 'EX-03', bad, NOW)
      expect(v.ok).toBe(false)
    }
  })

  it('nu se lasă păcălit de o semnătură trunchiată', async () => {
    const t = await mintToken(SECRET, 'EX-03', NOW)
    const truncated = t.slice(0, t.length - 4)
    expect(await verifyToken(SECRET, 'EX-03', truncated, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('două tokenuri pentru același tichet la aceeași secundă sunt identice', async () => {
    // Nu e o cerință de securitate, e o constatare: tokenul e determinist, deci
    // nu există „unică folosință" din construcție. Dacă asta se schimbă vreodată,
    // testul ăsta cade și te trimite la comentariul din `reminderToken.ts`.
    const a = await mintToken(SECRET, 'EX-03', NOW)
    const b = await mintToken(SECRET, 'EX-03', NOW)
    expect(a).toBe(b)
  })
})
