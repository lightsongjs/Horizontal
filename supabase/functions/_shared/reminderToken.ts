// supabase/functions/_shared/reminderToken.ts
//
// Cheia care lasă service worker-ul să rezolve „Gata" / „Amână" FĂRĂ nicio filă
// deschisă. Împărțită între `send-reminders` (o emite) și `reminder-action` (o
// verifică), ca formatul să existe într-un singur loc.
//
// De ce e sigur să trimitem un token prin push: payload-ul unui web push e
// criptat pentru abonamentul destinatarului (RFC 8291, ECDH + AES-GCM). Nici
// serviciul de push, nici altcineva pe drum nu-l poate citi — doar workerul
// dispozitivului care s-a abonat. Deci tokenul ajunge exact la cel care are
// dreptul să apese butonul, și nicăieri altundeva.
//
// De ce NU e nevoie de „unică folosință": ar cere un tabel și o scriere pe
// fiecare apăsare, iar reluarea aceluiași token nu produce nimic dăunător —
// pune din nou `done` sau împinge din nou mementoul cu cinci minute, ambele
// idempotente în efect. Ce ne trebuie e o EXPIRARE, ca un token pescuit dintr-un
// jurnal peste o lună să nu mai valoreze nimic.
//
// Tokenul e legat de id-ul tichetului, nu de acțiune: singurul deținător e
// dispozitivul utilizatorului, iar ambele acțiuni sunt ale lui. Un token pe
// acțiune ar fi însemnat două în fiecare payload, pentru zero câștig real.

/** Cât timp e valabil un token. Un memento neatins o oră a fost oricum ratat. */
export const TOKEN_TTL_SECONDS = 3600

const enc = new TextEncoder()

const b64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

/** `<exp>.<semnătură>`. `exp` e vizibil deliberat: verificatorul îl are nevoie. */
export async function mintToken(secret: string, issueId: string, nowMs: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS
  return `${exp}.${await sign(secret, `${issueId}.${exp}`)}`
}

export type TokenVerdict = { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'bad-signature' }

/**
 * Verifică un token. Comparația semnăturii e în timp constant: o comparație
 * naivă cu `!==` se oprește la primul octet diferit și scurge, prin durată, cât
 * din semnătură a fost ghicit corect.
 */
export async function verifyToken(
  secret: string, issueId: string, token: string, nowMs: number,
): Promise<TokenVerdict> {
  const dot = token.indexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const exp = Number(token.slice(0, dot))
  const sig = token.slice(dot + 1)
  if (!Number.isInteger(exp) || !sig) return { ok: false, reason: 'malformed' }
  // Expirarea ÎNAINTE de semnătură: e verificarea ieftină, și un token expirat
  // nu merită un HMAC.
  if (exp * 1000 <= nowMs) return { ok: false, reason: 'expired' }

  const expected = await sign(secret, `${issueId}.${exp}`)
  if (expected.length !== sig.length) return { ok: false, reason: 'bad-signature' }
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0 ? { ok: true } : { ok: false, reason: 'bad-signature' }
}
