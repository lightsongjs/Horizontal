// supabase/functions/_shared/secretBox.ts
//
// Criptarea refresh token-urilor Google (AES-256-GCM). Cheia e un secret al
// funcțiilor (`CALENDAR_TOKEN_KEY`, 64 de cifre hex), nu stă în bază: o copie a
// bazei (backup, dump, un `select` scăpat) nu dă acces la calendarele nimănui.
//
// De ce nu Vault/pgsodium: Vault ține secretele INSTANȚEI (o cheie de API, un
// URL), nu unul pe rând de utilizator, iar citirea lui cere o funcție
// `security definer` în plus. Un AES-GCM în funcție e mai puțină suprafață.
//
// Format: `v1.<iv base64url>.<ciphertext+tag base64url>`. `v1` lasă loc unei
// rotiri de cheie fără o migrare a formatului.

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function importKey(hex: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('CALENDAR_TOKEN_KEY trebuie să aibă 64 de cifre hex (openssl rand -hex 32)')
  const raw = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function seal(keyHex: string, plain: string): Promise<string> {
  const key = await importKey(keyHex)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  return `v1.${b64url(iv)}.${b64url(ct)}`
}

/** Aruncă la orice nepotrivire (cheie greșită, text alterat): GCM verifică integritatea. */
export async function open(keyHex: string, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('format necunoscut')
  const key = await importKey(keyHex)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ct))
  return new TextDecoder().decode(plain)
}
