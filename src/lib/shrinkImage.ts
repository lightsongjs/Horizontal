// Micșorarea imaginilor înainte de upload.
//
// De ce în browser: nu există server pe traseu — browserul urcă direct în
// Supabase Storage. Micșorarea aici scutește spațiul din bucket (1 GB pe planul
// gratuit) și timpul de așteptare.
//
// PLAFONUL DIN `pickFiles` E SINGURA LIMITĂ, iar și el e doar UX: cine vrea îl
// ocolește, fiindcă nu există server care să verifice. Micșorarea e optimizare,
// nu apărare — poate eșua (format nedecodabil) și atunci pleacă originalul.
//
// CALIBRARE: numerele de mai jos vin din măsurători pe materialul real al
// utilizatorului (70 de imagini, 2026-08-12) — vezi secțiunea „Calibrare" din
// spec. Recalibrare: `npm run test:shrink -- --calibrate <cale-poza>`.

export interface ShrinkOptions {
  /** Latura lungă maximă, în pixeli. */
  maxEdge: number
  /** Calitatea pentru ramura de fotografie, 0..1. */
  photoQuality: number
  /** Sub atâția octeți nu se atinge o fotografie. */
  photoSkipUnderBytes: number
  /** Sub atâția octeți nu se atinge o captură PNG. Mai generos: capturile sunt
   *  deja bine comprimate, iar reencodarea lor câștigă puțin și riscă mult. */
  shotSkipUnderBytes: number
}

/**
 * `maxEdge: 3072` nu e o preferință — e alegerea corpusului. Din 70 de imagini
 * reale, peste 2000px sunt 43, peste 3072px sunt 2. Adică 2000 ar redimensiona
 * majoritatea (inclusiv capturile de telefon de 1080×2400, care au text mic),
 * iar 3072 atinge exact cele două poze de cameră care au nevoie.
 *
 * `photoQuality: 0.85` e punctul de start moștenit din mateSimo (calibrat pe
 * poze de scris de mână) și E SINGURA VALOARE ÎNCĂ NECALIBRATĂ AICI. Cazul care
 * o decide: capturile de telefon 1080×2400, care cad pe ramura de recomprimare.
 */
export const SHRINK_DEFAULTS: ShrinkOptions = {
  maxEdge: 3072,
  photoQuality: 0.85,
  photoSkipUnderBytes: 400 * 1024,
  shotSkipUnderBytes: 1536 * 1024,
}

export type ShrinkOutputType = 'image/jpeg' | 'image/webp'

export interface ShrinkPlan {
  action: 'skip' | 'recompress' | 'resize'
  /** Dimensiunile țintă; egale cu cele de intrare când doar se recomprimă. */
  width: number
  height: number
  /**
   * Formatul de ieșire, câmp de prim rang **anume** ca decizia să fie date
   * testabile. O simplă comparație de octeți („dacă a ieșit mai mare, ține
   * originalul") nu poate vedea pierderea canalului alpha, deci nu poate ține
   * locul deciziei de format. `null` = nu reencodăm.
   */
  outputType: ShrinkOutputType | null
  reason: 'nu-e-imagine' | 'format-neatins' | 'deja-mica' | 'doar-recomprimare' | 'prea-mare'
}

/** Formatele pe care le reencodăm, și în ce. Orice altceva se lasă în pace. */
const BRANCH: Record<string, ShrinkOutputType> = {
  'image/png': 'image/webp',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/heic': 'image/jpeg',
  'image/heif': 'image/jpeg',
}

/**
 * Decizia, separată de canvas ca să poată fi testată fără browser.
 *
 * Nu mărește niciodată. Iar când micșorează, scara e o împărțire cu un număr
 * ÎNTREG, nu o potrivire exactă pe `maxEdge`: scalarea fracționară aliazează
 * liniile de 1px (bordurile de UI, conturul glifelor), iar ÷2 sau ÷3 filtrează
 * curat. Plătim cu câțiva pixeli sub limită, câștigăm text care se citește.
 */
export function shrinkPlan(
  input: { type: string; size: number; width: number; height: number },
  opts: ShrinkOptions = SHRINK_DEFAULTS,
): ShrinkPlan {
  const { type, size, width, height } = input
  const keep = (reason: ShrinkPlan['reason']): ShrinkPlan => ({
    action: 'skip',
    width,
    height,
    outputType: null,
    reason,
  })

  if (!type.startsWith('image/')) return keep('nu-e-imagine')

  const outputType = BRANCH[type.toLowerCase()]
  // GIF (canvas îi pierde animația), SVG (rasterizarea e o degradare), WEBP
  // (deja eficient) și orice tip necunoscut: nu ghicim, nu atingem.
  if (!outputType) return keep('format-neatins')

  const isShot = outputType === 'image/webp'
  const skipUnder = isShot ? opts.shotSkipUnderBytes : opts.photoSkipUnderBytes
  const longEdge = Math.max(width, height)

  if (size <= skipUnder && longEdge <= opts.maxEdge) return keep('deja-mica')

  if (longEdge <= opts.maxEdge) {
    // Fișier gras, dimensiuni rezonabile: merită recomprimat, nu redimensionat.
    return { action: 'recompress', width, height, outputType, reason: 'doar-recomprimare' }
  }

  const divisor = Math.ceil(longEdge / opts.maxEdge)
  return {
    action: 'resize',
    width: Math.max(1, Math.round(width / divisor)),
    height: Math.max(1, Math.round(height / divisor)),
    outputType,
    reason: 'prea-mare',
  }
}

/**
 * Nume pentru AFIȘARE (coloana `filename`). Scoate calea, caracterele de
 * control, limitează lungimea. NU se folosește niciodată în calea din Storage —
 * aceea e construită doar din id-uri.
 */
export function safeFilename(name: string): string {
  const base = (name ?? '').split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex -- match intenționat de caractere de control
  const cleaned = base.replace(/[\x00-\x1f]/g, '_').trim()
  if (!cleaned) return 'fisier'
  return cleaned.slice(0, 200)
}

const EXT: Record<ShrinkOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * `ecran.png` + WebP → `ecran.webp`. Extensia e cosmetică (`content_type` din DB
 * e sursa de adevăr la descărcare), dar un nume care minte despre conținut
 * încurcă pe oricine descarcă fișierul.
 *
 * Se apelează DUPĂ micșorare, cu formatul chiar produs — inclusiv `null`, când
 * garda de dimensiune a păstrat originalul.
 */
export function attachmentFilename(name: string, outputType: ShrinkOutputType | null): string {
  const safe = safeFilename(name)
  if (!outputType) return safe
  const stem = safe.replace(/\.[^.]+$/, '')
  return `${stem || 'fisier'}.${EXT[outputType]}`
}
