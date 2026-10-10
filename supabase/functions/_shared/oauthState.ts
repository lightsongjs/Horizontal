// supabase/functions/_shared/oauthState.ts
//
// `state`-ul fluxului OAuth Google. Callback-ul vine de la browser, FĂRĂ
// sesiunea Supabase a omului (Google nu știe de ea), deci `state` e singurul
// lucru care spune „contul ăsta Google se leagă de utilizatorul X". Semnat cu
// HMAC, ca nimeni să nu poată lega calendarul lui de contul altcuiva (sau,
// invers, să te facă să-ți legi calendarul de contul lui — CSRF-ul clasic al
// OAuth). Expiră în 10 minute: cât durează un „Autorizează".

const enc = new TextEncoder()

export const STATE_TTL_SECONDS = 600

export interface OAuthState {
  /** Utilizatorul Supabase care a apăsat „Conectează". */
  u: string
  /** Originea aplicației la care se întoarce (din lista albă `APP_ORIGINS`). */
  r: string
  /** Expirarea, secunde Unix. */
  exp: number
}

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64url = (s: string): string =>
  atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))))
}

export async function mintState(secret: string, userId: string, returnTo: string, nowMs: number): Promise<string> {
  const body: OAuthState = { u: userId, r: returnTo, exp: Math.floor(nowMs / 1000) + STATE_TTL_SECONDS }
  const payload = b64url(enc.encode(JSON.stringify(body)))
  return `${payload}.${await sign(secret, payload)}`
}

export async function readState(secret: string, state: string, nowMs: number): Promise<OAuthState | null> {
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  const payload = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  const expected = await sign(secret, payload)
  if (expected.length !== sig.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  if (diff !== 0) return null
  try {
    const s = JSON.parse(fromB64url(payload)) as OAuthState
    if (typeof s.u !== 'string' || typeof s.r !== 'string' || typeof s.exp !== 'number') return null
    if (s.exp * 1000 <= nowMs) return null
    return s
  } catch {
    return null
  }
}

/**
 * Unde se întoarce omul după „Autorizează". Doar o origine din lista albă: un
 * `returnTo` liber ar face din callback un redirect deschis spre orice site.
 */
export function pickReturnOrigin(requested: string | null | undefined, allowed: string[]): string | null {
  if (!allowed.length) return null
  try {
    const o = requested ? new URL(requested).origin : ''
    return allowed.includes(o) ? o : allowed[0]
  } catch {
    return allowed[0]
  }
}
