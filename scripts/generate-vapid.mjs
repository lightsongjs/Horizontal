// Generează perechea de chei VAPID pentru web push. Rulează O SINGURĂ dată:
//   npm run vapid
//
// Cheia PUBLICĂ merge în `.env` ca VITE_VAPID_PUBLIC_KEY — ajunge în bundle,
// e publică prin definiție. Cheia PRIVATĂ merge în secretele funcției edge:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:tu@exemplu.ro
//
// Cheia privată NU intră în `.env` și NU intră în git: cu ea, oricine poate
// trimite notificări în numele aplicației tale. Schimbarea ei invalidează toate
// abonamentele existente, deci fiecare dispozitiv trebuie reabonat.
//
// Fără dependențe: o cheie VAPID e o pereche ECDSA P-256, iar `node:crypto` o
// produce. `web-push` ar fi adus un pachet întreg pentru zece linii.
import { generateKeyPairSync } from 'node:crypto'

const b64url = (buf) => Buffer.from(buf).toString('base64url')

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })

// Cheia publică VAPID e PUNCTUL necomprimat: 0x04 || X || Y, 65 de octeți.
// Coordonatele vin din JWK deja în base64url, pe câte 32 de octeți.
const x = Buffer.from(jwk.x, 'base64url')
const y = Buffer.from(jwk.y, 'base64url')
if (x.length !== 32 || y.length !== 32) throw new Error('coordonate P-256 neașteptate')
const point = Buffer.concat([Buffer.from([0x04]), x, y])

console.log(`
Pune în .env (publică, ajunge în bundle):
  VITE_VAPID_PUBLIC_KEY=${b64url(point)}

Pune în secretele funcției edge (NU în .env, NU în git):
  VAPID_PUBLIC_KEY=${b64url(point)}
  VAPID_PRIVATE_KEY=${b64url(Buffer.from(priv.d, 'base64url'))}
  VAPID_SUBJECT=mailto:tu@exemplu.ro
`)
